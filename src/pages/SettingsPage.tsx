import { useEffect } from 'react';
import { useSettings, type OperatorSettings } from '../state/SettingsContext';
import { Panel } from '../components/ui/Panel';

const OPTIONS: { key: keyof OperatorSettings; label: string; help: string }[] = [
  { key: 'scanlines', label: 'CRT SCANLINES', help: 'Static horizontal scanline overlay.' },
  { key: 'glow', label: 'PHOSPHOR GLOW', help: 'Soft glow on headings.' },
  {
    key: 'flicker',
    label: 'SCREEN FLICKER',
    help: 'Subtle periodic brightness flicker. Off by default; always suppressed if your OS requests reduced motion.',
  },
  { key: 'graticule', label: 'MAP GRID', help: '30° latitude/longitude graticule.' },
  { key: 'regionOutlines', label: 'WATCH-AREA OUTLINES', help: 'Dashed watch-region boxes and area-level counts on the map.' },
];

export default function SettingsPage() {
  const { settings, update, reset } = useSettings();
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
          Settings are stored in this browser only. They will sync to Firestore once authentication is added in Phase 2.
        </p>
      </Panel>
    </div>
  );
}
