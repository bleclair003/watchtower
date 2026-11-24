import { INFRA_LABEL, INFRA_TYPES } from '@shared/domain/infrastructure';
import { tfrActive, type AirportEvent, type TfrShape } from '@shared/domain/faa';
import { NETWORK_LABEL, type RadiationSnapshot } from '@shared/domain/radiation';
import { GNSS_LEVEL_LABEL, type GnssSnapshot } from '@shared/domain/gnss';
import type { ConvergenceSnapshot } from '@shared/domain/convergence';
import { UNDERSEA_LABEL, type UnderseaKind } from '@shared/domain/undersea';
import { DISPUTED_COLOR, GNSS_COLOR, LANE_COLOR, TRAFFIC_COLOR, UNDERSEA_COLOR, CONVERGENCE_COLOR } from './WorldMap';
import { NAV_KIND_LABEL, type NavWarningKind, type NavWarningSnapshot } from '@shared/domain/navWarnings';
import type { EmergencySnapshot } from '@shared/domain/aircraftEmergencies';
import { VIOLENCE_LABEL, monthName, type ConflictSnapshot } from '@shared/domain/conflictEvents';
import { CONFLICT_COLOR, EMERGENCY_COLOR, NAV_COLOR, AIRCRAFT_COLOR, AIRCRAFT_PATH, AIRPORT_COLOR, RADIATION_COLOR, FLEET_COLOR, INFRA_COLOR, POWER_STEPS, TFR_COLOR, SANCTIONED_SHIP_COLOR, SHIP_PATH, BRANCH_COLOR, OPERATION_COLOR, OPERATION_LABEL } from './WorldMap';
import { AIRCRAFT_CLASSES, AIRCRAFT_CLASS_LABEL } from '@shared/domain/aircraft';
import { useState } from 'react';
import { EVENT_CATEGORIES } from '@shared/domain/types';
import { CATEGORY_STYLES } from '../../config/categories';
import { CategoryGlyph } from '../ui/CategoryGlyph';
import { formatUtc } from '../../lib/time';

const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

interface Props {
  plotted: number;
  areaLevel: number;
  unlocated: number;
  /** Installations shown on the map (omit when the layer is off). */
  installations?: number;
  worldInstallations?: number;
  /** Installations flagged for unusual activity this week (null = flags not active yet). */
  unusualBases?: number | null;
  /** Infrastructure layer: all sites shown (count, or null when only flagged ones), flagged count. */
  infrastructure?: { all: number | null; flagged: number; simulated: boolean };
  /** Undersea lines by kind, and disputed areas (v0.71.0; omit when off). */
  undersea?: Record<UnderseaKind, number> | null;
  /** Tanker and cargo traffic (omit when off; null while loading) and lanes (v0.75.0). */
  traffic?: { tankers: number; cargo: number; typesKnown: number; totalSeen: number; ageMinutes: number; simulated: boolean; fintraffic?: number | null; dark?: number } | null;
  lanes?: boolean;
  disputed?: number | null;
  /** Radiation layer (omit when off). */
  radiation?: RadiationSnapshot;
  gnss?: GnssSnapshot & { ageMinutes: number };
  /** v0.79.0: signal convergence hotspots. */
  convergence?: ConvergenceSnapshot;
  /** Phase 25 layers (omit when off). */
  navWarnings?: NavWarningSnapshot;
  emergencies?: EmergencySnapshot;
  conflicts?: ConflictSnapshot;
  /** Conflict time filter: days shown (null = whole month), span shown, events in the release. */
  conflictWindow?: { from: string | null; to: string | null; days: number | null; total: number };
  /** Navigational warnings issued within this many days (null = any age). */
  navWarnDays?: number | null;
  /** FAA layer (omit when off). */
  faa?: { tfrs: TfrShape[]; airports: AirportEvent[]; now: number; simulated: boolean };
  /** US power outages layer (omit when off). */
  power?: { total: number; states: number; counties: number; utilities: number; ageMinutes: number; simulated: boolean };
  /** Name of the operating country the bases are filtered to, if any. */
  operatorFilter?: string;
  /** Aircraft layer: count shown, snapshot age, provider (omit when the layer is off). */
  aircraft?: { count: number; ageMinutes: number; stale: boolean; provider: string; simulated: boolean; patternsFrom?: string | null; now?: number };
  /** Fleet layer: big decks listed, tracker date (omit when the layer is off). */
  fleet?: { bigDecks: number; ships: number; asOf: string; stale: boolean; simulated: boolean };
  /** Sanctioned vessels layer (omit when off). */
  sanctioned?: { count: number; listenedMinutesAgo: number; shipsHeard: number; simulated: boolean };
  /** Satellite imagery shown (omit when off). */
  imagery?: { label: string; date: string; note: string };
}

