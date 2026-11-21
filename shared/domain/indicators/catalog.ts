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
export const CATALOG_VERSION = 9;

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
