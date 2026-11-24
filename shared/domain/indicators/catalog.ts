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
export const CATALOG_VERSION = 26;

const STATE = 'state-travel-advisories';
const KEV = 'cisa-kev';
const CISA = 'cisa-advisories';

/** Geographic watch regions (with countries). */
const ADVISORY_REGIONS = WATCH_REGIONS.filter((r) => r.countryCodes.length > 0);
/** Regions the State Dept travel-advisory feed can inform (it publishes no advisory for the US). */
const STATE_DEPT_REGIONS = ADVISORY_REGIONS.filter((r) => r.id !== 'united-states');
const US = 'united-states';

const advisoryIndicators: IndicatorDefinition[] = STATE_DEPT_REGIONS.flatMap((r) => [
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

const FCDO = 'uk-fcdo-travel';
const IODA = 'ioda-outages';
const USGS = 'usgs-earthquakes';
const MEDIA = ['bbc-world', 'aljazeera'];

/** Indicators from the v0.8 source expansion (UK FCDO, IODA, USGS, media). */
const expansionIndicators: IndicatorDefinition[] = [
  ...ADVISORY_REGIONS.flatMap((r): IndicatorDefinition[] => [
    {
      id: `${r.id}.fcdo-updates`,
      name: `${r.shortCode} UK travel advice updates`,
      description: `UK FCDO travel advice for ${r.name} countries was updated within 72 hours.`,
      family: 'diplomatic',
      regionId: r.id,
      requiredSourceIds: [FCDO],
      match: {
        all: [
          { field: 'sourceId', op: 'eq', value: FCDO },
          { field: 'regionIds', op: 'contains', value: r.id },
        ],
      },
      windowHours: 72,
      elevated: { countAtLeast: 2 },
      triggered: { countAtLeast: 4 },
      baseline: { days: 28, triggerRatio: 3, elevatedRatio: 2 },
      weight: 1,
      severity: 'medium',
      experimental: false,
      enabled: true,
      configVersion: 1,
      rationale:
        'A second government’s travel-risk view, independent of the U.S. State Department. Many FCDO updates are routine edits (entry rules, contact details), so the weight is low and the change note should be read before acting.',
    },
    {
      id: `${r.id}.connectivity-drop`,
      name: `${r.shortCode} internet connectivity drop`,
      description: `IODA detected an internet connectivity drop of 4 h or more in a ${r.name} country within 48 hours.`,
      family: 'information-environment',
      regionId: r.id,
      requiredSourceIds: [IODA],
      match: {
        all: [
          { field: 'sourceId', op: 'eq', value: IODA },
          { field: 'regionIds', op: 'contains', value: r.id },
        ],
      },
      windowHours: 48,
      elevated: { countAtLeast: 1 },
      triggered: { countAtLeast: 3 },
      baseline: { days: 28, triggerRatio: 3, elevatedRatio: 2 },
      weight: 2,
      severity: 'medium',
      experimental: false,
      enabled: true,
      configVersion: 1,
      rationale:
        'Governments restrict connectivity during unrest and military operations. Power cuts, cable faults, scheduled exam-season shutdowns (e.g. Iraq, Syria) and measurement artefacts produce the same signal, so this is corroborating evidence, not proof.',
    },
    {
      id: `${r.id}.media-conflict-reporting`,
      name: `${r.shortCode} conflict-reporting volume (media)`,
      description: `BBC and Al Jazeera headlines about ${r.name} classified as military, compared with the 28-day baseline.`,
      family: 'experimental',
      regionId: r.id,
      requiredSourceIds: MEDIA,
      match: {
        all: [
          { field: 'sourceId', op: 'in', value: MEDIA },
          { field: 'regionIds', op: 'contains', value: r.id },
          { field: 'category', op: 'eq', value: 'military' },
        ],
      },
      windowHours: 24,
      elevated: { countAtLeast: 4, distinctSourcesAtLeast: 2 },
      triggered: { countAtLeast: 8, distinctSourcesAtLeast: 2 },
      baseline: { days: 28, triggerRatio: 3, elevatedRatio: 2 },
      weight: 0,
      severity: 'low',
      experimental: true,
      enabled: true,
      configVersion: 1,
      rationale:
        'Media attention rises with real escalation but also with news cycles, anniversaries and analysis pieces. Topic and region come from headline keywords. Unvalidated, so it never affects the RAI.',
      research: {
        hypothesis: 'A sharp rise in military-topic headlines about a region, across two independent outlets, accompanies or precedes escalation.',
        dataAvailability: 'Available: BBC World (4 section feeds) and Al Jazeera RSS collected hourly since 2026-11-20.',
        baselinePeriod: '28 days of collection. Not yet available, so fixed thresholds apply.',
        expectedRelationship: 'Coincident with escalation more often than leading it; the value is in confirming other indicators.',
        historicalExamples: 'None in collected data yet.',
        confounders: 'Editorial priorities, other big stories crowding out coverage, feature and analysis pieces, keyword misclassification.',
        falsePositives: 'Expected: retrospective coverage and opinion pieces use the same vocabulary.',
        retrospectiveResults: 'Insufficient history. Re-run in Signal Lab once 90+ days are collected.',
        evidenceQuality: 'weak',
      },
    },
  ]),
  {
    id: 'korean-peninsula.seismic-non-earthquake',
    name: 'KOREA non-earthquake seismic event',
    description: 'USGS classified a seismic event inside the Korean Peninsula watch area as something other than an earthquake (for example "explosion").',
    family: 'official-activity',
    regionId: 'korean-peninsula',
    requiredSourceIds: [USGS],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: USGS },
        { field: 'regionIds', op: 'contains', value: 'korean-peninsula' },
        { field: 'metadata.seismicType', op: 'neq', value: 'earthquake' },
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
      'North Korea’s nuclear tests were detected seismically, and USGS labels events it identifies as explosions. The feed only lists M4.5+, and the USGS label can change after review; read the USGS event page before drawing conclusions.',
  },
];

const FIRMS = 'nasa-firms';
const RADAR = 'cloudflare-radar-outages';

/** Free-key sources (v0.9). They report NO DATA until the key is configured. */
const freeKeyIndicators: IndicatorDefinition[] = ADVISORY_REGIONS.flatMap((r): IndicatorDefinition[] => [
  {
    id: `${r.id}.outage-attributed`,
    name: `${r.shortCode} shutdown or conflict-related outage`,
    description: `Cloudflare Radar attributed an internet outage in a ${r.name} country to a government-directed shutdown or military action within 7 days.`,
    family: 'information-environment',
    regionId: r.id,
    requiredSourceIds: [RADAR],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: RADAR },
        { field: 'regionIds', op: 'contains', value: r.id },
        { field: 'metadata.outageCause', op: 'in', value: ['GOVERNMENT_DIRECTED', 'MILITARY_ACTION'] },
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
      'A deliberate shutdown or an outage caused by fighting is a direct sign of unrest or military activity. The cause is Cloudflare analysts’ assessment, published after review, so it lags the outage itself.',
  },
  {
    id: `${r.id}.thermal-clusters`,
    name: `${r.shortCode} new satellite fire clusters`,
    description: `New clusters of NASA FIRMS fire detections in the ${r.name} watch area within 24 hours, compared with the 28-day baseline.`,
    family: 'experimental',
    regionId: r.id,
    requiredSourceIds: [FIRMS],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: FIRMS },
        { field: 'regionIds', op: 'contains', value: r.id },
      ],
    },
    windowHours: 24,
    elevated: { countAtLeast: 5 },
    triggered: { countAtLeast: 12 },
    baseline: { days: 28, triggerRatio: 3, elevatedRatio: 2 },
    weight: 0,
    severity: 'low',
    experimental: true,
    enabled: true,
    configVersion: 1,
    rationale:
      'Satellite fire detections have been used to track strikes and shelling, but most fires are agricultural, wildfires or industrial. Unvalidated and strongly seasonal, so it never affects the RAI.',
    research: {
      hypothesis: 'A burst of NEW fire clusters (cells with no fire for 7 days) in a watch area, above its baseline, accompanies strikes, shelling or sabotage.',
      dataAvailability: 'Available once FIRMS_MAP_KEY is configured: VIIRS NOAA-20 near-real-time detections, collected hourly.',
      baselinePeriod: '28 days of collection; harvest-season burning needs a full year to model properly.',
      expectedRelationship: 'Coincident with kinetic activity in front-line areas; little lead time.',
      historicalExamples: 'Open-source analysts have used FIRMS to map front-line fires in Ukraine since 2022. None in WATCHTOWER data yet.',
      confounders: 'Agricultural burning seasons, wildfires, gas flares (largely removed by the novelty filter), cloud cover hiding fires.',
      falsePositives: 'Expected to be frequent in spring and late summer.',
      retrospectiveResults: 'Insufficient history. Re-run in Signal Lab once 90+ days are collected.',
      evidenceQuality: 'weak',
    },
  },
]);