const BRANCH_LABEL = { army: 'Army', navy: 'Navy', 'air-force': 'Air Force', marines: 'Marines', other: 'Other DoD' } as const;

/** Collapsible legend explaining symbols and location-precision handling. */
export function MapLegend({ plotted, areaLevel, unlocated, installations, worldInstallations, unusualBases, infrastructure, undersea, disputed, traffic, lanes, power, faa, radiation, gnss, convergence, navWarnings, emergencies, conflicts, conflictWindow, navWarnDays, operatorFilter, aircraft, fleet, sanctioned, imagery }: Props) {
  // Closed by default on phones, where it would cover most of the map.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.matchMedia?.('(min-width: 768px)').matches !== false);
  return (
    <div className="pointer-events-auto absolute bottom-2 left-2 z-10 flex max-h-[calc(100%-1rem)] max-w-[230px] flex-col border border-wt-line-strong bg-wt-panel/95 text-2xs">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full shrink-0 items-center justify-between px-2 py-1 tracking-widest text-wt-fg-muted hover:text-wt-fg"
      >
        LEGEND <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="min-h-0 space-y-1.5 overflow-y-auto border-t border-wt-line p-2" tabIndex={0} role="region" aria-label="Map legend">
          <ul className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {EVENT_CATEGORIES.map((c) => (
              <li key={c} className="flex items-center gap-1 text-wt-fg">
                <CategoryGlyph category={c} size={10} />
                <span className="text-wt-fg-muted">{CATEGORY_STYLES[c].label}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
            <div className="flex justify-between">
              <span>Plotted (exact/city)</span>
              <span className="text-wt-fg tabular-nums">{plotted}</span>
            </div>
            <div className="flex justify-between" title="Country- or region-level reports. Counted on the dashed watch area, never pinned to an invented point.">
              <span>Area-level (dashed box)</span>
              <span className="text-wt-fg tabular-nums">{areaLevel}</span>
            </div>
            <div className="flex justify-between">
              <span>No geography (feed only)</span>
              <span className="text-wt-fg tabular-nums">{unlocated}</span>
            </div>
          </div>
          {installations !== undefined && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              {operatorFilter && <p className="text-wt-info">Operated by {operatorFilter} only</p>}
              <div className="flex justify-between">
                <span title="Bases are drawn as dots and rings">● Bases: DoD, US</span>
                <span className="text-wt-fg tabular-nums">{installations}</span>
              </div>
              <ul className="grid grid-cols-2 gap-x-2">
                {(['army', 'navy', 'air-force', 'marines', 'other'] as const).map((b) => (
                  <li key={b} className="flex items-center gap-1">
                    <span className="size-2 rounded-full" style={{ background: BRANCH_COLOR[b] }} aria-hidden />
                    {BRANCH_LABEL[b]}
                  </li>
                ))}
              </ul>
              {worldInstallations !== undefined && (
                <>
                  <div className="flex justify-between pt-1">
                    <span title="Wikidata, community-maintained">Worldwide (Wikidata)</span>
                    <span className="text-wt-fg tabular-nums">{worldInstallations}</span>
                  </div>
                  <ul>
                    {(['us-abroad', 'foreign', 'national'] as const).map((o) => (
                      <li key={o} className="flex items-center gap-1">
                        <span className="size-2 rounded-full border-[1.5px]" style={{ borderColor: OPERATION_COLOR[o] }} aria-hidden />
                        {OPERATION_LABEL[o]}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="flex items-center gap-1 pt-1" title="At least 3 records from 2+ sources this week and 3× the usual week">
                <span className="size-2.5 rounded-full border-[1.8px]" style={{ borderColor: '#e8b04a' }} aria-hidden />
                <span>Unusual activity this week</span>
                <span className="ml-auto text-wt-fg tabular-nums">{unusualBases === null || unusualBases === undefined ? 'building baseline' : unusualBases}</span>
              </div>
            </div>
          )}
          {traffic !== undefined && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <div className="flex justify-between">
                <span>Tankers and cargo ships{traffic?.simulated ? ' · SIMULATED' : ''}</span>
                <span className="text-wt-fg tabular-nums">{traffic ? traffic.tankers + traffic.cargo : 'loading'}</span>
              </div>
              {traffic && (
                <>
                  <ul className="space-y-0.5">
                    {(['tanker', 'cargo'] as const).map((k) => (
                      <li key={k} className="flex items-center gap-1">
                        <span className="size-2 rounded-full" style={{ background: TRAFFIC_COLOR[k] }} aria-hidden />
                        <span className="flex-1">{k === 'tanker' ? 'Tankers' : 'Cargo ships'}</span>
                        <span className="tabular-nums">{k === 'tanker' ? traffic.tankers : traffic.cargo}</span>
                      </li>
                    ))}
                    <li className="flex items-center gap-1" title="Stopped broadcasting AIS at sea while under way, where other ships were still heard (Finnish waters, last 48 h)">
                      <span className="size-2 rounded-full border border-[#ff4d6d]" aria-hidden />
                      <span className="flex-1">Went dark (last known position)</span>
                      <span className="tabular-nums">{traffic.dark ?? 0}</span>
                    </li>
                  </ul>
                  <p className="text-wt-fg-dim">
                    Arrow = course; faint line = last 24 h, one point a run. Baltic, North Sea, Black Sea and eastern Mediterranean only: aisstream.io volunteers, plus every ship Finland's receivers hear (Source: <a href="https://www.digitraffic.fi/en/terms-of-service/" target="_blank" rel="noopener noreferrer nofollow" className="underline">Fintraffic / digitraffic.fi</a> (CC BY 4.0)){traffic.fintraffic != null ? `, ${traffic.fintraffic} positions last run` : ''}. None in the Gulf, Red Sea or Asia.
                    {traffic.totalSeen > traffic.tankers + traffic.cargo && ` ${traffic.totalSeen} seen in 24 h, the ${traffic.tankers + traffic.cargo} most relevant shown.`} {traffic.typesKnown.toLocaleString('en-US')} ship types remembered. Listened {traffic.ageMinutes} min ago.
                  </p>
                </>
              )}
            </div>
          )}
          {lanes && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <div className="flex items-center gap-1">
                <span className="h-0.5 w-3 border-t border-dashed" style={{ borderColor: LANE_COLOR }} aria-hidden />
                Shipping lanes (major, middle, minor)
              </div>
              <p className="text-wt-fg-dim">Where traffic usually runs, from the CIA ocean map (2012) via Benden 2022, CC BY-SA 4.0. Not live.</p>
            </div>
          )}
          {undersea !== undefined && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <div className="flex justify-between">
                <span>Undersea cables and pipelines</span>
                <span className="text-wt-fg tabular-nums">{undersea ? Object.values(undersea).reduce((a, b) => a + b, 0) : 'loading'}</span>
              </div>
              <ul className="space-y-0.5">
                {(['telecom', 'power', 'pipeline'] as const).map((k) => (
                  <li key={k} className="flex items-center gap-1">
                    <span className="h-0.5 w-3" style={{ background: UNDERSEA_COLOR[k] }} aria-hidden />
                    <span className="flex-1">{UNDERSEA_LABEL[k]}</span>
                    <span className="tabular-nums">{undersea?.[k] ?? '—'}</span>
                  </li>
                ))}
              </ul>
              <p className="text-wt-fg-dim">Watch-region seas only, as traced on OpenStreetMap (© contributors, ODbL): approximate, and some cables are missing.</p>
            </div>
          )}
          {disputed !== undefined && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <div className="flex items-center justify-between gap-1">
                <span className="flex items-center gap-1">
                  <span className="size-2 border border-dashed" style={{ borderColor: DISPUTED_COLOR }} aria-hidden />
                  Disputed and breakaway areas
                </span>
                <span className="text-wt-fg tabular-nums">{disputed ?? 'loading'}</span>
              </div>
              <p className="text-wt-fg-dim">Natural Earth (public domain): de facto lines with the claims noted. Can lag events; not front lines.</p>
            </div>
          )}
          {infrastructure && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <div className="flex justify-between">
                <span title="Infrastructure is drawn as squares">■ Infrastructure{infrastructure.simulated ? ' · SIMULATED' : ''}</span>
                <span className="text-wt-fg tabular-nums">{infrastructure.all ?? 'flagged only'}</span>
              </div>
              {infrastructure.all !== null && (
                <ul className="grid grid-cols-2 gap-x-2">
                  {INFRA_TYPES.map((t) => (
                    <li key={t} className="flex items-center gap-1">
                      <span className="size-2 rounded-[1px]" style={{ background: INFRA_COLOR[t] }} aria-hidden />
                      {INFRA_LABEL[t].replace(' (500 MW+)', '')}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-1" title="A new fire cluster or military record nearby, or a record naming the site, in 72 hours">
                <span className="size-2.5 rounded-[1px] border-[1.8px]" style={{ borderColor: '#ff5555' }} aria-hidden />
                <span>Records near or naming it (72 h)</span>
                <span className="ml-auto text-wt-fg tabular-nums">{infrastructure.flagged}</span>
              </div>
            </div>
          )}
          {convergence && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <div className="flex justify-between">
                <span title="Places where different kinds of signal from separate feeds line up, last 72 hours">Signal convergence{convergence.simulated ? ' · SIMULATED' : ''}</span>
                <span className="text-wt-fg tabular-nums">{convergence.hotspots.length}</span>
              </div>
              <ul className="space-y-0.5">
                {(['strong', 'watch'] as const).map((k) => (
                  <li key={k} className="flex items-center gap-1">
                    <span className="size-2 rounded-full border-2" style={{ borderColor: CONVERGENCE_COLOR[k] }} aria-hidden />
                    <span className="flex-1">{k === 'strong' ? 'Strong: 3+ independent feeds' : 'Watch: 2 independent feeds'}</span>
                    <span className="tabular-nums">{convergence.hotspots.filter((h) => h.level === k).length}</span>
                  </li>
                ))}
              </ul>
              <p className="text-wt-fg-dim">
                The number on a marker is its feed count. From {convergence.signalsChecked} located signals, last {convergence.windowHours} h, within {convergence.radiusKm} km. A coincidence worth a look, not proof of a link.
              </p>
            </div>
          )}
          {gnss && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <div className="flex justify-between">
                <span title="Share of aircraft reporting degraded GPS accuracy per 1° square, last 24 hours">GPS interference{gnss.simulated ? ' · SIMULATED' : ''}</span>
                <span className="text-wt-fg tabular-nums">{gnss.cells.filter((c) => c.level === 'high').length} high</span>
              </div>
              <ul className="space-y-0.5">
                {(['high', 'medium', 'low'] as const).map((k) => (
                  <li key={k} className="flex items-center gap-1">
                    <span className="size-2" style={{ background: GNSS_COLOR[k], opacity: k === 'low' ? 0.6 : 1 }} aria-hidden />
                    <span className="flex-1">{GNSS_LEVEL_LABEL[k]}</span>
                    <span className="tabular-nums">{gnss.cells.filter((c) => c.level === k).length}</span>
                  </li>
                ))}
                <li className="flex items-center gap-1">
                  <span className="size-2 rounded-full border" style={{ borderColor: GNSS_COLOR.high }} aria-hidden />
                  <span className="flex-1">GPS lost here (last good position)</span>
                  <span className="tabular-nums">{gnss.lost.length}</span>
                </li>
              </ul>
              <p className="text-wt-fg-dim">
                {gnss.degraded.toLocaleString('en-US')} of {gnss.sightings.toLocaleString('en-US')} aircraft sightings degraded, last {gnss.windowHours} h. Sampled hourly in {gnss.circles.length} circles (dotted); last sample {gnss.ageMinutes} min ago
                {gnss.failed.length > 0 && <span className="text-wt-warn"> · {gnss.failed.length} circle(s) not sampled</span>}. Says where, not who.
              </p>
            </div>
          )}
          {radiation && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <div className="flex justify-between">
                <span title="Ambient gamma dose rate, each station against its own usual level">Radiation{radiation.simulated ? ' · SIMULATED' : ''}</span>
                <span className="text-wt-fg tabular-nums">{radiation.flagged.length} above usual</span>
              </div>
              <ul>
                {radiation.networks.map((n) => (
                  <li key={n.network} className="flex justify-between">
                    <span>{NETWORK_LABEL[n.network]}</span>
                    <span className="tabular-nums">{n.stations} stations</span>
                  </li>
                ))}
              </ul>
              <ul className="grid grid-cols-2 gap-x-2">
                {(['elevated', 'high'] as const).map((k) => (
                  <li key={k} className="flex items-center gap-1">
                    <span className="size-2 rounded-full" style={{ background: RADIATION_COLOR[k] }} aria-hidden />
                    {k === 'high' ? 'High (0.5+ µSv/h)' : '2× usual or more'}
                  </li>
                ))}
              </ul>
              <p className="text-wt-fg-dim">Only stations above their usual level are drawn. Rain can double readings for a few hours.</p>
            </div>
          )}
          {conflicts && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <div className="flex justify-between">
                <span title="UCDP Georeferenced Event Dataset, monthly candidate release, CC BY 4.0">Conflict events (UCDP){conflicts.simulated ? ' · SIMULATED' : ''}</span>
                <span className="text-wt-fg tabular-nums">
                  {conflicts.events.length}
                  {conflictWindow && conflictWindow.days != null && ` of ${conflictWindow.total}`}
                </span>
              </div>
              <ul>
                {([1, 2, 3] as const).map((t) => (
                  <li key={t} className="flex items-center gap-1">
                    <span className="size-2 rounded-full" style={{ background: CONFLICT_COLOR[t] }} aria-hidden />
                    {VIOLENCE_LABEL[t]}
                  </li>
                ))}
              </ul>
              <p className="text-wt-fg-dim">
                {conflictWindow?.from && conflictWindow.to ? `Showing ${shortDay(conflictWindow.from)} to ${shortDay(conflictWindow.to)}` : monthName(conflicts.month)}
                {conflictWindow?.days != null && ' (latest days of the release)'}. About a month behind; size = deaths (best estimate). Preliminary data.
              </p>
            </div>
          )}
          {navWarnings && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <div className="flex justify-between">
                <span title="NGA Maritime Safety Information broadcast warnings (NAVAREA IV/XII, HYDROLANT, HYDROPAC, HYDROARC)">Navigational warnings{navWarnings.simulated ? ' · SIMULATED' : ''}</span>
                <span className="text-wt-fg tabular-nums">{navWarnings.warnings.length} of {navWarnings.activeTotal}</span>
              </div>
              <ul className="grid grid-cols-2 gap-x-2">
                {(['missile', 'firing', 'exercise', 'gnss', 'piracy', 'mine', 'cable'] as NavWarningKind[]).map((k) => (
                  <li key={k} className="flex items-center gap-1">
                    <span className="size-2 rounded-full border-2" style={{ borderColor: NAV_COLOR[k] }} aria-hidden />
                    {NAV_KIND_LABEL[k]}
                  </li>
                ))}
              </ul>
              <p className="text-wt-fg-dim">
                Active warnings of these kinds{navWarnDays != null && `, issued in the last ${navWarnDays === 2 ? '48 hours' : `${navWarnDays} days`}`}; dashed lines are the warned areas.
              </p>
              {navWarnings.via === 'daily-files' && (
                <p className="text-wt-warn">
                  NGA's portal is down for maintenance: read from the daily in-force lists it posts instead
                  {navWarnings.asOf ? `, in force as of ${formatUtc(navWarnings.asOf)}` : ''}. Warnings issued since then are missing.
                </p>
              )}
            </div>
          )}
          {emergencies && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1" title="Aircraft squawking 7500, 7600 or 7700 (adsb.lol, ODbL)">
                  <span className="size-2 rounded-full" style={{ background: EMERGENCY_COLOR }} aria-hidden />
                  Aircraft emergencies{emergencies.simulated ? ' · SIMULATED' : ''}
                </span>
                <span className="text-wt-fg tabular-nums">{emergencies.aircraft.length}</span>
              </div>
              <p className="text-wt-fg-dim">Codes are set by crews, not verified; 7500 is often a mis-set transponder.</p>
            </div>
          )}
          {faa && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <div className="flex justify-between">
                <span title="FAA temporary flight restrictions (VIP, security, special) and National Airspace System status">FAA airspace{faa.simulated ? ' · SIMULATED' : ''}</span>
                <span className="text-wt-fg tabular-nums">{faa.tfrs.filter((t) => tfrActive(t, faa.now)).length} active</span>
              </div>
              <ul className="grid grid-cols-3 gap-x-2">
                {(['VIP', 'SECURITY', 'SPECIAL'] as const).map((t) => (
                  <li key={t} className="flex items-center gap-1">
                    <span className="size-2 border border-dashed" style={{ borderColor: TFR_COLOR[t], background: `${TFR_COLOR[t]}55` }} aria-hidden />
                    {t === 'SECURITY' ? 'Security' : t === 'SPECIAL' ? 'Special' : 'VIP'}
                  </li>
                ))}
              </ul>
              <p className="text-wt-fg-dim">Restrictions: solid while active, faint before they start.</p>
              <ul className="grid grid-cols-2 gap-x-2">
                {([['ground-stop', 'Ground stop'], ['ground-delay', 'Delay program'], ['departure-delay', 'Delays'], ['closure', 'Closed']] as const).map(([k, label]) => (
                  <li key={k} className="flex items-center gap-1">
                    <span className="size-2 rounded-full" style={{ background: AIRPORT_COLOR[k] }} aria-hidden />
                    {label} ({faa.airports.filter((a) => (k === 'departure-delay' ? a.kind.endsWith('delay') && a.kind !== 'ground-delay' : a.kind === k)).length})
                  </li>
                ))}
              </ul>
              <p className="text-wt-fg-dim">White ring: a cause other than weather, volume or runway work.</p>
            </div>
          )}
          {power && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <div className="flex justify-between">
                <span title="Customers without power, from the utilities that report to ODIN (US Department of Energy / Oak Ridge National Laboratory)">US power outages (ODIN){power.simulated ? ' · SIMULATED' : ''}</span>
                <span className="text-wt-fg tabular-nums">{power.total.toLocaleString('en-US')}</span>
              </div>
              <p className="text-wt-fg-dim">
                Customers out in {power.states} states · {power.counties} counties shaded · {power.ageMinutes} min ago · {power.utilities} reporting utilities only
              </p>
              <ul className="grid grid-cols-2 gap-x-2">
                {POWER_STEPS.map(([n, color]) => (
                  <li key={n} className="flex items-center gap-1">
                    <span className="size-2 opacity-80" style={{ background: color }} aria-hidden />
                    {n >= 1000 ? `${n / 1000}k` : n}+ out
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fleet && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <div className="flex justify-between">
                <span title="USNI News Fleet and Marine Tracker, weekly, approximate areas">US Navy (USNI){fleet.simulated ? ' · SIMULATED' : ''}</span>
                <span className="text-wt-fg tabular-nums">{fleet.ships}</span>
              </div>
              <p className={fleet.stale ? 'text-wt-warn' : 'text-wt-fg-dim'}>
                As of {fleet.asOf}{fleet.stale ? ' (out of date)' : ''} · approximate areas
              </p>
              <ul className="grid grid-cols-2 gap-x-2">
                {([['bigDeck', `Carrier / big deck (${fleet.bigDecks})`], ['other', 'Other ships']] as const).map(([k, label]) => (
                  <li key={k} className="flex items-center gap-1">
                    <svg viewBox="0 0 20 20" className="size-2.5 shrink-0" aria-hidden>
                      <path d={SHIP_PATH} fill={FLEET_COLOR[k]} />
                    </svg>
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {imagery && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <p className="text-wt-fg">
                {imagery.label} · {imagery.date}
              </p>
              <p className="text-wt-fg-dim">{imagery.note} NASA EOSDIS GIBS.</p>
            </div>
          )}
          {sanctioned && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <div className="flex justify-between">
                <span className="flex items-center gap-1" title="Ships on the US, EU or UK sanctions lists seen on AIS, Baltic and North Sea, last 48 h">
                  <svg viewBox="0 0 20 20" className="size-2.5 shrink-0" aria-hidden>
                    <path d={SHIP_PATH} fill={SANCTIONED_SHIP_COLOR} />
                  </svg>
                  Sanctioned vessels (48 h){sanctioned.simulated ? ' · SIMULATED' : ''}
                </span>
                <span className="text-wt-fg tabular-nums">{sanctioned.count}</span>
              </div>
              <p className="text-wt-fg-dim">
                Baltic, North Sea, Black Sea, eastern Mediterranean · {sanctioned.shipsHeard.toLocaleString('en-US')} ships heard {sanctioned.listenedMinutesAgo} min ago · aisstream.io and <a href="https://www.digitraffic.fi/en/terms-of-service/" target="_blank" rel="noopener noreferrer nofollow" className="underline">Fintraffic / digitraffic.fi</a> (CC BY 4.0)
              </p>
            </div>
          )}
          {aircraft && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              <div className="flex justify-between">
                <span title="Aircraft flagged military that broadcast ADS-B, at the last collection run">Aircraft (ADS-B){aircraft.simulated ? ' · SIMULATED' : ''}</span>
                <span className="text-wt-fg tabular-nums">{aircraft.stale ? 0 : aircraft.count}</span>
              </div>
              {aircraft.stale ? (
                <p className="text-wt-warn">Positions out of date ({aircraft.ageMinutes} min old): not shown.</p>
              ) : (
                <p className="text-wt-fg-dim">
                  Snapshot {aircraft.ageMinutes} min ago · {aircraft.provider}
                </p>
              )}
              <ul className="grid grid-cols-2 gap-x-2">
                {AIRCRAFT_CLASSES.map((c) => (
                  <li key={c} className="flex items-center gap-1">
                    <svg viewBox="0 0 20 20" className="size-2.5 shrink-0" aria-hidden>
                      <path d={AIRCRAFT_PATH} fill={AIRCRAFT_COLOR[c]} />
                    </svg>
                    {AIRCRAFT_CLASS_LABEL[c].split(' / ')[0]}
                  </li>
                ))}
              </ul>
              {aircraft.patternsFrom && (
                <p className="text-wt-fg-dim" title="Holds where that kind of aircraft has not held in 30 days, and aircraft types new to a watch area in 30 days. They appear in the feed as military records.">
                  {aircraft.now !== undefined && aircraft.now < Date.parse(aircraft.patternsFrom)
                    ? `Unusual movement: learning what is usual, flags from ${shortDay(aircraft.patternsFrom.slice(0, 10))}.`
                    : 'Unusual movement: watching for new holds and new types.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
