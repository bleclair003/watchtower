import type {
  Credibility,
  EventCategory,
  IntelligenceEvent,
  LocationPrecision,
  SourceClass,
} from '@shared/domain/types';

/**
 * ============================================================================
 *  DEMONSTRATION DATA — ENTIRELY FICTIONAL
 * ============================================================================
 *  Every record below is invented to exercise the interface. None describe
 *  real events. Each record has dataOrigin = 'demo', an empty sourceUrl, a
 *  "[SIMULATED]" title prefix, and a source name beginning with "DEMO".
 *  Timestamps are generated relative to load time so the dashboard is
 *  exercisable; they do not correspond to anything that happened.
 * ============================================================================
 */

interface DemoSeed {
  h: number; // hours before load time (published)
  lag?: number; // minutes between publication and collection
  src: keyof typeof DEMO_SOURCES;
  cat: EventCategory;
  regions: string[];
  cc: string[];
  title: string;
  summary: string;
  cred: Credibility;
  loc?: [number, number, LocationPrecision];
  occurredH?: number;
}

export const DEMO_SOURCES = {
  'demo-advisory': { name: 'DEMO // Travel Advisory format', cls: 'official' as SourceClass },
  'demo-defense': { name: 'DEMO // Defense Ministry release format', cls: 'official' as SourceClass },
  'demo-maritime': { name: 'DEMO // Maritime Security Notice format', cls: 'official' as SourceClass },
  'demo-cyber': { name: 'DEMO // Cyber Agency Advisory format', cls: 'official' as SourceClass },
  'demo-aviation': { name: 'DEMO // Aviation Authority Notice format', cls: 'official' as SourceClass },
  'demo-news': { name: 'DEMO // News Aggregator format', cls: 'media' as SourceClass },
  'demo-hazard': { name: 'DEMO // Hazard Monitoring format', cls: 'scientific' as SourceClass },
} as const;