/** United States (domestic) indicators (v0.13). */
const NTAS = 'dhs-ntas';
const TFR = 'faa-tfr';
const usIndicators: IndicatorDefinition[] = [
  {
    id: `${US}.ntas-advisory`,
    name: 'USA NTAS terrorism advisory',
    description: 'DHS issued or updated a National Terrorism Advisory System bulletin or alert in the last 30 days.',
    family: 'official-activity',
    regionId: US,
    requiredSourceIds: [NTAS],
    match: { field: 'sourceId', op: 'eq', value: NTAS },
    windowHours: 720,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 1 },
    baseline: null,
    weight: 3,
    severity: 'high',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale: 'NTAS advisories are rare and issued only when DHS judges the terrorism threat to the homeland notable. An advisory describes a threat environment, not a specific imminent event unless it says so.',
  },
  {
    id: `${US}.installation-incident`,
    name: 'USA military-installation incident',
    description: 'Headlines about an incident (shooting, lockdown, explosion, breach, drone incursion …) involving the US military inside the US, within 72 hours.',
    family: 'official-activity',
    regionId: US,
    requiredSourceIds: ['war-gov-news'],
    match: {
      all: [
        { field: 'regionIds', op: 'contains', value: US },
        {
          any: ['shooting', 'shooter', 'lockdown', 'explosion', 'blast', 'breach', 'intruder', 'drone incursion', 'drone sighting', 'drones spotted', 'attack', 'killed', 'crash', 'sabotage', 'arrested'].map(
            (w) => ({ field: 'title' as const, op: 'contains' as const, value: w }),
          ),
        },
        {
          any: ['base', 'fort ', 'camp ', 'naval', 'air force', 'military', 'soldier', 'troops', 'marine', 'airman', 'sailor', 'national guard', 'pentagon', 'army', 'navy'].map(
            (w) => ({ field: 'title' as const, op: 'contains' as const, value: w }),
          ),
        },
      ],
    },
    windowHours: 72,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 2, distinctSourcesAtLeast: 2 },
    baseline: null,
    weight: 3,
    severity: 'high',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale:
      'Incidents at or involving installations inside the US (attacks, breaches, drone incursions) are direct domestic security events. Headline keywords also catch training accidents and court cases, so it triggers only when two independent sources report within 72 hours.',
  },
  {
    id: `${US}.guard-deployment`,
    name: 'USA National Guard deployment',
    description: 'Headlines about National Guard deployments, activations or federalisation inside the US, within 7 days.',
    family: 'official-activity',
    regionId: US,
    requiredSourceIds: ['war-gov-news'],
    match: {
      all: [
        { field: 'regionIds', op: 'contains', value: US },
        { field: 'title', op: 'contains', value: 'national guard' },
        {
          any: ['deploy', 'activat', 'mobiliz', 'mobilis', 'federaliz', 'federalis', 'sent to', 'troops to', 'patrol'].map(
            (w) => ({ field: 'title' as const, op: 'contains' as const, value: w }),
          ),
        },
      ],
    },
    windowHours: 168,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 3 },
    baseline: null,
    weight: 2,
    severity: 'medium',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale: 'Guard deployments accompany unrest, disasters, border operations and security events. Disaster deployments are common, so read the reports before drawing conclusions.',
  },
  {
    id: `${US}.security-tfr-burst`,
    name: 'USA security flight restrictions',
    description: 'New FAA national-defence (SECURITY) temporary flight restrictions in 72 hours, compared with the 28-day baseline.',
    family: 'aviation',
    regionId: US,
    requiredSourceIds: [TFR],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: TFR },
        { field: 'metadata.tfrType', op: 'eq', value: 'SECURITY' },
      ],
    },
    windowHours: 72,
    elevated: { countAtLeast: 5 },
    triggered: { countAtLeast: 10 },
    baseline: { days: 28, triggerRatio: 3, elevatedRatio: 2 },
    weight: 2,
    severity: 'medium',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale:
      'SECURITY TFRs protect military installations, critical infrastructure and major events. A burst above baseline can reflect drone incursions or a security operation; many are routine (stadiums, theme parks, scheduled events).',
  },
  {
    id: `${US}.major-disaster`,
    name: 'USA major disaster or extreme weather',
    description: 'FEMA major-disaster declarations or NWS Extreme alerts in 72 hours.',
    family: 'official-activity',
    regionId: US,
    requiredSourceIds: ['fema-declarations'],
    match: {
      any: [
        { all: [{ field: 'sourceId', op: 'eq', value: 'fema-declarations' }, { field: 'metadata.declarationType', op: 'eq', value: 'DR' }] },
        { field: 'sourceId', op: 'eq', value: 'nws-alerts' },
      ],
    },
    windowHours: 72,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 3 },
    baseline: null,
    weight: 1,
    severity: 'medium',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale: 'Major disasters stretch emergency services and the National Guard. Weighted low: they are hazards, not security events.',
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
      dataAvailability: 'None for pizza: map-service "popular times" are modelled popularity estimates (not orders), have no free API, and scraping them breaches provider terms. A stand-in is live since v0.36.0: the Pentagon after-hours meter (night-time defence publishing and government command/VIP flights, US Eastern), on the METERS page and in the lead/lag lab.',
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

const AIR = 'adsb-military';

const AIR_RESEARCH = {
  dataAvailability: 'Collected every 30 minutes from the adsb.lol military feed since 2026-11-21. Only aircraft that broadcast ADS-B are seen.',
  baselinePeriod: '14 days of collection. Until then the fixed thresholds apply.',
  confounders: 'Receiver coverage (sparse over the Gulf, Red Sea and Taiwan Strait), exercises, routine training and deployments, weekdays vs weekends, transponder policy changes.',
  falsePositives: 'Likely: exercises and scheduled rotations look the same as a surge.',
  retrospectiveResults: 'Insufficient history. Re-run in Signal Lab once 90+ days are collected.',
  evidenceQuality: 'none' as const,
};

