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
}

export const DEFAULT_SETTINGS: OperatorSettings = {
  scanlines: true,
  glow: true,
  flicker: false,
  graticule: true,
  regionOutlines: true,
  installations: true,
  installationsOperator: 'ALL',
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
