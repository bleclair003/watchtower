import { WATCH_REGIONS } from '../regions.ts';
import { SOURCE_REGISTRY } from '../sources.ts';
import { validateCondition } from './conditions.ts';
import type { IndicatorDefinition } from './types.ts';

/**
 * Indicator catalog v1.
 *
 * Only indicators that can be evaluated from sources WATCHTOWER actually
 * collects are enabled. Thresholds are initial engineering judgements, NOT
 * empirically validated — Phase 6 backtesting exists to revise them.
 *
 * Changing any definition: bump its configVersion and CATALOG_VERSION.
 */
export const CATALOG_VERSION = 2;

const STATE = 'state-travel-advisories';
const KEV = 'cisa-kev';
const CISA = 'cisa-advisories';

/** Geographic watch regions that the State Dept feed can inform. */
const ADVISORY_REGIONS = WATCH_REGIONS.filter((r) => r.countryCodes.length > 0);

const advisoryIndicators: IndicatorDefinition[] = ADVISORY_REGIONS.flatMap((r) => [
  {
    id: `${r.id}.advisory-raised`,
    name: `${r.shortCode} travel advisory raised`,
    description: `A U.S. State Department travel advisory for a country in ${r.name} was raised to a higher level in the last 7 days.`,
    family: 'diplomatic',
    regionId: r.id,
    requiredSourceIds: [STATE],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: STATE },
        { field: 'regionIds', op: 'contains', value: r.id },
        { field: 'metadata.change', op: 'eq', value: 'raised' },
      ],
    },
    windowHours: 168,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 1 },
    baseline: null,
    weight: 3,
    severity: 'high',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale:
      'A level increase is a deliberate official reassessment of risk. It reflects the U.S. government view of risk to travellers, not a forecast of conflict.',
  },
  {
    id: `${r.id}.advisory-activity`,
    name: `${r.shortCode} advisory publication burst`,
    description: `Several State Department advisories for ${r.name} countries were published or reissued within 72 hours.`,
    family: 'official-activity',
    regionId: r.id,
    requiredSourceIds: [STATE],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: STATE },
        { field: 'regionIds', op: 'contains', value: r.id },
      ],
    },
    windowHours: 72,
    elevated: { countAtLeast: 2 },
    triggered: { countAtLeast: 4 },
    baseline: { days: 28, triggerRatio: 3, elevatedRatio: 2 },
    weight: 2,
    severity: 'medium',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale:
      'Coordinated reissues across several neighbouring countries often accompany a regional security reassessment. Routine periodic reviews also produce bursts, so this is weighted below a level change.',
  },
]);

const cyberIndicators: IndicatorDefinition[] = [
  {
    id: 'global-cyber.kev-surge',
    name: 'KEV addition surge',
    description: 'Unusually many vulnerabilities were added to CISA’s Known Exploited Vulnerabilities catalog within 72 hours.',
    family: 'cyber',
    regionId: 'global-cyber',
    requiredSourceIds: [KEV],
    match: { field: 'sourceId', op: 'eq', value: KEV },
    windowHours: 72,
    elevated: { countAtLeast: 4 },
    triggered: { countAtLeast: 8 },
    baseline: { days: 28, triggerRatio: 2.5, elevatedRatio: 1.5 },
    weight: 2,
    severity: 'medium',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale: 'KEV additions confirm active exploitation in the wild. A surge relative to baseline suggests elevated exploitation activity.',
  },
  {
    id: 'global-cyber.kev-ransomware',
    name: 'Ransomware-linked KEV additions',
    description: 'KEV additions flagged by CISA as used in known ransomware campaigns, last 7 days.',
    family: 'cyber',
    regionId: 'global-cyber',
    requiredSourceIds: [KEV],
    match: { all: [{ field: 'sourceId', op: 'eq', value: KEV }, { field: 'metadata.knownRansomwareUse', op: 'eq', value: true }] },
    windowHours: 168,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 3 },
    baseline: null,
    weight: 2,
    severity: 'high',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale: 'Ransomware-linked exploitation has a direct disruptive impact on infrastructure and services.',
  },
  {
    id: 'global-cyber.cisa-nonroutine',
    name: 'Non-routine CISA advisories',
    description:
      'CISA alerts, joint advisories and analysis reports in the last 72 hours. Excludes routine ICS product advisories, guidance documents, and KEV-addition announcements (those are counted by the KEV indicators).',
    family: 'cyber',
    regionId: 'global-cyber',
    requiredSourceIds: [CISA],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: CISA },
        { field: 'metadata.subtype', op: 'in', value: ['alert', 'joint-advisory', 'analysis-report'] },
        // Also catches KEV announcements stored before they were classified separately.
        { not: { field: 'title', op: 'contains', value: 'Known Exploited Vulnerabilit' } },
      ],
    },
    windowHours: 72,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 3 },
    baseline: null,
    weight: 2,
    severity: 'medium',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale: 'Alerts and joint advisories are issued for significant campaigns, unlike routine vendor vulnerability notices.',
  },
];