/** Phase 13: military aircraft on ADS-B. Experimental (weight 0) until backtested. */
const aircraftIndicators: IndicatorDefinition[] = ADVISORY_REGIONS.flatMap((r): IndicatorDefinition[] => [
  {
    id: `${r.id}.strategic-air`,
    name: `${r.shortCode} tanker, surveillance and bomber activity`,
    description: `Tankers, surveillance or command aircraft and bombers seen on ADS-B in the ${r.name} watch area within 24 hours (each aircraft once a day), compared with the 14-day baseline.`,
    family: 'experimental',
    regionId: r.id,
    requiredSourceIds: [AIR],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: AIR },
        { field: 'regionIds', op: 'contains', value: r.id },
        { field: 'metadata.aircraftClass', op: 'in', value: ['tanker', 'isr', 'bomber'] },
      ],
    },
    windowHours: 24,
    elevated: { countAtLeast: 3 },
    triggered: { countAtLeast: 6 },
    baseline: { days: 14, triggerRatio: 3, elevatedRatio: 2 },
    weight: 0,
    severity: 'low',
    experimental: true,
    enabled: true,
    configVersion: 1,
    rationale:
      'Tankers and surveillance aircraft gather before and during air operations, and their tracks are routinely followed by open-source analysts. Thresholds are initial guesses; most military flights are not visible on ADS-B, so this can only show activity that chooses to be seen.',
    research: {
      hypothesis: 'More tankers, surveillance aircraft and bombers than usual in a watch area accompany or precede air operations and crises.',
      expectedRelationship: 'A surge would precede or coincide with strikes, exercises or crisis deployments visible in other indicators.',
      historicalExamples: 'None in WATCHTOWER data yet (collection started 2026-11-21).',
      ...AIR_RESEARCH,
    },
  },
  ...(r.id === US
    ? []
    : ([
        {
          id: `${r.id}.airlift`,
          name: `${r.shortCode} military airlift activity`,
          description: `Military transport aircraft (C-17, C-5, A400M, Il-76, C-130 and similar) seen on ADS-B in the ${r.name} watch area within 24 hours (each aircraft once a day), compared with the 14-day baseline.`,
          family: 'experimental' as const,
          regionId: r.id,
          requiredSourceIds: [AIR],
          match: {
            all: [
              { field: 'sourceId', op: 'eq' as const, value: AIR },
              { field: 'regionIds', op: 'contains' as const, value: r.id },
              { field: 'metadata.aircraftClass', op: 'eq' as const, value: 'airlift' },
            ],
          },
          windowHours: 24,
          elevated: { countAtLeast: 4 },
          triggered: { countAtLeast: 8 },
          baseline: { days: 14, triggerRatio: 3, elevatedRatio: 2 },
          weight: 0,
          severity: 'low' as const,
          experimental: true,
          enabled: true,
          configVersion: 1,
          rationale:
            'An airlift surge (equipment, munitions, evacuation) is a classic sign of a deployment or crisis. Airlift is also routine logistics, so only a rise against the baseline matters. Not used for the US, where airlift is constant.',
          research: {
            hypothesis: 'More military transport flights than usual into a watch area accompany deployments, resupply and evacuations.',
            expectedRelationship: 'A surge would precede or coincide with deployments or evacuations reported by other sources.',
            historicalExamples: 'None in WATCHTOWER data yet (collection started 2026-11-21).',
            ...AIR_RESEARCH,
          },
        },
      ] satisfies IndicatorDefinition[])),
  {
    id: `${r.id}.air-patterns`,
    name: `${r.shortCode} unusual aircraft movement`,
    description: `Unusual movement by military aircraft on ADS-B in the ${r.name} watch area within 72 hours: a tanker, surveillance aircraft or bomber holding where that kind has not held in 30 days, an aircraft type not seen in the area in 30 days, three or more strategic aircraft together where no such group has been seen in 30 days, or military aircraft in an hour that has been empty on nearly all of the last 14 days.`,
    family: 'experimental',
    regionId: r.id,
    requiredSourceIds: [AIR],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: AIR },
        { field: 'regionIds', op: 'contains', value: r.id },
        { field: 'metadata.subtype', op: 'eq', value: 'aircraft-pattern' },
      ],
    },
    windowHours: 72,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 3 },
    baseline: null,
    weight: 0,
    severity: 'low',
    experimental: true,
    enabled: true,
    configVersion: 2,
    rationale:
      'Volume indicators count how many aircraft are seen; this one looks at what they do. A new orbit or a type that has not been in the area for a month is the kind of change open-source analysts look for. It flags nothing for the first 14 days of collection, while WATCHTOWER learns what is usual.',
    research: {
      hypothesis: 'New holding areas and newly arrived aircraft types precede or accompany air operations and deployments.',
      expectedRelationship: 'Records would cluster before or during strikes, exercises or deployments reported by other sources.',
      historicalExamples: 'None in WATCHTOWER data yet (pattern detection started 2026-11-22; holds and types flag from 2026-12-06; groups and unusual hours, added 2026-11-23, from about 2026-12-07).',
      ...AIR_RESEARCH,
      baselinePeriod: 'None: each record is already a comparison with the last 30 days of positions.',
      falsePositives: 'Likely: new training areas, exercises, one-off ferry flights (often in groups, at odd hours), and receiver coverage changing where aircraft can be seen.',
    },
  },
]);

const FLEET = 'usni-fleet-tracker';
/** Regions with sea areas in the USNI tracker. */
const FLEET_REGIONS = ['middle-east', 'red-sea', 'eastern-europe', 'south-china-sea', 'taiwan-strait', 'korean-peninsula'];

/** Phase 13: US Navy big-deck arrivals (USNI News Fleet Tracker, weekly). */
const fleetIndicators: IndicatorDefinition[] = ADVISORY_REGIONS.filter((r) => FLEET_REGIONS.includes(r.id)).map(
  (r): IndicatorDefinition => ({
    id: `${r.id}.carrier-arrival`,
    name: `${r.shortCode} US carrier or big-deck arrival`,
    description: `A US aircraft carrier or amphibious assault ship newly listed in a ${r.name} sea area by the USNI News Fleet Tracker within 21 days.`,
    family: 'maritime',
    regionId: r.id,
    requiredSourceIds: [FLEET],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: FLEET },
        { field: 'regionIds', op: 'contains', value: r.id },
        { field: 'metadata.change', op: 'in', value: ['arrived', 'moved'] },
        { field: 'metadata.hullType', op: 'in', value: ['CVN', 'LHA', 'LHD'] },
      ],
    },
    windowHours: 21 * 24,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 2 },
    baseline: null,
    weight: 2,
    severity: 'medium',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale:
      'Moving a carrier or amphibious group into a region is a deliberate, costly signal of US posture, and two arrivals within three weeks is a surge. The tracker is weekly and approximate, and a relief in place (one carrier replacing another) also counts as an arrival.',
  }),
);

const PORTWATCH = 'imf-portwatch-chokepoints';
/** Watch regions with a chokepoint (shared/domain/chokepoints.ts). */
const CHOKEPOINT_REGIONS: Record<string, string> = { 'middle-east': 'Strait of Hormuz', 'red-sea': 'Bab el-Mandeb', 'eastern-europe': 'Bosporus', 'taiwan-strait': 'Taiwan Strait' };

