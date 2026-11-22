import type { IntelligenceEvent } from './types.ts';
import { ACTORS, actorMatcher, extractNames, isKnownActor, isNameSource, normName, type ActorStat, type ActorsSnapshot, type NewName } from './actors.ts';
import { usualLevel } from './meters/util.ts';

const H = 3_600_000;
const DAY = 24 * H;
const at = (e: IntelligenceEvent) => Date.parse(e.publishedAt ?? e.collectedAt);

/**
 * Every candidate name seen since tracking began, with when it was first seen. Kept by the
 * collector as one packed string (`name\tfirstMs\tb` lines; `b` = seen on the first run, so never
 * reported as new). Bounded to the most recent 30,000 names.
 */
export interface NameRegistry {
  since: number;
  names: Map<string, { first: number; boot: boolean }>;
}
export const MAX_NAMES = 30_000;

export function packRegistry(r: NameRegistry): string {
  return [`#since\t${r.since}`, ...[...r.names].map(([n, v]) => `${n}\t${v.first}\t${v.boot ? 'b' : ''}`)].join('\n');
}
export function unpackRegistry(packed: string): NameRegistry {
  const lines = packed.split('\n');
  const since = Number(lines[0]?.startsWith('#since\t') ? lines[0].split('\t')[1] : Date.now());
  const names = new Map<string, { first: number; boot: boolean }>();
  for (const l of lines.slice(1)) {
    const [n, f, b] = l.split('\t');
    if (n && Number.isFinite(Number(f))) names.set(n, { first: Number(f), boot: b === 'b' });
  }
  return { since, names };
}

/** Minimum headlines naming a new name before it is shown (one mention is too often noise). */
export const NEW_NAME_MIN_MENTIONS = 2;
export const NEW_NAME_DAYS = 7;

export function computeActors(events: IntelligenceEvent[], now: number, historyStart: number | null, previous: NameRegistry | null): { snapshot: ActorsSnapshot; registry: NameRegistry } {
  const match = actorMatcher();

  // ---- known actors
  const hits = new Map<string, IntelligenceEvent[]>();
  for (const e of events) {
    if (at(e) < now - 40 * DAY || at(e) > now + H) continue;
    for (const x of match(e)) hits.set(x.id, [...(hits.get(x.id) ?? []), e]);
  }
  const actors: ActorStat[] = [];
  for (const x of ACTORS) {
    const list = hits.get(x.id) ?? [];
    const daily = Array.from({ length: 14 }, (_, i) => {
      const end = now - (13 - i) * DAY;
      return list.filter((e) => at(e) > end - DAY && at(e) <= end).length;
    });
    if (!daily.some(Boolean)) continue;
    const u = usualLevel(list, () => true, now, 72, historyStart, 14, 1);
    actors.push({
      id: x.id,
      name: x.name,
      kind: x.kind,
      regionIds: x.regionIds,
      last24h: list.filter((e) => at(e) >= now - DAY).length,
      last72h: u.current,
      last7d: list.filter((e) => at(e) >= now - 7 * DAY).length,
      usual72h: u.usual,
      // Rising (Phase 24): 5+ mentions and very unusual (3+ typical spreads above usual), or 3× usual
      // until the typical spread is known.
      rising: u.status === 'ok' && u.current >= 5 && (u.anomaly?.status === 'ok' ? u.anomaly.score! >= 3 : (u.ratio ?? 0) >= 3),
      score: u.anomaly?.score ?? null,
      daily,
    });
  }
  actors.sort((a, b) => Number(b.rising) - Number(a.rising) || b.last72h - a.last72h || b.last7d - a.last7d);

  // ---- new names
  const boot = !previous;
  const registry: NameRegistry = previous ? { since: previous.since, names: new Map(previous.names) } : { since: now, names: new Map() };
  const mentions = new Map<string, { display: string; events: IntelligenceEvent[] }>();
  for (const e of events.filter(isNameSource)) {
    for (const name of extractNames(e.title)) {
      if (isKnownActor(name, match)) continue;
      const k = normName(name);
      const m = mentions.get(k) ?? { display: name, events: [] };
      m.events.push(e);
      mentions.set(k, m);
      if (!registry.names.has(k)) registry.names.set(k, { first: boot ? at(e) : Math.min(at(e), now), boot });
      else if (at(e) < registry.names.get(k)!.first) registry.names.get(k)!.first = at(e);
    }
  }
  if (registry.names.size > MAX_NAMES) {
    registry.names = new Map([...registry.names].sort((a, b) => b[1].first - a[1].first).slice(0, MAX_NAMES));
  }
  const newNames: NewName[] = [];
  for (const [k, v] of registry.names) {
    if (v.boot || v.first < now - NEW_NAME_DAYS * DAY) continue;
    const m = mentions.get(k);
    if (!m || m.events.length < NEW_NAME_MIN_MENTIONS) continue;
    const latest = [...m.events].sort((a, b) => at(b) - at(a))[0];
    newNames.push({
      name: m.display,
      firstSeen: new Date(v.first).toISOString(),
      mentions: m.events.length,
      publishers: new Set(m.events.map((e) => e.sourceId)).size,
      regionIds: [...new Set(m.events.flatMap((e) => e.regionIds))],
      sample: { title: latest.title, url: latest.sourceUrl },
    });
  }
  newNames.sort((a, b) => b.mentions - a.mentions || b.firstSeen.localeCompare(a.firstSeen));
  return {
    snapshot: { computedAt: new Date(now).toISOString(), trackingSince: new Date(registry.since).toISOString(), actors, newNames: newNames.slice(0, 30) },
    registry,
  };
}
