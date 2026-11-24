import type { SatElement, SatellitesSnapshot } from '@shared/domain/satellites';

/** SIMULATED satellites for demo mode and tests: invented names on invented sun-synchronous and other orbits. */
export function buildDemoSatellites(now: number): SatellitesSnapshot {
  const epoch = new Date(now - 6 * 3_600_000).toISOString().replace('Z', '');
  const el = (name: string, id: number, n: number, inc: number, raan: number, ma: number): SatElement => ({
    OBJECT_NAME: name,
    OBJECT_ID: `2026-${String(id).padStart(3, '0')}A`,
    EPOCH: epoch,
    MEAN_MOTION: n,
    ECCENTRICITY: 0.0012,
    INCLINATION: inc,
    RA_OF_ASC_NODE: raan,
    ARG_OF_PERICENTER: 90,
    MEAN_ANOMALY: ma,
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: 990000 + id,
    ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 100,
    BSTAR: 0.0001,
    MEAN_MOTION_DOT: 0,
    MEAN_MOTION_DDOT: 0,
  });
  const sats = [
    { g: 'military' as const, el: el('SIM RECON 1', 1, 15.2, 97.6, 40, 10) },
    { g: 'military' as const, el: el('SIM RADAR 2', 2, 14.9, 63.4, 160, 200) },
    { g: 'military' as const, el: el('SIM COMMS 3', 3, 2.0, 7.0, 90, 50) },
    { g: 'resource' as const, el: el('SIM IMAGER 4', 4, 14.6, 98.2, 250, 120) },
    { g: 'resource' as const, el: el('SIM IMAGER 5', 5, 15.0, 97.4, 310, 300) },
  ];
  return {
    simulated: true,
    fetchedAt: new Date(now - 2 * 3_600_000).toISOString(),
    sats,
    groups: [
      { id: 'military', count: 3, newestEpoch: epoch },
      { id: 'resource', count: 2, newestEpoch: epoch },
    ],
  };
}