/** Phase 13: chokepoint traffic (IMF PortWatch). Records repeat weekly while a disruption lasts. */
const chokepointIndicators: IndicatorDefinition[] = ADVISORY_REGIONS.filter((r) => r.id in CHOKEPOINT_REGIONS).flatMap((r): IndicatorDefinition[] => {
  const cp = CHOKEPOINT_REGIONS[r.id];
  const base = (statuses: string[]) => ({
    all: [
      { field: 'sourceId' as const, op: 'eq' as const, value: PORTWATCH },
      { field: 'regionIds' as const, op: 'contains' as const, value: r.id },
      { field: 'metadata.status' as const, op: 'in' as const, value: statuses },
    ],
  });
  return [
    {
      id: `${r.id}.chokepoint-reduced`,
      name: `${r.shortCode} ${cp} traffic reduced`,
      description: `Ship transits through the ${cp} averaged under 70% of the 2025 daily average over 7 days (IMF PortWatch), reported within 8 days.`,
      family: 'maritime',
      regionId: r.id,
      requiredSourceIds: [PORTWATCH],
      match: base(['reduced', 'severe']),
      windowHours: 8 * 24,
      elevated: { countAtLeast: 1 },
      triggered: { countAtLeast: 2 },
      baseline: null,
      weight: 1,
      severity: 'medium',
      experimental: false,
      enabled: true,
      configVersion: 1,
      rationale:
        'Falling traffic through a strategic strait reflects risk, threats or restrictions that shipping companies act on with real money. Data runs about 6 days behind, so this confirms rather than warns.',
    },
    {
      id: `${r.id}.chokepoint-severe`,
      name: `${r.shortCode} ${cp} traffic severely reduced or falling fast`,
      description: `Ship transits through the ${cp} under 40% of the 2025 average, or 40% below the previous four weeks, over 7 days (IMF PortWatch), reported within 8 days.`,
      family: 'maritime',
      regionId: r.id,
      requiredSourceIds: [PORTWATCH],
      match: base(['severe', 'sudden-drop']),
      windowHours: 8 * 24,
      elevated: { countAtLeast: 1 },
      triggered: { countAtLeast: 1 },
      baseline: null,
      weight: 3,
      severity: 'high',
      experimental: false,
      enabled: true,
      configVersion: 1,
      rationale:
        'A collapse or sudden fall in transits marks a blockade, attacks on shipping or a closure. Two to three days of AIS-dark traffic can lower counts too, so read the PortWatch page before drawing conclusions.',
    },
  ];
});

const SANCTIONS = ['ofac-sdn', 'eu-sanctions', 'uk-sanctions'];
/** The EU file is slow to generate; its records count when present, but only OFAC and UK gate evaluation. */
const SANCTIONS_REQUIRED = ['ofac-sdn', 'uk-sanctions'];

/** Phase 13: new sanctions designations (OFAC, EU, UK). Not for the US region (designations target foreign countries). */
const sanctionsIndicators: IndicatorDefinition[] = STATE_DEPT_REGIONS.flatMap((r): IndicatorDefinition[] => {
  const base = [
    { field: 'sourceId' as const, op: 'in' as const, value: SANCTIONS },
    { field: 'regionIds' as const, op: 'contains' as const, value: r.id },
  ];
  return [
    {
      id: `${r.id}.sanctions-activity`,
      name: `${r.shortCode} new sanctions designations`,
      description: `Batches of new US, EU or UK sanctions designations targeting or linked to ${r.name} countries within 7 days, compared with the 28-day baseline.`,
      family: 'diplomatic',
      regionId: r.id,
      requiredSourceIds: SANCTIONS_REQUIRED,
      match: { all: base },
      windowHours: 168,
      elevated: { countAtLeast: 2 },
      triggered: { countAtLeast: 4 },
      baseline: { days: 28, triggerRatio: 3, elevatedRatio: 2 },
      weight: 1,
      severity: 'medium',
      experimental: false,
      enabled: true,
      configVersion: 1,
      rationale:
        'Coordinated or repeated designations show governments raising pressure on a country. Russia and Iran are sanctioned almost every week, so only activity above the baseline counts.',
    },
    {
      id: `${r.id}.sanctions-package`,
      name: `${r.shortCode} large sanctions package`,
      description: `A single US, EU or UK batch of 25 or more new designations targeting or linked to ${r.name} countries within 7 days.`,
      family: 'diplomatic',
      regionId: r.id,
      requiredSourceIds: SANCTIONS_REQUIRED,
      match: { all: [...base, { field: 'metadata.count' as const, op: 'gte' as const, value: 25 }] },
      windowHours: 168,
      elevated: { countAtLeast: 1 },
      triggered: { countAtLeast: 1 },
      baseline: null,
      weight: 2,
      severity: 'medium',
      experimental: false,
      enabled: true,
      configVersion: 1,
      rationale: 'Large packages usually answer a major event (an offensive, an attack, a nuclear step) or mark a policy shift.',
    },
  ];
});

const AIS_SHIPS = 'ais-sanctioned-ships';

/** Phase 13 item 4b: sanctioned vessels in the Baltic (experimental: base rates unknown). */
const sanctionedShipIndicators: IndicatorDefinition[] = [
  {
    id: 'eastern-europe.sanctioned-vessels',
    name: 'EASTEUR sanctioned vessels in the Baltic',
    description: 'Distinct sanctioned vessels (OFAC, EU or UK lists) seen on AIS in the Baltic Sea or Gulf of Finland within 7 days, compared with the 28-day baseline.',
    family: 'experimental',
    regionId: 'eastern-europe',
    requiredSourceIds: [AIS_SHIPS, 'ofac-sdn'],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: AIS_SHIPS },
        // v0.73.0: the source also makes cable-proximity records; only sightings count here.
        { field: 'metadata.subtype', op: 'eq', value: 'sanctioned-vessel-sighting' },
        { field: 'regionIds', op: 'contains', value: 'eastern-europe' },
      ],
    },
    windowHours: 168,
    elevated: { countAtLeast: 5 },
    triggered: { countAtLeast: 10 },
    baseline: { days: 28, triggerRatio: 3, elevatedRatio: 2 },
    weight: 0,
    severity: 'low',
    experimental: true,
    enabled: true,
    configVersion: 2,
    rationale:
      'Sanctioned tankers (the Russian "shadow fleet") carry oil past sanctions through the Baltic, and ships from this fleet have damaged undersea cables. Records count ship-days (one per vessel, area and day), so a ship that stays counts on each day it is seen. Thresholds are guesses until a baseline exists.',
    research: {
      hypothesis: 'More sanctioned vessels than usual in the Baltic reflects increased sanctions evasion or activity around a crisis.',
      dataAvailability: 'aisstream.io, sampled 25 s per collection run since 2026-11-21; watchlist from the OFAC, EU and UK lists.',
      baselinePeriod: '28 days of collection.',
      expectedRelationship: 'Rises with oil-export volumes through Baltic ports and with enforcement gaps.',
      historicalExamples: 'None in WATCHTOWER data yet.',
      confounders: 'Receiver coverage, the sampling window, new designations enlarging the watchlist, port calls.',
      falsePositives: 'Ships re-designated or renamed; MMSI-only matches after re-flagging.',
      retrospectiveResults: 'Insufficient history.',
      evidenceQuality: 'none',
    },
  },
  {
    id: 'eastern-europe.cable-proximity',
    name: 'EASTEUR sanctioned vessel lingering near undersea cable',
    description:
      'A sanctioned vessel moving under 4 kn within 2 km of a mapped undersea cable or pipeline in the Baltic, or seen near the same line again 30+ minutes later, within 7 days (not within 10 km of a port). Three or more is triggered.',
    family: 'experimental',
    regionId: 'eastern-europe',
    requiredSourceIds: [AIS_SHIPS, 'ofac-sdn'],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: AIS_SHIPS },
        { field: 'metadata.subtype', op: 'eq', value: 'cable-proximity' },
        { field: 'regionIds', op: 'contains', value: 'eastern-europe' },
      ],
    },
    windowHours: 168,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 3 },
    baseline: null,
    weight: 0,
    severity: 'medium',
    experimental: true,
    enabled: true,
    configVersion: 1,
    rationale:
      'Ships dragging anchors damaged Balticconnector (Oct 2023), C-Lion 1 and BCS East-West (Nov 2024) and Estlink 2 (Dec 2024); the Estlink 2 suspect was a sanctioned-fleet tanker. Most slow passes are innocent, and AIS is sampled briefly, so this is a pointer to look, weighted 0.',
    research: {
      hypothesis: 'Sanctioned ships lingering over undersea infrastructure precede or accompany damage to it.',
      dataAvailability: 'aisstream.io, sampled about 25 s per collection run since 2026-11-21; lines from OpenStreetMap.',
      baselinePeriod: 'None yet.',
      expectedRelationship: 'Rises with shadow-fleet traffic and with deliberate interference.',
      historicalExamples: 'Not in WATCHTOWER data. Public cases: Newnew Polar Bear (Oct 2023), Yi Peng 3 (Nov 2024), Eagle S (Dec 2024).',
      confounders: 'Anchorages and waiting areas near the lines, slow steaming, mapped routes being approximate.',
      falsePositives: 'Ships waiting for pilots or berths, drifting in bad weather.',
      retrospectiveResults: 'Insufficient history.',
      evidenceQuality: 'none',
    },
  },
];

