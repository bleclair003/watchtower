import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readStorage, writeStorage } from '../lib/storage';

export interface OperatorSettings {
  /** CRT scanline overlay. */
  scanlines: boolean;
  /** Subtle phosphor text glow. */
  glow: boolean;
  /** Screen flicker. Off by default; always suppressed under prefers-reduced-motion. */
  flicker: boolean;
  /** Lat/long grid on the map. */
  graticule: boolean;
  /** Watch-area outlines on the map. */
  regionOutlines: boolean;
  /** Military installations layer on the map. */
  installations: boolean;
  /** Only bases operated by this country (ISO alpha-2), or 'ALL'. */
  installationsOperator: string;
  /** Military aircraft (ADS-B) layer on the map. */
  aircraft: boolean;
  /** US Navy fleet (USNI tracker) layer on the map. */
  fleet: boolean;
  /** Chokepoint traffic (IMF PortWatch) on the map. */
  chokepoints: boolean;
  /** Sanctioned vessels (AIS, Baltic and North Sea) on the map. */
  sanctionedShips: boolean;
  /** All critical-infrastructure sites on the map (flagged sites are always shown). */
  infrastructure: boolean;
  /** US power outages by county (ODIN) on the map. */
  powerOutages: boolean;
  /** FAA flight restrictions and airport ground stops / delays on the map. */
  faa: boolean;
  /** Radiation stations above their usual level (Germany, Finland, US) on the map. */
  radiation: boolean;
  /** NGA navigational warnings (missile firings, exercises, GPS interference …) on the map. */
  navWarnings: boolean;
  /** UCDP conflict events (last monthly release) on the map. */
  conflicts: boolean;
  /** GPS interference squares and lost-GPS points (aircraft position accuracy) on the map. */
  gnss: boolean;
  /** Conflict events from the last N days of the release; null = whole month. */
  conflictDays: number | null;
  /** Navigational warnings issued in the last N days; null = any age. */
  navWarnDays: number | null;
  /** Satellite imagery product on the GOC map ('off', 'viirs', 'modis', 'night', 'night-2016'). */
  imagery: string;
  /** Imagery day (YYYY-MM-DD); empty = yesterday. */
  imageryDate: string;
}

export const DEFAULT_SETTINGS: OperatorSettings = {
  scanlines: true,
  glow: true,
  flicker: false,
  graticule: true,
  regionOutlines: true,
  installations: true,
  installationsOperator: 'ALL',
  aircraft: true,
  fleet: true,
  chokepoints: true,
  sanctionedShips: true,
  infrastructure: false,
  powerOutages: true,
  faa: true,
  radiation: true,
  navWarnings: true,
  conflicts: true,
  gnss: true,
  conflictDays: null,
  navWarnDays: null,
  imagery: 'off',
  imageryDate: '',
};

const KEY = 'wt.settings.v1';

interface SettingsState {
  settings: OperatorSettings;
  update: (patch: Partial<OperatorSettings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsState | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<OperatorSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...readStorage<Partial<OperatorSettings>>(KEY, {}),
  }));

  useEffect(() => {
    writeStorage(KEY, settings);
    const root = document.documentElement;
    root.classList.toggle('fx-scanlines', settings.scanlines);
    root.classList.toggle('fx-glow', settings.glow);
    root.classList.toggle('fx-flicker', settings.flicker);
  }, [settings]);

  const value = useMemo<SettingsState>(
    () => ({
      settings,
      update: (patch) => setSettings((s) => ({ ...s, ...patch })),
      reset: () => setSettings(DEFAULT_SETTINGS),
    }),
    [settings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}
