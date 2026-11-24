import { CONVERGENCE_RADIUS_KM, CONVERGENCE_WINDOW_HOURS, findHotspots, type ConvergenceSnapshot, type Signal } from '@shared/domain/convergence';

/** SIMULATED convergence hotspots for demo mode and tests: invented signals run through the real rules. */
export function buildDemoConvergence(now: number): ConvergenceSnapshot {
  const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const sig = (type: Signal['type'], lat: number, lon: number, h: number, title: string, regionIds: string[], detail?: string): Signal => ({
    type,
    title: `${title} (SIMULATED)`,
    sourceId: 'demo',
    at: at(h),
    lat,
    lon,
    url: '',
    regionIds,
    detail,
  });
  const ee = ['eastern-europe'];
  const me = ['middle-east'];
  const signals: Signal[] = [
    // Gulf of Finland: a ship going dark and another lingering over a cable, high GPS interference, a firing warning.
    sig('ship-dark', 59.71, 24.62, 3, 'Ship went dark: invented tanker DEMO STAR stopped broadcasting AIS while under way', ee),
    sig('cable-loiter', 59.62, 24.9, 6, 'Ship lingering near an undersea cable: invented cargo ship DEMO WAVE, seen there again', ee),
    sig('gnss', 59.5, 25.5, 1, 'GPS interference high: 14% of 60 aircraft sightings degraded', ee, 'high, 14%'),
    sig('nav-warning', 59.9, 25.2, 20, 'Navigational warning: live firing in an invented exercise area', ee, 'live firing or hazardous operations'),
    sig('sanctioned-ship', 59.8, 25.4, 2, 'Sanctioned vessel sighting: invented ship DEMO ONE', ee),
    sig('mil-air', 59.6, 24.4, 4, 'Military aircraft sighting: invented callsign SIM301', ee),
    // Eastern Mediterranean: an aircraft orbit and a fire cluster.
    sig('air-pattern', 33.4, 34.9, 5, 'Aircraft pattern: invented callsign SIM404 orbiting', me),
    sig('fire', 33.2, 35.3, 9, 'New thermal-anomaly cluster: 5 satellite fire detections', me),
    sig('gnss-medium', 33.5, 35.5, 1, 'GPS interference medium: 6% of 64 aircraft sightings degraded', me, 'medium, 6%'),
  ];
  return {
    simulated: true,
    generatedAt: at(0.2),
    windowHours: CONVERGENCE_WINDOW_HOURS,
    radiusKm: CONVERGENCE_RADIUS_KM,
    signalsChecked: signals.length + 120,
    hotspots: findHotspots(signals),
    // An invented country hotspot: an outage, a non-routine route leak and a DDoS surge in two days.
    countries: [
      {
        country: 'AE',
        level: 'strong',
        types: [
          { type: 'outage', label: 'Internet outage', role: 'anomaly', feed: 'ioda', count: 1 },
          { type: 'routing', label: 'Routing hijack or leak (not routine)', role: 'anomaly', feed: 'bgp', count: 2 },
          { type: 'ddos', label: 'DDoS surge (not routine)', role: 'anomaly', feed: 'cloudflare', count: 1 },
          { type: 'mil-air', label: 'Military flights', role: 'context', feed: 'adsb', count: 3 },
        ],
        feeds: ['bgp', 'cloudflare', 'ioda'],
        first: at(40),
        last: at(3),
        regionIds: ['middle-east'],
        signals: [
          { type: 'routing', feed: 'bgp', role: 'anomaly', title: 'Route leak by an invented network: 40 address blocks rerouted (SIMULATED)', sourceId: 'demo', at: at(3), url: '', eventId: 'demo-c1' },
          { type: 'outage', feed: 'ioda', role: 'anomaly', title: 'Internet connectivity drop detected — invented provider (SIMULATED)', sourceId: 'demo', at: at(14), url: '', eventId: 'demo-c2' },
          { type: 'ddos', feed: 'cloudflare', role: 'anomaly', title: 'DDoS surge: attacks reached 70% of the biggest day in 28 days (SIMULATED)', sourceId: 'demo', at: at(40), url: '', eventId: 'demo-c3' },
        ],
        signalCount: 7,
      },
    ],
  };
}