const SEEDS: DemoSeed[] = [
  // Red Sea / Gulf of Aden
  { h: 0.6, src: 'demo-maritime', cat: 'maritime', regions: ['red-sea'], cc: ['YE'], cred: 'official',
    title: 'Merchant vessel reports suspicious approach by small craft',
    summary: 'Fictional maritime notice: master reports two skiffs approaching to 1 nm before withdrawing. No damage reported.',
    loc: [14.2, 42.1, 'exact'], occurredH: 1.4 },
  { h: 5, src: 'demo-maritime', cat: 'maritime', regions: ['red-sea'], cc: ['DJ'], cred: 'official',
    title: 'Advisory: increased caution for transits near Bab el-Mandeb',
    summary: 'Fictional advisory urging vessels to maintain watch and report suspicious activity.', loc: [12.6, 43.4, 'exact'] },
  { h: 9, src: 'demo-news', cat: 'economic', regions: ['red-sea'], cc: [], cred: 'single-source',
    title: 'Shipping operator said to be reviewing Red Sea routing',
    summary: 'Fictional media report citing an unnamed source. Not confirmed by the operator.' },
  { h: 30, src: 'demo-maritime', cat: 'maritime', regions: ['red-sea'], cc: ['SO'], cred: 'official',
    title: 'Vessel reports unidentified UAV overflight, Gulf of Aden',
    summary: 'Fictional notice. Crew safe; vessel proceeding.', loc: [12.1, 47.9, 'exact'] },

  // Middle East
  { h: 1.5, src: 'demo-advisory', cat: 'diplomatic', regions: ['middle-east'], cc: ['LB'], cred: 'official',
    title: 'Travel advisory reissued at Level 3 (format test)',
    summary: 'Fictional advisory change used to test level-change detection. Country-level only — no point location.',
    loc: [0, 0, 'country'] },
  { h: 3, src: 'demo-defense', cat: 'military', regions: ['middle-east'], cc: ['IQ'], cred: 'official',
    title: 'Statement on scheduled multinational training activity',
    summary: 'Fictional release announcing a routine, pre-planned exercise.', loc: [33.3, 44.4, 'city'] },
  { h: 7, src: 'demo-aviation', cat: 'aviation', regions: ['middle-east'], cc: ['IR'], cred: 'official',
    title: 'Notice to operators: temporary airspace restriction (format test)',
    summary: 'Fictional aviation notice. Region-level only.', loc: [0, 0, 'region'] },
  { h: 14, src: 'demo-news', cat: 'unrest', regions: ['middle-east'], cc: ['JO'], cred: 'unverified',
    title: 'Social media posts claim large gathering in capital',
    summary: 'Fictional unverified claim. Included to test credibility labelling.', loc: [31.95, 35.93, 'city'] },
  { h: 26, src: 'demo-defense', cat: 'military', regions: ['middle-east'], cc: ['SY'], cred: 'official',
    title: 'Press release: completion of logistics movement',
    summary: 'Fictional routine release.', loc: [0, 0, 'country'] },
  { h: 40, src: 'demo-news', cat: 'diplomatic', regions: ['middle-east'], cc: ['QA'], cred: 'corroborated',
    title: 'Multiple outlets report talks scheduled for next week',
    summary: 'Fictional item marked corroborated to test the classification badge.', loc: [25.29, 51.53, 'city'] },

  // Eastern Europe
  { h: 0.3, src: 'demo-news', cat: 'military', regions: ['eastern-europe'], cc: ['UA'], cred: 'single-source',
    title: 'Regional outlet reports air-defence activity overnight',
    summary: 'Fictional single-source report. No official confirmation in demo dataset.', loc: [0, 0, 'country'] },
  { h: 4, src: 'demo-advisory', cat: 'diplomatic', regions: ['eastern-europe'], cc: ['BY'], cred: 'official',
    title: 'Travel advisory unchanged at Level 4 (periodic reissue)',
    summary: 'Fictional reissue with no level change — should NOT be treated as escalation.', loc: [0, 0, 'country'] },
  { h: 11, src: 'demo-defense', cat: 'military', regions: ['eastern-europe'], cc: ['PL'], cred: 'official',
    title: 'Announcement of allied air-policing rotation',
    summary: 'Fictional scheduled rotation announcement.', loc: [52.23, 21.01, 'city'] },
  { h: 20, src: 'demo-cyber', cat: 'cyber', regions: ['eastern-europe', 'global-cyber'], cc: ['MD'], cred: 'official',
    title: 'Advisory: phishing campaign targeting public-sector email',
    summary: 'Fictional advisory used to test multi-region assignment.' },
  { h: 52, src: 'demo-news', cat: 'economic', regions: ['eastern-europe'], cc: ['UA'], cred: 'single-source',
    title: 'Grain shipment schedule reportedly revised',
    summary: 'Fictional economic item.', loc: [46.48, 30.72, 'city'] },

  // Taiwan Strait
  { h: 2, src: 'demo-defense', cat: 'military', regions: ['taiwan-strait'], cc: ['TW'], cred: 'official',
    title: 'Daily report format: aircraft and vessels detected in vicinity',
    summary: 'Fictional daily-count style release. Counts intentionally omitted from demo.', loc: [0, 0, 'region'] },
  { h: 18, src: 'demo-news', cat: 'diplomatic', regions: ['taiwan-strait'], cc: ['TW'], cred: 'single-source',
    title: 'Commentary piece on cross-strait statements',
    summary: 'Fictional media commentary — low evidential weight.' },
  { h: 28, src: 'demo-maritime', cat: 'maritime', regions: ['taiwan-strait'], cc: ['TW'], cred: 'official',
    title: 'Navigational warning: live-fire area declared (format test)',
    summary: 'Fictional navigational warning with a declared area.', loc: [24.4, 119.6, 'exact'] },

  // Korean Peninsula
  { h: 6, src: 'demo-defense', cat: 'military', regions: ['korean-peninsula'], cc: ['KR'], cred: 'official',
    title: 'Joint Chiefs format: detection of projectile launch',
    summary: 'Fictional launch-report format. Used to test high-severity rendering in later phases.', loc: [39.0, 125.75, 'city'], occurredH: 6.5 },
  { h: 8, src: 'demo-news', cat: 'military', regions: ['korean-peninsula'], cc: ['KP'], cred: 'corroborated',
    title: 'Multiple outlets relay launch report',
    summary: 'Fictional — duplicate coverage of the item above. Should be de-weighted, not double counted.' },
  { h: 47, src: 'demo-advisory', cat: 'diplomatic', regions: ['korean-peninsula'], cc: ['KR'], cred: 'official',
    title: 'Embassy message: routine civil-defence drill notice',
    summary: 'Fictional routine notice.', loc: [37.57, 126.98, 'city'] },

  // South China Sea
  { h: 3.5, src: 'demo-maritime', cat: 'maritime', regions: ['south-china-sea'], cc: ['PH'], cred: 'official',
    title: 'Coast guard statement on vessel encounter near shoal',
    summary: 'Fictional coast-guard statement. Location approximate to shoal.', loc: [15.15, 117.76, 'exact'] },
  { h: 22, src: 'demo-news', cat: 'maritime', regions: ['south-china-sea'], cc: ['VN'], cred: 'single-source',
    title: 'Fishing association reports harassment of vessels',
    summary: 'Fictional single-source report.', loc: [0, 0, 'region'] },
  { h: 60, src: 'demo-hazard', cat: 'disaster', regions: ['south-china-sea'], cc: ['PH'], cred: 'official',
    title: 'Tropical storm advisory issued',
    summary: 'Fictional hazard advisory.', loc: [13.5, 123.0, 'exact'] },

  // Global cyber
  { h: 1, src: 'demo-cyber', cat: 'cyber', regions: ['global-cyber'], cc: [], cred: 'official',
    title: 'Known-exploited vulnerability added to catalog (format test)',
    summary: 'Fictional KEV-style addition. Non-geographic — appears in feed, not on map.' },
  { h: 12, src: 'demo-cyber', cat: 'cyber', regions: ['global-cyber'], cc: [], cred: 'official',
    title: 'Joint advisory: ransomware actor tactics',
    summary: 'Fictional multi-agency advisory format.' },
  { h: 33, src: 'demo-news', cat: 'cyber', regions: ['global-cyber'], cc: [], cred: 'unverified',
    title: 'Claim of breach at logistics provider posted on forum',
    summary: 'Fictional unverified claim — should never be presented as confirmed.' },

  // Unassigned / global
  { h: 2.5, src: 'demo-hazard', cat: 'disaster', regions: [], cc: ['CL'], cred: 'official',
    title: 'M6.1 earthquake format test',
    summary: 'Fictional seismic record outside all watch regions — tests that unrelated events still map.', loc: [-31.2, -71.5, 'exact'] },
  { h: 15, src: 'demo-news', cat: 'official', regions: [], cc: [], cred: 'single-source',
    title: 'International organization schedules emergency session',
    summary: 'Fictional item with no geography.' },
];

