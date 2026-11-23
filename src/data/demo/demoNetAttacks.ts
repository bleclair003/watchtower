import type { NetAttackSnapshot } from '@shared/domain/netAttacks';

/** SIMULATED route hijacks, leaks and DDoS levels for demo mode and tests. Networks use private-use AS numbers. */
export function buildDemoNetAttacks(now: number): NetAttackSnapshot {
  const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const day = (d: number) => new Date(now - d * 86_400_000).toISOString().slice(0, 10);
  const series = (base: number, last: number) => [...Array.from({ length: 27 }, (_, i) => base + ((i * 7) % 5) / 100), last];
  return {
    simulated: true,
    fetchedAt: at(0.5),
    hijacks: [
      {
        id: 900002, from: at(30), to: at(29), confidence: 8,
        hijacker: { asn: 64530, org: '[SIMULATED] Example Local ISP', country: 'UA' },
        victims: [{ asn: 64531, org: '[SIMULATED] Example Customer', country: 'UA' }], victimCountries: ['UA'],
        prefixes: ['203.0.113.0/24'], prefixCount: 1, stale: true, tags: [],
      },
      {
        id: 900001, from: at(6), to: at(2), confidence: 9,
        hijacker: { asn: 64512, org: '[SIMULATED] Example Transit', country: 'RU' },
        victims: [{ asn: 64513, org: '[SIMULATED] Example Telecom', country: 'UA' }], victimCountries: ['UA'],
        prefixes: ['192.0.2.0/24', '198.51.100.0/24'], prefixCount: 2, stale: false, tags: [],
      },
    ],
    leaks: [
      { id: 900101, at: at(20), leaker: { asn: 64520, org: '[SIMULATED] Example ISP', country: 'IR' }, countries: ['IR', 'IQ'], prefixCount: 340, originCount: 12, peerCount: 4, finished: true },
    ],
    ddos: {
      fetchedAt: at(3),
      noData: ['KP', 'ER'],
      countries: [
        { country: 'IL', values: series(0.02, 0.95), day: day(1), latest: 0.95, peakShare: 1, peakDay: day(1), activeDays: 1 },
        { country: 'UA', values: [...series(0.01, 0.3).slice(0, 20), 1, ...series(0.01, 0.3).slice(21)], day: day(1), latest: 0.3, peakShare: 0.3, peakDay: day(8), activeDays: 2 },
        { country: 'TW', values: series(0.01, 0.01), day: day(1), latest: 0.01, peakShare: 0.25, peakDay: day(3), activeDays: 0 },
      ],
    },
  };
}