/** v0.77.0: tankers and cargo ships going dark in Finnish waters (experimental: no history yet). */
const darkShipIndicators: IndicatorDefinition[] = [
  {
    id: 'eastern-europe.ships-dark',
    name: 'EASTEUR ships going dark in the Gulf of Finland and northern Baltic',
    description:
      'Tankers or cargo ships that stopped broadcasting AIS at sea, under way, after steady contact, where other ships were still heard (Fintraffic feed), within 72 hours. Five or more is triggered.',
    family: 'experimental',
    regionId: 'eastern-europe',
    requiredSourceIds: ['ais-shipping'],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: 'ais-shipping' },
        { field: 'metadata.subtype', op: 'eq', value: 'ship-dark' },
        { field: 'regionIds', op: 'contains', value: 'eastern-europe' },
      ],
    },
    windowHours: 72,
    elevated: { countAtLeast: 2 },
    triggered: { countAtLeast: 5 },
    baseline: null,
    weight: 0,
    severity: 'medium',
    experimental: true,
    enabled: true,
    configVersion: 1,
    rationale:
      'Shadow-fleet tankers switch AIS off to hide ship-to-ship transfers and port calls; a cluster of ships going dark can also accompany electronic interference or military activity. AIS may be switched off lawfully and receivers fail, so this is weighted 0 until there is history.',
    research: {
      hypothesis: 'More ships going dark than usual in the Gulf of Finland marks sanctions evasion activity or interference.',
      dataAvailability: 'Fintraffic Digitraffic AIS (every ship its Finnish receivers hear), each collection run since 2026-11-24.',
      baselinePeriod: 'None yet.',
      expectedRelationship: 'Rises with shadow-fleet loading at Primorsk and Ust-Luga and with GNSS or AIS interference.',
      historicalExamples: 'None in WATCHTOWER data yet.',
      confounders: 'Receiver outages, ships leaving coverage, transponder faults, Russian territorial waters near the edge of Finnish coverage.',
      falsePositives: 'A receiver going down; ships entering ports not in the port list.',
      retrospectiveResults: 'Insufficient history.',
      evidenceQuality: 'none',
    },
  },
  {
    id: 'eastern-europe.tanker-traffic-change',
    name: 'EASTEUR tanker traffic surge or drop in the Gulf of Finland',
    description:
      'Tankers present in a Gulf of Finland zone (Primorsk and Vyborg, Ust-Luga, the whole gulf) over the last 24 hours 3+ typical spreads above or below the zone\'s usual level (Fintraffic feed), within 72 hours. Two or more is triggered.',
    family: 'experimental',
    regionId: 'eastern-europe',
    requiredSourceIds: ['ais-shipping'],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: 'ais-shipping' },
        { field: 'metadata.subtype', op: 'eq', value: 'tanker-level' },
        { field: 'regionIds', op: 'contains', value: 'eastern-europe' },
      ],
    },
    windowHours: 72,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 2 },
    baseline: null,
    weight: 0,
    severity: 'medium',
    experimental: true,
    enabled: true,
    configVersion: 1,
    rationale:
      'Primorsk and Ust-Luga ship much of Russia\'s seaborne oil; drone strikes on them and loading halts show up as fewer tankers, and loading rushes before new sanctions as more. Weighted 0 until there is history.',
    research: {
      hypothesis: 'Sharp changes in tanker presence at the Gulf of Finland oil terminals track disruption or sanctions timing.',
      dataAvailability: 'Fintraffic Digitraffic AIS, each collection run since 2026-11-24.',
      baselinePeriod: 'Each zone against its own earlier days (7+ needed).',
      expectedRelationship: 'Drops after terminal strikes and loading halts; surges before sanctions take effect.',
      historicalExamples: 'None in WATCHTOWER data yet.',
      confounders: 'Ice and storms, holidays, receiver coverage near the Russian coast.',
      falsePositives: 'Weather closures, a receiver outage.',
      retrospectiveResults: 'Insufficient history.',
      evidenceQuality: 'none',
    },
  },
];

const GNSS = 'adsb-gnss';
const GNSS_REGIONS = ['eastern-europe', 'middle-east', 'red-sea', 'korean-peninsula', 'taiwan-strait', 'south-china-sea'];

/** v0.69.0: GPS interference from aircraft position accuracy (experimental: no history yet). */
const gnssIndicators: IndicatorDefinition[] = ADVISORY_REGIONS.filter((r) => GNSS_REGIONS.includes(r.id)).map(
  (r): IndicatorDefinition => ({
    id: `${r.id}.gnss-interference`,
    name: `${r.shortCode} GPS interference spreading`,
    description: `A 1° square over ${r.name} reached 10%+ of aircraft reporting degraded GPS accuracy (5+ sightings) after not being high the day before, within 72 hours. Three such days is triggered.`,
    family: 'experimental',
    regionId: r.id,
    requiredSourceIds: [GNSS],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: GNSS },
        { field: 'metadata.subtype', op: 'eq', value: 'gnss-interference' },
        { field: 'regionIds', op: 'contains', value: r.id },
      ],
    },
    windowHours: 72,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 3 },
    baseline: null,
    weight: 0,
    severity: 'medium',
    experimental: true,
    enabled: true,
    configVersion: 1,
    rationale:
      'Jamming and spoofing switch on with military activity: air defence around bases, drone and missile defence, and electronic warfare. Interference that appears where it was not the day before is the change worth noticing; areas jammed every day (Kaliningrad, parts of the Eastern Mediterranean) only count when new squares light up. Weighted 0 until there is history.',
    research: {
      hypothesis: 'New areas of degraded aircraft GPS accuracy mark new electronic-warfare activity in or near the region.',
      dataAvailability: 'adsb.lol circle queries, hourly since 2026-11-23; squares kept for 48 hours.',
      baselinePeriod: 'None yet: each square is compared with its own previous 24 hours.',
      expectedRelationship: 'Rises with air-defence alerts, drone and missile attacks, exercises with electronic warfare.',
      historicalExamples: 'None in WATCHTOWER data yet. Public GPS-jamming maps have shown persistent interference around Kaliningrad, Israel and Lebanon, and Iraq since 2023.',
      confounders: 'Receiver coverage, traffic volume (night), rerouted flights, badly installed transponders, hourly sampling.',
      falsePositives: 'A few aircraft with faulty transponders in a quiet square; test transmissions announced by NOTAM.',
      retrospectiveResults: 'Insufficient history.',
      evidenceQuality: 'none',
    },
  }),
);

const NET_RESEARCH = (what: string) => ({
  hypothesis: `${what} against a region's networks accompanies political crises and military operations.`,
  dataAvailability: 'Cloudflare Radar API since 2026-11-23.',
  baselinePeriod: 'None yet.',
  expectedRelationship: 'Rises around elections, protests, strikes and conflict escalation.',
  historicalExamples: 'None in WATCHTOWER data yet.',
  confounders: 'Misconfigurations (routing), Cloudflare customer mix and sampling (DDoS), large events unrelated to politics.',
  falsePositives: 'Routing mistakes scored as hijacks; a single large attack on one commercial customer.',
  retrospectiveResults: 'Insufficient history.',
  evidenceQuality: 'none' as const,
});

