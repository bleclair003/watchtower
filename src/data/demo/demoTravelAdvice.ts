import type { TravelAdviceSnapshot } from '@shared/domain/travelAdvice';

/** SIMULATED travel advice table and one joint raise, for demo mode and tests: invented dates and notes. */
export function buildDemoTravelAdvice(now: number): TravelAdviceSnapshot {
  const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
  return {
    simulated: true,
    generatedAt: at(0.3),
    countries: [
      {
        country: 'IL',
        us: { level: 3, label: 'Reconsider travel', at: at(30), url: 'https://example.test/us-il' },
        ca: { level: 2, label: 'Avoid non-essential travel', at: at(20), url: null },
        uk: { level: null, label: 'Invented update: now advises against all but essential travel to an area (SIMULATED)', at: at(26), url: 'https://example.test/uk-il' },
      },
      {
        country: 'LB',
        us: { level: 4, label: 'Do not travel', at: at(400), url: 'https://example.test/us-lb' },
        ca: { level: 3, label: 'Avoid all travel', at: at(300), url: null },
      },
      {
        country: 'IQ',
        us: { level: 4, label: 'Do not travel', at: at(900), url: 'https://example.test/us-iq' },
        cdc: [{ level: 1, title: 'CDC Level 1 (practice usual precautions): Invented fever in Iraq (SIMULATED)', at: at(500), url: 'https://example.test/cdc-iq' }],
      },
    ],
    joint: [
      {
        country: 'IL',
        governments: ['canada-travel-advisories', 'uk-fcdo-travel'],
        level: 'watch',
        first: at(26),
        last: at(20),
        eventIds: ['demo-t1', 'demo-t2'],
        titles: ['Israel — Canada: Avoid non-essential travel (SIMULATED)', 'Israel — UK travel advice updated (SIMULATED)'],
      },
    ],
  };
}
