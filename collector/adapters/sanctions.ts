import type { IntelligenceEvent } from '../../shared/domain/types.ts';
import { regionsForCountry } from '../../shared/domain/regions.ts';
import {
  KIND_LABEL,
  SANCTIONS_LISTS,
  sanctionsCountry,
  targetCountry,
  type Designee,
  type DesigneeKind,
  type SanctionedVessel,
  type SanctionsListId,
} from '../../shared/domain/sanctions.ts';
import { contentHash } from '../lib/hash.ts';
import { LIMITS, cleanText, decodeEntities, truncate } from '../lib/text.ts';
import type { Validators } from '../lib/http.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';

// ------------------------------------------------------------------ parsing ---
// The lists are 20–30 MB XML documents with one flat record per entry, so each entry is cut out
// and read with targeted patterns instead of building a full document tree.

const tag = (s: string, name: string) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(s);
  return m ? cleanText(decodeEntities(m[1])) : null;
};
const tags = (s: string, name: string) => [...s.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => cleanText(decodeEntities(m[1])));
const attr = (s: string, name: string) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(s);
  return m ? decodeEntities(m[1]) : null;
};
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const countriesOf = (names: (string | null)[]) => uniq(names.map(sanctionsCountry).filter((c): c is string => !!c));
const dmy = (s: string | null) => (s && /^\d{2}\/\d{2}\/\d{4}$/.test(s) ? `${s.slice(6)}-${s.slice(3, 5)}-${s.slice(0, 2)}` : null);
const mdy = (s: string | null) => (s && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s) ? (([m, d, y]) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`)(s.split('/')) : null);

export interface ParsedList {
  /** Publication date of this copy of the list, YYYY-MM-DD. */
  publishedOn: string | null;
  designees: Designee[];
}

export function parseOfacSdn(xml: string, minEntries = 1000): ParsedList {
  if (!xml.includes('<sdnList')) throw new Error('OFAC: not an SDN list document');
  const publishedOn = mdy(tag(xml.slice(0, 2000), 'Publish_Date'));
  const designees: Designee[] = [];
  for (const chunk of xml.split('<sdnEntry>').slice(1)) {
    const e = chunk.slice(0, chunk.indexOf('</sdnEntry>'));
    const uid = tag(e, 'uid');
    if (!uid) continue;
    const type = (tag(e, 'sdnType') ?? '').toLowerCase();
    const kind: DesigneeKind = type === 'individual' ? 'individual' : type === 'vessel' ? 'vessel' : type === 'aircraft' ? 'aircraft' : 'entity';
    const ids = [...e.matchAll(/<id>([\s\S]*?)<\/id>/g)].map((m) => ({ type: tag(m[1], 'idType'), number: tag(m[1], 'idNumber') }));
    const imo = ids.find((i) => i.type === 'Vessel Registration Identification')?.number?.replace(/\D/g, '') || null;
    const mmsi = ids.find((i) => i.type === 'MMSI')?.number?.replace(/\D/g, '') || null;
    // Only the entry's own name fields (before the alias list).
    const own = e.split('<akaList>')[0];
    designees.push({
      id: uid,
      name: [tag(own, 'firstName'), tag(own, 'lastName')].filter(Boolean).join(' '),
      kind,
      programs: tags(e, 'program'),
      countries: countriesOf(tags(e, 'country')),
      designatedOn: null,
      imo,
      mmsi,
    });
  }
  if (designees.length < minEntries) throw new Error(`OFAC: only ${designees.length} entries parsed`);
  return { publishedOn, designees };
}

export function parseEuList(xml: string, minEntries = 1000): ParsedList {
  if (!xml.includes('<export')) throw new Error('EU: not a consolidated list export');
  const gen = attr(xml.slice(0, 1000), 'generationDate');
  const designees: Designee[] = [];
  for (const chunk of xml.split('<sanctionEntity ').slice(1)) {
    const e = chunk.slice(0, chunk.indexOf('</sanctionEntity>'));
    const head = e.slice(0, e.indexOf('>'));
    const id = attr(head, 'logicalId');
    if (!id) continue;
    const imo = /<identification [^>]*identificationTypeCode="imo"[^>]*>/.exec(e);
    const subject = attr(/<subjectType [^>]*>/.exec(e)?.[0] ?? '', 'code');
    const countryCodes = [...e.matchAll(/<(?:citizenship|address) [^>]*countryIso2Code="([A-Z]{2})"/g)].map((m) => m[1]).filter((c) => c !== '00');
    designees.push({
      id,
      name: attr(/<nameAlias [^>]*>/.exec(e)?.[0] ?? '', 'wholeName') ?? '',
      kind: imo ? 'vessel' : subject === 'person' ? 'individual' : 'entity',
      programs: uniq([...e.matchAll(/<regulation [^>]*programme="([^"]+)"/g)].map((m) => m[1])),
      countries: uniq(countryCodes),
      designatedOn: attr(head, 'designationDate') || null,
      imo: imo ? attr(imo[0], 'number')?.replace(/\D/g, '') || null : null,
      mmsi: null,
    });
  }
  if (designees.length < minEntries) throw new Error(`EU: only ${designees.length} entries parsed`);
  return { publishedOn: gen ? gen.slice(0, 10) : null, designees };
}

export function parseUkList(xml: string, minEntries = 1000): ParsedList {
  if (!xml.includes('<Designations')) throw new Error('UK: not a UK Sanctions List document');
  const publishedOn = dmy(tag(xml.slice(0, 2000), 'DateGenerated'));
  const designees: Designee[] = [];
  for (const chunk of xml.split('<Designation>').slice(1)) {
    const e = chunk.slice(0, chunk.indexOf('</Designation>'));
    const id = tag(e, 'UniqueID');
    if (!id) continue;
    const primary = [...e.matchAll(/<Name>([\s\S]*?)<\/Name>/g)].map((m) => m[1]).find((n) => /Primary Name/.test(n)) ?? '';
    const type = (tag(e, 'IndividualEntityShip') ?? '').toLowerCase();
    designees.push({
      id,
      name: ['Name1', 'Name2', 'Name3', 'Name4', 'Name5', 'Name6'].map((n) => tag(primary, n)).filter(Boolean).join(' '),
      kind: type === 'individual' ? 'individual' : type === 'ship' ? 'vessel' : 'entity',
      programs: tags(e, 'RegimeName'),
      countries: countriesOf([...tags(e, 'AddressCountry'), ...tags(e, 'Nationality')]),
      designatedOn: dmy(tag(e, 'DateDesignated')),
      imo: tag(e, 'IMONumber')?.replace(/\D/g, '') || null,
      mmsi: null,
    });
  }
  if (designees.length < minEntries) throw new Error(`UK: only ${designees.length} entries parsed`);
  return { publishedOn, designees };
}

// ------------------------------------------------------------------ records ---

const COUNTRY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
const countryLabel = (c: string) => COUNTRY_NAMES.of(c) ?? c;

/** One record per list, day and target country, for the given new designees. */
export function sanctionsEvents(list: SanctionsListId, day: string, added: Designee[], nowIso: string): IntelligenceEvent[] {
  const def = SANCTIONS_LISTS[list];
  const groups = new Map<string, Designee[]>();
  for (const d of added) {
    const t = targetCountry(list, d);
    const key = `${t.basis}|${t.country ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  return [...groups].map(([key, ds]) => {
    const [basis, country] = key.split('|') as ['programme' | 'address' | 'none', string];
    const target = basis === 'programme' ? `targeting ${countryLabel(country)}` : basis === 'address' ? `linked to ${countryLabel(country)} (addresses, nationality)` : 'not country-specific';
    const kinds = (['vessel', 'entity', 'individual', 'aircraft'] as DesigneeKind[])
      .map((k) => [k, ds.filter((d) => d.kind === k).length] as const)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${KIND_LABEL[k][n === 1 ? 0 : 1]}`);
    const programs = uniq(ds.flatMap((d) => d.programs)).slice(0, 4);
    const names = ds.slice(0, 8).map((d) => d.name).filter(Boolean);
    const id = contentHash(def.sourceId, day, key, ds.map((d) => d.id).sort().join(','));
    const at = `${day}T12:00:00.000Z`;
    return {
      id,
      contentHash: id,
      dataOrigin: 'live' as const,
      sourceId: def.sourceId,
      sourceName: `${def.short} — ${def.name}`,
      sourceClass: 'official' as const,
      sourceUrl: def.page,
      title: truncate(`${def.short} sanctions: ${ds.length} new designation${ds.length === 1 ? '' : 's'} ${target} — ${kinds.join(', ')} (${day})`, LIMITS.title),
      summary: truncate(
        `Added to the ${def.name}${programs.length ? ` under ${programs.join('; ')}` : ''}: ${names.join('; ')}${ds.length > names.length ? ` and ${ds.length - names.length} more` : ''}. ` +
          'The target country is set by the sanctions programme; for thematic programmes (terrorism, cyber, human rights) it comes from the designees’ addresses and nationality. A designation is a legal measure, not proof of the conduct alleged.',
        LIMITS.summary,
      ),
      category: 'economic' as const,
      regionIds: country ? regionsForCountry(country) : [],
      countryCodes: country ? [country] : [],
      publishedAt: at,
      occurredAt: at,
      collectedAt: nowIso,
      credibility: 'official' as const,
      verificationStatus: 'unreviewed' as const,
      locationPrecision: (country ? 'country' : 'none') as 'country' | 'none',
      metadata: {
        subtype: 'sanctions-designations',
        list,
        count: ds.length,
        vessels: ds.filter((d) => d.kind === 'vessel').length,
        programs,
        designeeIds: ds.slice(0, 50).map((d) => d.id),
        designatedOn: day,
        countryBasis: basis,
      },
    };
  });
}

// ------------------------------------------------------------------ adapter ---

export interface SanctionsState {
  /**
   * Ids on the list at the last successful read, joined with newlines. One string, not an array:
   * Firestore indexes every array element and refuses documents with too many index entries
   * (the OFAC list has ~20,000 ids).
   */
  idsPacked?: string;
  /** Sanctioned vessels with identifiers, as JSON (same reason), for matching ship positions (item 4b). */
  vesselsJson?: string;
  publishedOn: string | null;
  lastFetchedAt: string;
  validators?: Validators;
  /** v0.19.0 first-run form (arrays); still read. */
  ids?: string[];
  vessels?: SanctionedVessel[];
}

const ID_SEP = '|';
export const stateIds = (s: SanctionsState): string[] => (s.idsPacked !== undefined ? (s.idsPacked ? s.idsPacked.split(ID_SEP) : []) : (s.ids ?? []));
export const stateVessels = (s: SanctionsState): SanctionedVessel[] => (s.vesselsJson ? (JSON.parse(s.vesselsJson) as SanctionedVessel[]) : (s.vessels ?? []));
const packState = (ids: string[], vessels: SanctionedVessel[], rest: Pick<SanctionsState, 'publishedOn' | 'lastFetchedAt' | 'validators'>): SanctionsState => ({
  idsPacked: ids.join(ID_SEP),
  vesselsJson: JSON.stringify(vessels),
  ...rest,
});

interface ListConfig {
  list: SanctionsListId;
  url: string;
  parse: (xml: string) => ParsedList;
  /** Minimum hours between downloads (the EU file takes over a minute to generate). */
  everyHours: number;
  limits: { maxBytes: number; timeoutMs: number };
}

/** First run: lists that carry designation dates are back-filled this far. */
export const SANCTIONS_BACKFILL_DAYS = 30;

function makeAdapter(cfg: ListConfig): SourceAdapter<SanctionsState> {
  const def = SANCTIONS_LISTS[cfg.list];
  return {
    sourceId: def.sourceId,
    async collect(ctx: AdapterContext<SanctionsState>): Promise<AdapterResult<SanctionsState>> {
      const prev = ctx.state;
      const nowIso = new Date(ctx.now).toISOString();
      if (prev && ctx.now - Date.parse(prev.lastFetchedAt) < cfg.everyHours * 3_600_000) {
        return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: prev };
      }
      const res = await ctx.fetch(cfg.url, prev?.validators, undefined, cfg.limits);
      if (res.kind === 'not-modified') {
        return { events: [], rejected: [], itemsSeen: 0, notModified: true, state: packState(stateIds(prev!), stateVessels(prev!), { publishedOn: prev!.publishedOn, lastFetchedAt: nowIso, validators: prev!.validators }) };
      }
      const parsed = cfg.parse(res.body);
      const today = nowIso.slice(0, 10);
      let added: Designee[];
      if (prev) {
        const prevIds = stateIds(prev);
        const before = new Set(prevIds);
        added = parsed.designees.filter((d) => !before.has(d.id));
        // A sudden flood of "new" ids means the list's ids changed, not a sanctions wave.
        if (added.length > Math.max(500, prevIds.length * 0.2)) throw new Error(`${def.short}: ${added.length} new ids at once; refusing (id scheme change?)`);
      } else {
        const since = new Date(ctx.now - SANCTIONS_BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 10);
        added = parsed.designees.filter((d) => d.designatedOn && d.designatedOn >= since);
      }
      // Group by designation date where the list gives one, else by this copy's publication date.
      const byDay = new Map<string, Designee[]>();
      for (const d of added) {
        const dayOf = d.designatedOn && d.designatedOn <= today ? d.designatedOn : (parsed.publishedOn ?? today);
        byDay.set(dayOf, [...(byDay.get(dayOf) ?? []), d]);
      }
      const events = [...byDay].flatMap(([dayOf, ds]) => sanctionsEvents(cfg.list, dayOf, ds, nowIso));
      const vessels: SanctionedVessel[] = parsed.designees
        .filter((d) => d.kind === 'vessel' && (d.imo || d.mmsi))
        .map((d) => ({ name: d.name, imo: d.imo, mmsi: d.mmsi, list: cfg.list, programs: d.programs.slice(0, 3) }));
      return {
        events,
        rejected: [],
        itemsSeen: parsed.designees.length,
        notModified: false,
        state: packState(parsed.designees.map((d) => d.id), vessels, { publishedOn: parsed.publishedOn, lastFetchedAt: nowIso, validators: res.validators }),
      };
    },
  };
}

const MB = 1024 * 1024;
export const ofacSdn = makeAdapter({
  list: 'ofac',
  url: 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML',
  parse: parseOfacSdn,
  everyHours: 0, // conditional request (ETag) every run: OFAC publishes at any hour
  limits: { maxBytes: 64 * MB, timeoutMs: 90_000 },
});
export const euSanctions = makeAdapter({
  list: 'eu',
  url: 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw',
  parse: parseEuList,
  everyHours: 23, // the file takes over a minute to generate: once a day
  limits: { maxBytes: 64 * MB, timeoutMs: 180_000 },
});
export const ukSanctions = makeAdapter({
  list: 'uk',
  url: 'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml',
  parse: parseUkList,
  everyHours: 6,
  limits: { maxBytes: 64 * MB, timeoutMs: 90_000 },
});