/** v0.70.0: route hijacks and DDoS surges per region (experimental: no history yet). */
const netIndicators: IndicatorDefinition[] = STATE_DEPT_REGIONS.flatMap((r): IndicatorDefinition[] => [
  {
    id: `${r.id}.bgp-hijack`,
    name: `${r.shortCode} route hijack`,
    description: `A high-confidence route hijack (Cloudflare Radar, 8+ of 10) across a border between two watch-region countries, one of them in ${r.name}, within 72 hours. Three or more is triggered.`,
    family: 'experimental',
    regionId: r.id,
    requiredSourceIds: ['cloudflare-radar-bgp'],
    match: { all: [{ field: 'sourceId', op: 'eq', value: 'cloudflare-radar-bgp' }, { field: 'metadata.subtype', op: 'eq', value: 'bgp-hijack' }, { field: 'metadata.routine', op: 'neq', value: true }, { field: 'regionIds', op: 'contains', value: r.id }] },
    windowHours: 72,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 3 },
    baseline: null,
    weight: 0,
    severity: 'medium',
    experimental: true,
    enabled: true,
    configVersion: 1,
    rationale: 'Hijacked routes divert or black-hole traffic; states have used them for censorship and interception. Many are mistakes, so it is weighted 0 until there is history.',
    research: NET_RESEARCH('Route hijacking'),
  },
  {
    id: `${r.id}.ddos-surge`,
    name: `${r.shortCode} DDoS surge`,
    description: `Network-layer DDoS traffic aimed at targets in a ${r.name} country reached half or more of its biggest day in 4 weeks, within 72 hours. Two or more is triggered.`,
    family: 'experimental',
    regionId: r.id,
    requiredSourceIds: ['cloudflare-radar-ddos'],
    match: { all: [{ field: 'sourceId', op: 'eq', value: 'cloudflare-radar-ddos' }, { field: 'metadata.subtype', op: 'eq', value: 'ddos-surge' }, { field: 'metadata.routine', op: 'neq', value: true }, { field: 'regionIds', op: 'contains', value: r.id }] },
    windowHours: 72,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 2 },
    baseline: null,
    weight: 0,
    severity: 'medium',
    experimental: true,
    enabled: true,
    configVersion: 1,
    rationale: 'Hacktivist and state-linked DDoS campaigns cluster around political events. Cloudflare sees only its customers, so a surge is a signal, not a total.',
    research: NET_RESEARCH('DDoS'),
  },
]);

const UNSC = 'un-security-council';

/** Phase 13 item 5: UN Security Council attention and failed drafts (not for the US region). */
const unscIndicators: IndicatorDefinition[] = STATE_DEPT_REGIONS.flatMap((r): IndicatorDefinition[] => [
  {
    id: `${r.id}.unsc-attention`,
    name: `${r.shortCode} Security Council attention`,
    description: `UN Security Council meetings about ${r.name} countries within 7 days (UN catalogue subjects and agenda), compared with the 28-day baseline.`,
    family: 'diplomatic',
    regionId: r.id,
    requiredSourceIds: [UNSC],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: UNSC },
        { field: 'regionIds', op: 'contains', value: r.id },
        { field: 'metadata.subtype', op: 'eq', value: 'unsc-meeting' },
      ],
    },
    windowHours: 168,
    elevated: { countAtLeast: 2 },
    triggered: { countAtLeast: 4 },
    baseline: { days: 28, triggerRatio: 3, elevatedRatio: 2 },
    weight: 1,
    severity: 'medium',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale:
      'Extra Council meetings on a country follow a crisis. Many meetings are scheduled mandate renewals, so only meetings above the baseline count. Meetings are catalogued 1–3 days late.',
  },
  {
    id: `${r.id}.unsc-failed-draft`,
    name: `${r.shortCode} Security Council draft fails or is vetoed`,
    description: `A Security Council draft resolution concerning ${r.name} failed to be adopted (including vetoes) within 30 days, from UN press releases.`,
    family: 'diplomatic',
    regionId: r.id,
    requiredSourceIds: [UNSC],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: UNSC },
        { field: 'regionIds', op: 'contains', value: r.id },
        { field: 'metadata.subtype', op: 'eq', value: 'unsc-failed-draft' },
      ],
    },
    windowHours: 720,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 1 },
    baseline: null,
    weight: 2,
    severity: 'high',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale: 'A failed draft or a veto shows the Council divided over the situation, so no collective response is coming from it.',
  },
]);

const DPRK_LAUNCH = 'yonhap-dprk-launches';

/** Phase 13 item 6: North Korean launches and nuclear tests (Yonhap). The USGS explosion indicator is the independent seismic check. */
const missileIndicators: IndicatorDefinition[] = [
  {
    id: 'korean-peninsula.dprk-missile-launch',
    name: 'KOREA North Korean missile launch',
    description: 'Days with a North Korean missile, rocket or satellite launch reported by Yonhap (citing South Korea’s military) within 7 days.',
    family: 'official-activity',
    regionId: 'korean-peninsula',
    requiredSourceIds: [DPRK_LAUNCH],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: DPRK_LAUNCH },
        { field: 'metadata.subtype', op: 'eq', value: 'dprk-missile-launch' },
      ],
    },
    windowHours: 168,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 2 },
    baseline: null,
    weight: 2,
    severity: 'high',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale:
      'Launches are North Korea’s main military signal. Japan’s Ministry of Defense reported launches on 12 days in 2026 up to November, so one launch day is ELEVATED and two within a week are TRIGGERED.',
  },
  {
    id: 'korean-peninsula.dprk-nuclear-test',
    name: 'KOREA North Korean nuclear test reported',
    description: 'A North Korean nuclear test reported by Yonhap within 30 days.',
    family: 'official-activity',
    regionId: 'korean-peninsula',
    requiredSourceIds: [DPRK_LAUNCH],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: DPRK_LAUNCH },
        { field: 'metadata.subtype', op: 'eq', value: 'dprk-nuclear-test' },
      ],
    },
    windowHours: 720,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 1 },
    baseline: null,
    weight: 3,
    severity: 'high',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale: 'A nuclear test is the most serious escalation step short of use. The USGS explosion-typed seismic indicator is an independent check.',
  },
];

/** Phase 13 item 7: US embassy drawdowns stated in State Department advisories. */
const embassyIndicators: IndicatorDefinition[] = STATE_DEPT_REGIONS.map(
  (r): IndicatorDefinition => ({
    id: `${r.id}.embassy-drawdown`,
    name: `${r.shortCode} US embassy drawdown`,
    description: `A State Department advisory for a ${r.name} country newly states an ordered or authorized departure of US government staff, or suspended embassy operations, within 30 days.`,
    family: 'diplomatic',
    regionId: r.id,
    requiredSourceIds: [STATE],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: STATE },
        { field: 'regionIds', op: 'contains', value: r.id },
        { field: 'metadata.subtype', op: 'eq', value: 'embassy-posture' },
        { field: 'metadata.postureChange', op: 'in', value: ['ordered-departure', 'authorized-departure', 'operations-suspended'] },
      ],
    },
    windowHours: 720,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 1 },
    baseline: null,
    weight: 3,
    severity: 'high',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale:
      'Ordering staff and families out, or suspending embassy operations, is one of the strongest official signals that a government expects danger, and it usually comes before or with a crisis.',
  }),
);

const DOD_CONTRACTS = 'dod-contracts';

const CONTRACT_RESEARCH = {
  dataAvailability: 'DoD daily contract announcements, collected since 2026-11-21 (notable awards only).',
  baselinePeriod: '28 days of collection.',
  confounders: 'Fiscal-year timing (awards bunch in September and after budgets pass), multi-year contracts, ceilings that are never fully spent.',
  falsePositives: 'Routine production lots and sustainment contracts.',
  retrospectiveResults: 'Insufficient history.',
  evidenceQuality: 'none' as const,
};