const experimentalIndicators: IndicatorDefinition[] = [
  {
    id: 'experimental.pentagon-pizza',
    name: 'Pentagon Pizza Index',
    description: 'Hypothesis: unusual late-night restaurant activity near major government facilities correlates with extraordinary work schedules.',
    family: 'experimental',
    regionId: 'global',
    requiredSourceIds: ['pentagon-pizza'],
    match: { field: 'sourceId', op: 'eq', value: 'pentagon-pizza' },
    windowHours: 24,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 1 },
    baseline: null,
    weight: 0,
    severity: 'low',
    experimental: true,
    enabled: true,
    configVersion: 1,
    rationale:
      'No legal, free, historical aggregate data source exists; popularity estimates are not order counts. Preserved as an untestable research concept and never fed fabricated values.',
    research: {
      hypothesis: 'Late-night food orders near the Pentagon rise before major U.S. military operations because staff work unusual hours.',
      dataAvailability: 'None. Map-service "popular times" are modelled popularity estimates (not orders), have no free API, and scraping them breaches provider terms.',
      baselinePeriod: 'Not applicable without data.',
      expectedRelationship: 'If real: an anomaly would precede publicly announced operations by hours to days.',
      historicalExamples: 'Anecdotes are widely shared after the fact. No systematic, pre-registered evaluation is known to WATCHTOWER.',
      confounders: 'Sports events, weather, holidays, local events, restaurant promotions, and normal shift patterns.',
      falsePositives: 'Expected to be frequent; unknown because untested.',
      retrospectiveResults: 'Not testable: no data.',
      evidenceQuality: 'anecdotal',
    },
  },
  {
    id: 'experimental.state-reissue-tempo',
    name: 'State Dept advisory tempo (global)',
    description: 'All State Department advisory publications worldwide in 72 hours, compared with the 28-day baseline.',
    family: 'experimental',
    regionId: 'global',
    requiredSourceIds: [STATE],
    match: { field: 'sourceId', op: 'eq', value: STATE },
    windowHours: 72,
    elevated: { countAtLeast: 6 },
    triggered: { countAtLeast: 12 },
    baseline: { days: 28, triggerRatio: 3, elevatedRatio: 2 },
    weight: 0,
    severity: 'low',
    experimental: true,
    enabled: true,
    configVersion: 1,
    rationale: 'Tests whether a surge in official publication tempo, regardless of region, precedes significant developments. Unvalidated, so it never affects the RAI.',
    research: {
      hypothesis: 'Bursts of advisory publications across many countries reflect a government-wide security reassessment.',
      dataAvailability: 'Available: collected hourly from the State Department advisories feed since 2026-11-20.',
      baselinePeriod: '28 days of collection. Not yet available, so fixed thresholds apply.',
      expectedRelationship: 'A burst would coincide with or precede regional escalations already visible in other indicators.',
      historicalExamples: 'The 23 Oct 2026 batch of 13 Middle East reissues is the only burst in the collected data so far.',
      confounders: 'Scheduled periodic reviews, administrative template changes, and holiday publication backlogs.',
      falsePositives: 'Likely, because routine annual reviews are published in batches.',
      retrospectiveResults: 'Insufficient history. Re-run in Signal Lab once 90+ days are collected.',
      evidenceQuality: 'none',
    },
  },
];

export const INDICATOR_CATALOG: IndicatorDefinition[] = [...advisoryIndicators, ...cyberIndicators, ...experimentalIndicators];

export function getIndicator(id: string): IndicatorDefinition | undefined {
  return INDICATOR_CATALOG.find((d) => d.id === id);
}

/** Structural checks for a set of definitions; returns problems (empty = valid). */
export function validateCatalog(defs: IndicatorDefinition[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const regionIds = new Set([...WATCH_REGIONS.map((r) => r.id), 'global']);
  const sourceIds = new Set(SOURCE_REGISTRY.map((s) => s.id));
  for (const d of defs) {
    const p = (msg: string) => problems.push(`${d.id}: ${msg}`);
    if (ids.has(d.id)) p('duplicate id');
    ids.add(d.id);
    if (!regionIds.has(d.regionId)) p(`unknown region ${d.regionId}`);
    if (!d.requiredSourceIds.length) p('no required sources');
    d.requiredSourceIds.filter((s) => !sourceIds.has(s)).forEach((s) => p(`unknown source ${s}`));
    validateCondition(d.match).forEach(p);
    if (d.elevated.countAtLeast < 1 || d.triggered.countAtLeast < 1) p('thresholds must be ≥ 1');
    if (d.elevated.countAtLeast > d.triggered.countAtLeast) p('elevated threshold exceeds triggered threshold');
    if (d.windowHours <= 0 || d.windowHours > 24 * 30) p('window must be 1 h – 30 d');
    if (d.baseline && (d.baseline.days < 1 || d.baseline.triggerRatio < d.baseline.elevatedRatio)) p('invalid baseline');
    if (d.weight < 0) p('negative weight');
    if (d.experimental && d.weight !== 0) p('experimental indicators must have weight 0');
    if (!d.experimental && d.regionId === 'global') p('non-experimental indicators need a watch region');
  }
  return problems;
}
