import type { IntelligenceEvent } from '@shared/domain/types';
import type { AircraftPosition } from '@shared/domain/aircraft';
import type { EmergencyAircraft } from '@shared/domain/aircraftEmergencies';
import type { ConflictEvent } from '@shared/domain/conflictEvents';
import type { GnssCell, GnssLostPoint } from '@shared/domain/gnss';
import { cellCentre } from '@shared/domain/gnss';
import type { FlaggedSite, InfraSite } from '@shared/domain/infrastructure';
import type { Installation, WorldInstallation } from '@shared/domain/installations';
import type { NavWarning } from '@shared/domain/navWarnings';
import type { SanctionedShipSighting } from '@shared/domain/sanctionedShips';
import { nearbyLines, type UnderseaLine } from '@shared/domain/undersea';
import { inShape, type WatchShape } from '@shared/domain/watchAreas';

/** What lies inside a watch area, from what the app has loaded (v0.74.0). */
export interface AreaContents {
  /** Exactly located records inside, newest first. */
  records: IntelligenceEvent[];
  aircraft: AircraftPosition[];
  emergencies: EmergencyAircraft[];
  ships: SanctionedShipSighting[];
  navWarnings: NavWarning[];
  gnssCells: GnssCell[];
  lostGps: GnssLostPoint[];
  conflicts: ConflictEvent[];
  bases: { key: string; name: string }[];
  sites: { id: string; name: string; type: string; flagged: boolean }[];
  lines: UnderseaLine[];
}

export interface AreaSources {
  events?: IntelligenceEvent[];
  aircraft?: AircraftPosition[];
  emergencies?: EmergencyAircraft[];
  ships?: SanctionedShipSighting[];
  navWarnings?: NavWarning[];
  gnssCells?: GnssCell[];
  lostGps?: GnssLostPoint[];
  conflicts?: ConflictEvent[];
  bases?: Installation[];
  worldBases?: WorldInstallation[];
  sites?: InfraSite[];
  flaggedSites?: FlaggedSite[];
  lines?: UnderseaLine[];
}

const t = (e: IntelligenceEvent) => e.occurredAt ?? e.publishedAt ?? e.collectedAt;

export function areaContents(shape: WatchShape, s: AreaSources): AreaContents {
  const inside = (lat: number, lon: number) => inShape(shape, lat, lon);
  const flagged = new Set((s.flaggedSites ?? []).map((f) => f.id));
  const sites = new Map<string, AreaContents['sites'][number]>();
  for (const f of s.flaggedSites ?? []) if (inside(f.lat, f.lon)) sites.set(f.id, { id: f.id, name: f.name, type: f.type, flagged: true });
  for (const x of s.sites ?? []) if (!sites.has(x.id) && inside(x.la, x.lo)) sites.set(x.id, { id: x.id, name: x.n[0], type: x.t, flagged: flagged.has(x.id) });
  return {
    records: (s.events ?? [])
      .filter((e) => e.locationPrecision === 'exact' && typeof e.latitude === 'number' && typeof e.longitude === 'number' && inside(e.latitude, e.longitude))
      .sort((a, b) => t(b).localeCompare(t(a))),
    aircraft: (s.aircraft ?? []).filter((a) => inside(a.la, a.lo)),
    emergencies: (s.emergencies ?? []).filter((a) => inside(a.la, a.lo)),
    ships: (s.ships ?? []).filter((x) => inside(x.la, x.lo)),
    navWarnings: (s.navWarnings ?? []).filter((w) => w.points.some(([la, lo]) => inside(la, lo)) || (w.lat != null && w.lon != null && inside(w.lat, w.lon))),
    gnssCells: (s.gnssCells ?? []).filter((c) => {
      const [la, lo] = cellCentre(c.k);
      return inside(la, lo);
    }),
    lostGps: (s.lostGps ?? []).filter((p) => inside(p.la, p.lo)),
    conflicts: (s.conflicts ?? []).filter((c) => inside(c.la, c.lo)),
    bases: [
      ...(s.bases ?? []).filter((b) => inside(b.lat, b.lon)).map((b) => ({ key: `dod:${b.name}`, name: b.name })),
      ...(s.worldBases ?? []).filter((b) => inside(b.la, b.lo)).map((b) => ({ key: `wd:${b.q}`, name: b.n })),
    ],
    sites: [...sites.values()],
    // Circles: distance to each segment (a cable can cross a small circle between mapped points).
    // Polygons: a mapped point inside.
    lines:
      shape.kind === 'circle'
        ? nearbyLines(s.lines ?? [], shape.lat, shape.lon, shape.radiusKm).map((x) => x.line)
        : (s.lines ?? []).filter((l) => l.g.some((part) => part.some(([lo, la]) => inside(la, lo)))),
  };
}

/** Records inside in the last `hours`. */
export const recentInside = (c: AreaContents, now: number, hours: number) => c.records.filter((e) => now - Date.parse(t(e)) <= hours * 3_600_000);
