import { useEffect } from 'react';
import { useSettings, type OperatorSettings } from '../state/SettingsContext';
import { useAuth } from '../state/AuthContext';
import { ROLE_HELP, ROLE_LABEL } from '@shared/domain/members';
import { Panel } from '../components/ui/Panel';
import { WatchlistPanel } from '../components/watchlist/WatchlistPanel';

/** The on/off settings (the base operator filter is chosen on the GOC map). */
type BooleanSetting = { [K in keyof OperatorSettings]: OperatorSettings[K] extends boolean ? K : never }[keyof OperatorSettings];

const OPTIONS: { key: BooleanSetting; label: string; help: string }[] = [
  { key: 'scanlines', label: 'CRT SCANLINES', help: 'Static horizontal scanline overlay.' },
  { key: 'glow', label: 'PHOSPHOR GLOW', help: 'Soft glow on headings.' },
  {
    key: 'flicker',
    label: 'SCREEN FLICKER',
    help: 'Subtle periodic brightness flicker. Off by default; always suppressed if your OS requests reduced motion.',
  },
  { key: 'graticule', label: 'MAP GRID', help: '30° latitude/longitude graticule.' },
  { key: 'regionOutlines', label: 'WATCH-AREA OUTLINES', help: 'Dashed watch-region boxes and area-level counts on the map.' },
  { key: 'installations', label: 'MILITARY INSTALLATIONS', help: 'DoD sites in the US and Wikidata sites worldwide on the map. Filter by operating country from the GOC map header.' },
  { key: 'aircraft', label: 'MILITARY AIRCRAFT', help: 'Military aircraft seen on ADS-B (adsb.lol) at the last collection run, on the GOC map. Only aircraft that broadcast are shown.' },
  { key: 'fleet', label: 'US NAVY FLEET', help: 'Carriers and other deployed ships by named sea area, from the weekly USNI News Fleet and Marine Tracker. Approximate.' },
  { key: 'chokepoints', label: 'CHOKEPOINT TRAFFIC', help: 'Daily ship transits through six straits and canals (IMF PortWatch, about 6 days behind), coloured by change from the 2025 average.' },
  { key: 'sanctionedShips', label: 'SANCTIONED VESSELS', help: 'Ships on the US, EU or UK sanctions lists seen on AIS in the Baltic and North Sea over the last 48 hours.' },
  { key: 'radiation', label: 'RADIATION', help: 'Radiation stations above their usual level (Germany BfS, Finland STUK, US EPA RadNet). Stations at their usual level are not drawn.' },
  { key: 'faa', label: 'FAA AIRSPACE', help: 'FAA VIP, security and special flight restrictions (outlines, solid while active) and airports with ground stops, ground delay programs, delays or closures.' },
  { key: 'powerOutages', label: 'US POWER OUTAGES', help: 'US counties with customers without power, from the utilities that report to ODIN (US Department of Energy / Oak Ridge National Laboratory), shaded by the number out.' },
];

export default function SettingsPage() {
  const { settings, update, reset } = useSettings();
  const { status, user, role, signOut } = useAuth();
  useEffect(() => {
    document.title = 'WATCHTOWER // SETTINGS';
  }, []);

  return (
    <div className="h-full overflow-y-auto p-1.5">
      <Panel
        title="Operator Settings"
        designator="O1"
        className="max-w-2xl"
        actions={
          <button onClick={reset} className="text-2xs text-wt-fg-muted hover:text-wt-fg">
            [RESTORE DEFAULTS]
          </button>
        }
      >
        <fieldset className="divide-y divide-wt-line">
          <legend className="sr-only">Visual effects and map display</legend>
          {OPTIONS.map((o) => (
            <label key={o.key} className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-wt-bg2">
              <input
                type="checkbox"
                checked={settings[o.key]}
                onChange={(e) => update({ [o.key]: e.target.checked })}
                className="mt-0.5 size-3.5 accent-[#6aff9b]"
              />
              <span>
                <span className="block text-xs tracking-wider">{o.label}</span>
                <span className="block text-2xs text-wt-fg-muted">{o.help}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="border-t border-wt-line px-3 py-2 text-2xs text-wt-fg-dim">
          Display settings are stored in this browser only.
        </p>
      </Panel>
      <div className="mt-1.5">
        <WatchlistPanel />
      </div>
      {status === 'signed-in' && (
        <Panel title="Operator Account" designator="O2" className="mt-1.5 max-w-2xl">
          <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs">
            <span className="text-wt-fg-dim">SIGNED IN AS</span>
            <span className="break-all">{user?.email}</span>
            {role && (
              <span className="text-2xs text-wt-fg-muted" title={ROLE_HELP[role]}>
                ROLE <span className="text-wt-fg">{ROLE_LABEL[role].toUpperCase()}</span>
              </span>
            )}
            <button
              onClick={() => void signOut()}
              className="ml-auto border border-wt-line-strong px-2 py-0.5 text-2xs tracking-widest text-wt-fg-muted hover:border-wt-fg hover:text-wt-fg"
            >
              SIGN OUT
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}
