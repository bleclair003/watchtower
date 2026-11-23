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
        { country: 'IL', values: series(0.2, 0.95), day: day(1), latest: 0.95, centre: 0.21, score: 18.4, ratio: 4.5 },
        { country: 'UA', values: series(0.4, 0.5), day: day(1), latest: 0.5, centre: 0.42, score: 1.6, ratio: 1.2 },
        { country: 'TW', values: series(0.3, 0.28), day: day(1), latest: 0.28, centre: 0.31, score: -0.6, ratio: 0.9 },
      ],
    },
  };
}