/** Phase 13 item 8: DoD contract awards (experimental: procurement is a slow, lumpy signal). */
const contractIndicators: IndicatorDefinition[] = [
  {
    id: 'united-states.munitions-contracts',
    name: 'USA munitions and missile contract awards',
    description: 'DoD awards of $100 million or more for missiles, munitions or interceptors within 7 days, compared with the 28-day baseline.',
    family: 'experimental',
    regionId: 'united-states',
    requiredSourceIds: [DOD_CONTRACTS],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: DOD_CONTRACTS },
        { field: 'metadata.munitions', op: 'eq', value: true },
      ],
    },
    windowHours: 168,
    elevated: { countAtLeast: 2 },
    triggered: { countAtLeast: 4 },
    baseline: { days: 28, triggerRatio: 3, elevatedRatio: 2 },
    weight: 0,
    severity: 'low',
    experimental: true,
    enabled: true,
    configVersion: 1,
    rationale: 'A burst of munitions and interceptor buys can reflect replenishment after use or preparation for conflict. Procurement is slow and lumpy, so it never affects the RAI.',
    research: {
      hypothesis: 'More large munitions awards than usual follow or precede periods of high expenditure (strikes, air defence).',
      expectedRelationship: 'Lagging: awards follow expenditure by months.',
      historicalExamples: 'None in WATCHTOWER data yet.',
      ...CONTRACT_RESEARCH,
    },
  },
  ...STATE_DEPT_REGIONS.map(
    (r): IndicatorDefinition => ({
      id: `${r.id}.fms-contracts`,
      name: `${r.shortCode} US arms-sale contract awards`,
      description: `DoD contract awards involving Foreign Military Sales to ${r.name} countries within 30 days.`,
      family: 'experimental',
      regionId: r.id,
      requiredSourceIds: [DOD_CONTRACTS],
      match: {
        all: [
          { field: 'sourceId', op: 'eq', value: DOD_CONTRACTS },
          { field: 'regionIds', op: 'contains', value: r.id },
        ],
      },
      windowHours: 720,
      elevated: { countAtLeast: 1 },
      triggered: { countAtLeast: 3 },
      baseline: null,
      weight: 0,
      severity: 'low',
      experimental: true,
      enabled: true,
      configVersion: 1,
      rationale: 'Contracts that deliver US weapons to partners in a watch region show where arms are flowing. Most are long-planned, so this is context, not warning.',
      research: {
        hypothesis: 'Arms-sale contracts to a region rise ahead of and during periods of tension.',
        expectedRelationship: 'Lagging and policy-driven.',
        historicalExamples: 'None in WATCHTOWER data yet.',
        ...CONTRACT_RESEARCH,
      },
    }),
  ),
];

const FEDREG = 'federal-register';

/** Phase 13 item 9: US executive actions in the Federal Register. */
const fedregIndicators: IndicatorDefinition[] = STATE_DEPT_REGIONS.flatMap((r): IndicatorDefinition[] => [
  {
    id: `${r.id}.us-national-emergency`,
    name: `${r.shortCode} US national emergency declared`,
    description: `A new US national emergency naming a ${r.name} country, published in the Federal Register within 30 days.`,
    family: 'official-activity',
    regionId: r.id,
    requiredSourceIds: [FEDREG],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: FEDREG },
        { field: 'regionIds', op: 'contains', value: r.id },
        { field: 'metadata.fedregKind', op: 'eq', value: 'national-emergency-declared' },
      ],
    },
    windowHours: 720,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 1 },
    baseline: null,
    weight: 2,
    severity: 'high',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale: 'Declaring a national emergency is the legal step that unlocks sanctions and other measures against a country; new declarations are rare and deliberate.',
  },
  {
    id: `${r.id}.us-executive-actions`,
    name: `${r.shortCode} US executive actions`,
    description: `Security-related executive orders, presidential actions, export-control rules and terrorist designations naming ${r.name} countries within 14 days.`,
    family: 'experimental',
    regionId: r.id,
    requiredSourceIds: [FEDREG],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: FEDREG },
        { field: 'regionIds', op: 'contains', value: r.id },
      ],
    },
    windowHours: 336,
    elevated: { countAtLeast: 2 },
    triggered: { countAtLeast: 4 },
    baseline: null,
    weight: 0,
    severity: 'low',
    experimental: true,
    enabled: true,
    configVersion: 1,
    rationale: 'Several US legal actions naming a region in a short time show policy attention. Untested, so it never affects the RAI.',
    research: {
      hypothesis: 'Clusters of executive actions naming a region accompany escalations in US policy toward it.',
      dataAvailability: 'Federal Register API, collected since 2026-11-21 (30 days back-filled).',
      baselinePeriod: 'None yet.',
      expectedRelationship: 'Coincident or lagging.',
      historicalExamples: 'EO 14436 (Oct. 21, 2026) implementing sanctions on Russia and Iran.',
      confounders: 'Publication delays; omnibus documents naming many countries.',
      falsePositives: 'Documents that name a country in passing.',
      retrospectiveResults: 'Insufficient history.',
      evidenceQuality: 'none',
    },
  },
]);

const CONGRESS = 'congress';

/** Phase 13 item 10: Congress on war powers, arms sales and security hearings. */
const congressIndicators: IndicatorDefinition[] = STATE_DEPT_REGIONS.flatMap((r): IndicatorDefinition[] => [
  {
    id: `${r.id}.congress-war-powers`,
    name: `${r.shortCode} Congress war-powers action`,
    description: `A war-powers or use-of-force resolution naming a ${r.name} country introduced, moved or voted on in Congress within 30 days.`,
    family: 'official-activity',
    regionId: r.id,
    requiredSourceIds: [CONGRESS],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: CONGRESS },
        { field: 'regionIds', op: 'contains', value: r.id },
        { field: 'metadata.congressKind', op: 'eq', value: 'war-powers' },
      ],
    },
    windowHours: 720,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 2 },
    baseline: null,
    weight: 2,
    severity: 'medium',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale: 'Members of Congress file war-powers resolutions when US forces are in, or close to, hostilities; repeated filings and floor votes show a live dispute over military action.',
  },
  {
    id: `${r.id}.congress-attention`,
    name: `${r.shortCode} Congress security attention`,
    description: `Congressional security actions (war powers, arms-sale disapprovals, security hearings) naming ${r.name} countries within 14 days.`,
    family: 'experimental',
    regionId: r.id,
    requiredSourceIds: [CONGRESS],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: CONGRESS },
        { field: 'regionIds', op: 'contains', value: r.id },
      ],
    },
    windowHours: 336,
    elevated: { countAtLeast: 2 },
    triggered: { countAtLeast: 4 },
    baseline: null,
    weight: 0,
    severity: 'low',
    experimental: true,
    enabled: true,
    configVersion: 1,
    rationale: 'Clusters of congressional actions on a region show political attention; untested, so it never affects the RAI.',
    research: {
      hypothesis: 'Congressional activity on a region rises with US military involvement there.',
      dataAvailability: 'Congress.gov API, collected since the key was configured (30 days back-filled).',
      baselinePeriod: 'None yet.',
      expectedRelationship: 'Coincident or lagging.',
      historicalExamples: 'Iran war-powers resolutions in 2026 (S.J.Res. 118, 172, 191, 200).',
      confounders: 'Session calendar and recesses; symbolic resolutions.',
      falsePositives: 'Measures that name a country in passing.',
      retrospectiveResults: 'Insufficient history.',
      evidenceQuality: 'none',
    },
  },
]);

const LAUNCHES = 'military-launches';
const launchMatch = (regionId: string) => ({
  all: [
    { field: 'sourceId' as const, op: 'eq' as const, value: LAUNCHES },
    { field: 'regionIds' as const, op: 'contains' as const, value: regionId },
  ],
});