/** Builds the demo dataset relative to `now` (ms epoch). */
export function buildDemoEvents(now: number = Date.now()): IntelligenceEvent[] {
  return SEEDS.map((s, i) => {
    const published = now - s.h * 3_600_000;
    const collected = published + (s.lag ?? 7 + ((i * 13) % 40)) * 60_000;
    const [lat, lon, precision] = s.loc ?? [undefined, undefined, 'none' as LocationPrecision];
    const precise = precision === 'exact' || precision === 'city';
    const src = DEMO_SOURCES[s.src];
    return {
      id: `demo-${String(i + 1).padStart(3, '0')}`,
      dataOrigin: 'demo',
      sourceId: s.src,
      sourceName: src.name,
      sourceClass: src.cls,
      sourceUrl: '',
      title: `[SIMULATED] ${s.title}`,
      summary: s.summary,
      category: s.cat,
      regionIds: s.regions,
      countryCodes: s.cc,
      publishedAt: new Date(published).toISOString(),
      occurredAt: s.occurredH != null ? new Date(now - s.occurredH * 3_600_000).toISOString() : null,
      collectedAt: new Date(Math.min(collected, now)).toISOString(),
      credibility: s.cred,
      verificationStatus: 'unreviewed',
      ...(precise ? { latitude: lat, longitude: lon } : {}),
      locationPrecision: precision,
      contentHash: `demo-${i + 1}`,
    } satisfies IntelligenceEvent;
  });
}
