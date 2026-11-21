import type { IntelligenceEvent } from './types.ts';
import { regionsForCountry } from './regions.ts';
import { distanceKm } from './installations.ts';
import { isNews } from './changes.ts';
import { INFRA_RADIUS_KM, type FlaggedSite, type InfraMatch, type InfraSite, type InfraType, type InfrastructureSnapshot } from './infrastructure.ts';

/**
 * Records near or naming critical infrastructure in the last 72 hours.
 *
 * Near: fire detections (NASA FIRMS — new clusters only, so standing gas flares drop out) and any
 * other exactly located military or unrest record, within 10 km of a nuclear plant or 5 km of
 * other sites. Aircraft positions are left out: flying past a port is not activity at the port.
 *
 * Named: the headline or summary names the site together with its type — "Zaporizhzhia nuclear
 * plant", "Mosul Dam", "Port of Odesa", "Ras Tanura refinery". Bare place names never count:
 * many power plants in the WRI data are named only after their town ("Baiji", "Ulsan").
 */

export const INFRA_WINDOW_HOURS = 72;

const TYPE_WORDS: Record<InfraType, string> = {
  nuclear: '(?:nuclear (?:power )?(?:plant|station|facility)|NPP|atomic (?:power )?(?:plant|station))',
  power: '(?:power (?:plant|station)|thermal (?:power )?plant|hydroelectric (?:power )?(?:plant|station)|TPP|HPP|GRES|CHP)',
  refinery: '(?:oil )?refinery',
  dam: 'dam',
  port: '(?:port|harbou?r|seaport|terminal)',
};
/** Words removed from a site's name to get its core ("Zaporizhzhia Nuclear Power Plant" → "Zaporizhzhia"). */
const STRIP =
  /\b(nuclear power plant|nuclear power station|nuclear plant|power plant|power station|hydroelectric power plant|hydroelectric power station|hydroelectric|thermal|oil refinery|refinery|dam|port of|seaport|sea port|port|harbour|harbor|fishing|river|commercial|npp|tpp|hpp|chp|gres|ccgt|c\.c\.|cc|ii|iii|iv|-\d)\b/gi;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEYWORD = /nuclear|atomic|npp|power|plant|station|refinery|dam\b|port|harbou?r|terminal|tpp|hpp|gres|chp/i;

function coreOf(name: string): string | null {
  const core = name.replace(/\([^)]*\)/g, ' ').replace(STRIP, ' ').replace(/[-–,]/g, ' ').replace(/\s+/g, ' ').trim();
  return core.length >= 4 && /[A-Za-z]/.test(core) ? core : null;
}

/** Name patterns for a site: its core name next to its type word, in either order. */
export function sitePatterns(site: Pick<InfraSite, 'n' | 't'>): RegExp[] {
  const cores = [...new Set(site.n.map(coreOf).filter((c): c is string => !!c))];
  const type = TYPE_WORDS[site.t];
  return cores.map((c) => {
    const core = escape(c).replace(/\s+/g, '\\s+');
    // "<core> [up to 2 words] <type>" or "<type> of <core>" (Port of Odesa).
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${core}(?:\\s+[\\p{L}'’-]+){0,2}?\\s+${type}|${type}\\s+of\\s+${core})(?![\\p{L}\\p{N}])`, 'iu');
  });
}

const STRIKE = /\b(strike|struck|attack|drone|missile|shell|bomb|fire|blaze|explosion|blast|hit|damaged|seized|captured|shut|outage|blackout|evacuat)\w*/i;

export function computeInfrastructure(sites: InfraSite[], events: IntelligenceEvent[], now: number): InfrastructureSnapshot {
  const from = now - INFRA_WINDOW_HOURS * 3_600_000;
  const at = (e: IntelligenceEvent) => Date.parse(e.publishedAt ?? e.collectedAt);
  const recent = events.filter((e) => at(e) >= from && at(e) <= now + 3_600_000);
  const located = recent.filter(
    (e) => e.locationPrecision === 'exact' && typeof e.latitude === 'number' && typeof e.longitude === 'number' && e.sourceId !== 'adsb-military' && (e.sourceId === 'nasa-firms' || e.category === 'military' || e.category === 'unrest'),
  );
  const texts = recent.filter((e) => KEYWORD.test(`${e.title} ${e.summary ?? ''}`));
  // Cheap pre-check: a site can only be named if one of its core names appears in the text at all.
  const lowered = texts.map((e) => ({ e, text: `${e.title} ${e.summary ?? ''}`, low: `${e.title} ${e.summary ?? ''}`.toLowerCase() }));
  const compiled = sites.map((s) => ({ s, patterns: sitePatterns(s), cores: s.n.map(coreOf).filter((c): c is string => !!c).map((c) => c.toLowerCase()) }));
  const flagged: FlaggedSite[] = [];
  for (const { s, patterns, cores } of compiled) {
    const matches: InfraMatch[] = [];
    const radius = INFRA_RADIUS_KM[s.t];
    for (const e of located) {
      if (Math.abs(e.latitude! - s.la) > 0.2 || Math.abs(e.longitude! - s.lo) > 0.3) continue;
      const km = distanceKm(s.la, s.lo, e.latitude!, e.longitude!);
      if (km <= radius) matches.push({ title: e.title, url: e.sourceUrl, at: e.publishedAt ?? e.collectedAt, how: 'near', km: Math.round(km * 10) / 10, kind: e.sourceId === 'nasa-firms' ? 'fire' : 'military' });
    }
    if (patterns.length) {
      for (const { e, text, low } of lowered) {
        if (!cores.some((c) => low.includes(c))) continue;
        if (patterns.some((p) => p.test(text))) {
          matches.push({ title: e.title, url: e.sourceUrl, at: e.publishedAt ?? e.collectedAt, how: 'named', kind: isNews(e) && STRIKE.test(e.title) ? 'strike' : 'mention' });
        }
      }
    }
    if (!matches.length) continue;
    matches.sort((a, b) => b.at.localeCompare(a.at));
    flagged.push({
      id: s.id,
      name: s.n[0],
      type: s.t,
      country: s.c,
      lat: s.la,
      lon: s.lo,
      regionIds: regionsForCountry(s.c),
      near: matches.filter((m) => m.how === 'near').length,
      named: matches.filter((m) => m.how === 'named').length,
      latestAt: matches[0].at,
      matches: matches.slice(0, 5),
    });
  }
  flagged.sort((a, b) => Number(b.type === 'nuclear') - Number(a.type === 'nuclear') || b.near + b.named - (a.near + a.named));
  return { computedAt: new Date(now).toISOString(), windowHours: INFRA_WINDOW_HOURS, sitesChecked: sites.length, flagged: flagged.slice(0, 100) };
}

/** Points for the meter: nuclear sites weigh most; strike headlines more than mentions. */
export function siteScore(f: FlaggedSite): number {
  const nuclear = f.type === 'nuclear';
  const near = f.matches.some((m) => m.how === 'near') ? (nuclear ? 3 : 1) : 0;
  const strike = f.matches.some((m) => m.kind === 'strike') ? (nuclear ? 3 : 2) : 0;
  const mention = f.matches.some((m) => m.kind === 'mention') ? 0.5 : 0;
  return Math.max(near, strike, mention) + (near && strike ? 1 : 0);
}
