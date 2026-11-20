import { WATCH_REGIONS } from '@shared/domain/regions';
import { SOURCE_REGISTRY } from '@shared/domain/sources';

/**
 * Command console grammar. Every command maps to a real application
 * operation; there are no canned "terminal" responses.
 *
 * Unknown input is treated as a keyword search of the intelligence feed.
 */
export type Command =
  | { kind: 'help' }
  | { kind: 'navigate'; to: string }
  | { kind: 'watch'; regionId: string }
  | { kind: 'map-global' }
  | { kind: 'feed-source'; sourceId: string }
  | { kind: 'search'; keyword: string }
  | { kind: 'clear' }
  | { kind: 'error'; message: string };

export interface CommandSpec {
  syntax: string;
  description: string;
}

export const COMMAND_HELP: CommandSpec[] = [
  { syntax: 'HELP', description: 'List available commands' },
  { syntax: 'MAP GLOBAL', description: 'Reset map and clear region focus' },
  { syntax: 'WATCH <REGION>', description: `Focus a watch region (${WATCH_REGIONS.map((r) => r.shortCode).join(', ')})` },
  { syntax: 'FEED <SOURCE>', description: 'Filter feed to one source id' },
  { syntax: 'SEARCH <TEXT>', description: 'Keyword-filter the intelligence feed' },
  { syntax: 'CLEAR', description: 'Reset all dashboard filters' },
  { syntax: 'STATUS', description: 'Open system diagnostics' },
  { syntax: 'INDICATORS', description: 'Open the Indicator & Warning Engine' },
  { syntax: 'ALERTS', description: 'Open the Alert Center' },
  { syntax: 'DOSSIERS', description: 'Open incident dossiers' },
  { syntax: 'SITREP', description: 'Open the situation report generator' },
  { syntax: 'REPLAY', description: 'Open historical replay' },
  { syntax: 'LAB', description: 'Open Signal Lab (trends, backtests)' },
  { syntax: 'SOURCES', description: 'Open the source directory' },
  { syntax: 'SETTINGS', description: 'Open operator settings' },
  { syntax: 'GOC', description: 'Return to Global Operations Center' },
];

const NAV: Record<string, string> = {
  STATUS: '/diagnostics',
  INDICATORS: '/indicators',
  ALERTS: '/alerts',
  DOSSIERS: '/dossiers',
  REPLAY: '/replay',
  LAB: '/signal-lab',
  IWE: '/indicators',
  DIAGNOSTICS: '/diagnostics',
  SOURCES: '/sources',
  SETTINGS: '/settings',
  GOC: '/',
  HOME: '/',
};

function matchRegion(token: string): string | undefined {
  const t = token.toUpperCase().replace(/[\s_]+/g, '-');
  return WATCH_REGIONS.find(
    (r) =>
      r.shortCode === t.replace(/-/g, '') ||
      r.id.toUpperCase() === t ||
      r.id.toUpperCase().startsWith(t) ||
      r.name.toUpperCase().replace(/[^A-Z]+/g, '-').startsWith(t),
  )?.id;
}

function matchSource(token: string): string | undefined {
  const t = token.toLowerCase();
  return (
    SOURCE_REGISTRY.find((s) => s.id === t)?.id ??
    SOURCE_REGISTRY.find((s) => s.id.startsWith(t) || s.organization.toLowerCase().includes(t))?.id
  );
}

export function parseCommand(input: string): Command {
  const raw = input.trim();
  if (!raw) return { kind: 'error', message: 'EMPTY COMMAND' };
  const [head, ...rest] = raw.split(/\s+/);
  const verb = head.toUpperCase();
  const arg = rest.join(' ');

  if (verb === 'HELP' || verb === '?') return { kind: 'help' };
  if (verb === 'CLEAR' || verb === 'RESET') return { kind: 'clear' };
  if (NAV[verb] && !arg) return { kind: 'navigate', to: NAV[verb] };
  if (verb === 'SITREP') return { kind: 'navigate', to: '/sitrep' };

  if (verb === 'MAP') {
    if (arg.toUpperCase() === 'GLOBAL' || !arg) return { kind: 'map-global' };
    const region = matchRegion(arg);
    return region ? { kind: 'watch', regionId: region } : { kind: 'error', message: `UNKNOWN REGION: ${arg.toUpperCase()}` };
  }
  if (verb === 'WATCH') {
    if (!arg) return { kind: 'error', message: 'WATCH REQUIRES A REGION' };
    const region = matchRegion(arg);
    return region ? { kind: 'watch', regionId: region } : { kind: 'error', message: `UNKNOWN REGION: ${arg.toUpperCase()}` };
  }
  if (verb === 'FEED') {
    if (!arg) return { kind: 'error', message: 'FEED REQUIRES A SOURCE' };
    const src = matchSource(arg);
    return src ? { kind: 'feed-source', sourceId: src } : { kind: 'error', message: `UNKNOWN SOURCE: ${arg.toUpperCase()}` };
  }
  if (verb === 'SEARCH' || verb === 'FIND') return { kind: 'search', keyword: arg };

  return { kind: 'search', keyword: raw };
}

/** Autocomplete suggestions for the current partial input. */
export function suggestCommands(input: string): string[] {
  const t = input.trim().toUpperCase();
  const all = [
    'HELP',
    'MAP GLOBAL',
    ...WATCH_REGIONS.map((r) => `WATCH ${r.shortCode}`),
    ...SOURCE_REGISTRY.filter((s) => s.priority === 'P1' || s.priority === 'P2').map((s) => `FEED ${s.id.toUpperCase()}`),
    'SEARCH ',
    'CLEAR',
    'STATUS',
    'INDICATORS',
    'ALERTS',
    'DOSSIERS',
    'SITREP',
    'REPLAY',
    'LAB',
    'SOURCES',
    'SETTINGS',
    'GOC',
  ];
  if (!t) return all.slice(0, 8);
  return all.filter((c) => c.startsWith(t)).slice(0, 8);
}