/** Phase 13 item 12: military and classified space launches. */
const launchIndicators: IndicatorDefinition[] = [
  {
    id: 'korean-peninsula.dprk-space-launch',
    name: 'KOREA North Korean space launch',
    description: 'A North Korean orbital launch attempt (successful or not) within 30 days, from Launch Library 2.',
    family: 'official-activity',
    regionId: 'korean-peninsula',
    requiredSourceIds: [LAUNCHES],
    match: { all: [...launchMatch('korean-peninsula').all, { field: 'countryCodes', op: 'contains', value: 'KP' }] },
    windowHours: 720,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 1 },
    baseline: null,
    weight: 2,
    severity: 'high',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale: 'North Korean satellite launches use ballistic-missile technology banned by UN resolutions and are treated by its neighbours as missile tests.',
  },
  {
    id: 'middle-east.iran-space-launch',
    name: 'MIDEAST Iranian space launch',
    description: 'An Iranian orbital launch attempt within 30 days, from Launch Library 2.',
    family: 'official-activity',
    regionId: 'middle-east',
    requiredSourceIds: [LAUNCHES],
    match: { all: [...launchMatch('middle-east').all, { field: 'countryCodes', op: 'contains', value: 'IR' }] },
    windowHours: 720,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 2 },
    baseline: null,
    weight: 1,
    severity: 'medium',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale: 'Iran\u2019s space launchers, several run by the IRGC, share technology with its long-range missiles.',
  },
  {
    id: 'global.military-launch-tempo',
    name: 'GLOBAL military and classified launch tempo',
    description: 'Military and classified orbital launches worldwide within 14 days.',
    family: 'experimental',
    regionId: 'global',
    requiredSourceIds: [LAUNCHES],
    match: { all: [{ field: 'sourceId', op: 'eq', value: LAUNCHES }] },
    windowHours: 336,
    elevated: { countAtLeast: 6 },
    triggered: { countAtLeast: 10 },
    baseline: { days: 28, triggerRatio: 2, elevatedRatio: 1.5 },
    weight: 0,
    severity: 'low',
    experimental: true,
    enabled: true,
    configVersion: 1,
    rationale: 'A surge of military reconnaissance and communications launches can precede operations; most are routine constellation build-out, so it never affects the RAI.',
    research: {
      hypothesis: 'Military launch tempo rises before and during crises (replacing or adding reconnaissance capacity).',
      dataAvailability: 'Launch Library 2, collected since 2026-11-21 (30 days back-filled).',
      baselinePeriod: '28 days.',
      expectedRelationship: 'Weak; dominated by scheduled constellation launches (SDA, Yaogan).',
      historicalExamples: 'About 6 a month in Oct.–Nov. 2026.',
      confounders: 'Launch-vehicle availability, weather, constellation schedules.',
      falsePositives: 'Routine deployment campaigns.',
      retrospectiveResults: 'Insufficient history.',
      evidenceQuality: 'none',
    },
  },
];

const WHO_DON = 'who-don';

/** Phase 13 item 13: WHO outbreak reports naming a watch-region country. */
const outbreakIndicators: IndicatorDefinition[] = ADVISORY_REGIONS.map(
  (r): IndicatorDefinition => ({
    id: `${r.id}.disease-outbreak`,
    name: `${r.shortCode} WHO outbreak report`,
    description: `A WHO Disease Outbreak News report naming a ${r.name} country within 30 days.`,
    family: 'official-activity',
    regionId: r.id,
    requiredSourceIds: [WHO_DON],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: WHO_DON },
        { field: 'regionIds', op: 'contains', value: r.id },
      ],
    },
    windowHours: 720,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 2 },
    baseline: null,
    weight: 1,
    severity: 'medium',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale: 'WHO publishes these only for events of potential international concern; an outbreak in a region under strain (conflict, displacement) worsens it. Reports lag the first cases.',
  }),
);

const FX = 'fx-rates';
const OIL = 'oil-prices';

/** Phase 13 item 14: a watch-region currency losing value fast against the dollar. */
const currencyIndicators: IndicatorDefinition[] = ADVISORY_REGIONS.map(
  (r): IndicatorDefinition => ({
    id: `${r.id}.currency-stress`,
    name: `${r.shortCode} currency stress`,
    description: `A ${r.name} currency lost 5% against the dollar in a week or 10% in a month (2% for pegged currencies).`,
    family: 'official-activity',
    regionId: r.id,
    requiredSourceIds: [FX],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: FX },
        { field: 'regionIds', op: 'contains', value: r.id },
      ],
    },
    windowHours: 168,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 2 },
    baseline: null,
    weight: 1,
    severity: 'medium',
    experimental: false,
    enabled: true,
    configVersion: 1,
    rationale: 'Capital flight and a run on the currency often precede or follow a security shock; a pegged currency moving at all signals strain. Rates are daily reference rates, not intraday.',
  }),
);

const oilIndicators: IndicatorDefinition[] = [
  {
    id: 'experimental.oil-spike',
    name: 'Oil price spike',
    description: 'Brent or WTI rose 10% in a week or 20% in a month (EIA spot prices).',
    family: 'experimental',
    regionId: 'global',
    requiredSourceIds: [OIL],
    match: {
      all: [
        { field: 'sourceId', op: 'eq', value: OIL },
        { field: 'metadata.direction', op: 'eq', value: 'up' },
      ],
    },
    windowHours: 168,
    elevated: { countAtLeast: 1 },
    triggered: { countAtLeast: 2 },
    baseline: null,
    weight: 0,
    severity: 'low',
    experimental: true,
    enabled: true,
    configVersion: 1,
    rationale: 'Markets price supply risk (Gulf, Red Sea, Russia) quickly, but oil also moves on demand, OPEC decisions and the dollar; context only. EIA prices are 3–4 days late.',
    research: {
      hypothesis: 'A sharp rise in Brent or WTI reflects traders pricing a supply threat (Gulf, Strait of Hormuz, Red Sea, Russian exports) before or during escalation.',
      dataAvailability: 'Available once CONGRESS_API_KEY is set: EIA daily spot prices, 50 days fetched every 6 hours.',
      baselinePeriod: 'Fixed thresholds (10% in 7 days, 20% in 30 days); no learned baseline.',
      expectedRelationship: 'Coincident with escalation in producing regions; a lead is possible when markets react to threats before action.',
      historicalExamples: 'Brent spiked after the 2019 Abqaiq attack and the 2022 invasion of Ukraine. In collected data, Brent fell 22% between mid-October and mid-November 2026 (a move down, not counted).',
      confounders: 'OPEC+ quota decisions, demand shocks, US inventory reports, the dollar, refinery outages, hurricanes.',
      falsePositives: 'Expected: many spikes have no security cause.',
      retrospectiveResults: 'Insufficient history. Re-run in Signal Lab once 90+ days are collected.',
      evidenceQuality: 'weak',
    },
  },
];

export const INDICATOR_CATALOG: IndicatorDefinition[] = [
  ...advisoryIndicators,
  ...cyberIndicators,
  ...expansionIndicators,
  // FIRMS is not collected for the US (see collector/adapters/firms.ts).
  ...freeKeyIndicators.filter((d) => d.id !== `${US}.thermal-clusters`),
  ...usIndicators,
  ...experimentalIndicators,
  ...aircraftIndicators,
  ...fleetIndicators,
  ...chokepointIndicators,
  ...sanctionsIndicators,
  ...sanctionedShipIndicators,
  ...gnssIndicators,
  ...darkShipIndicators,
  ...netIndicators,
  ...unscIndicators,
  ...missileIndicators,
  ...embassyIndicators,
  ...contractIndicators,
  ...fedregIndicators,
  ...congressIndicators,
  ...launchIndicators,
  ...outbreakIndicators,
  ...currencyIndicators,
  ...oilIndicators,
];

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
