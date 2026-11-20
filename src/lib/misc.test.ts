import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { MAP_COLORS, findTextFont, militarizeStyle } from './mapStyle';
import { parseCommand, suggestCommands } from './commands';
import { safeExternalUrl } from './sanitize';
import { formatAge, formatUtc } from './time';

describe('militarizeStyle', () => {
  const style = {
    version: 8,
    sources: {
      relief: { type: 'raster', tiles: ['x'] },
      omt: { type: 'vector', url: 'y' },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#000' } },
      { id: 'relief', type: 'raster', source: 'relief' },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#111' } },
      { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building' },
      { id: 'boundary_country_z0-4', type: 'line', source: 'omt', 'source-layer': 'boundary' },
      { id: 'place_city', type: 'symbol', source: 'omt', 'source-layer': 'place', layout: { 'text-font': ['Noto Sans Regular'] } },
    ],
  } as unknown as StyleSpecification;

  it('drops raster relief and buildings, recolours the rest', () => {
    const out = militarizeStyle(style);
    expect(out.layers.map((l) => l.id)).toEqual(['background', 'water', 'boundary_country_z0-4', 'place_city']);
    expect(Object.keys(out.sources)).toEqual(['omt']);
    expect((out.layers[0] as unknown as { paint: Record<string, string> }).paint['background-color']).toBe(MAP_COLORS.land);
    expect((out.layers[1] as unknown as { paint: Record<string, string> }).paint['fill-color']).toBe(MAP_COLORS.water);
    expect((out.layers[2] as unknown as { paint: Record<string, string> }).paint['line-color']).toBe(MAP_COLORS.boundaryCountry);
  });

  it('does not mutate the input style', () => {
    militarizeStyle(style);
    expect(style.layers).toHaveLength(6);
  });

  it('finds the style font stack for overlay labels', () => {
    expect(findTextFont(style)).toEqual(['Noto Sans Regular']);
  });
});

describe('parseCommand', () => {
  it('maps WATCH to region ids by short code, id, or name', () => {
    expect(parseCommand('WATCH REDSEA')).toEqual({ kind: 'watch', regionId: 'red-sea' });
    expect(parseCommand('watch taiwan')).toEqual({ kind: 'watch', regionId: 'taiwan-strait' });
    expect(parseCommand('WATCH MIDDLE-EAST')).toEqual({ kind: 'watch', regionId: 'middle-east' });
    expect(parseCommand('WATCH ATLANTIS').kind).toBe('error');
  });

  it('maps navigation and map commands', () => {
    expect(parseCommand('STATUS')).toEqual({ kind: 'navigate', to: '/diagnostics' });
    expect(parseCommand('SOURCES')).toEqual({ kind: 'navigate', to: '/sources' });
    expect(parseCommand('MAP GLOBAL')).toEqual({ kind: 'map-global' });
    expect(parseCommand('help')).toEqual({ kind: 'help' });
  });

  it('reports unbuilt modules as errors rather than faking output', () => {
    expect(parseCommand('ALERTS')).toMatchObject({ kind: 'error' });
    expect(parseCommand('SITREP 24H')).toMatchObject({ kind: 'error' });
  });

  it('resolves FEED sources and treats free text as search', () => {
    expect(parseCommand('FEED cisa-kev')).toEqual({ kind: 'feed-source', sourceId: 'cisa-kev' });
    expect(parseCommand('houthi shipping')).toEqual({ kind: 'search', keyword: 'houthi shipping' });
  });

  it('suggests completions by prefix', () => {
    expect(suggestCommands('WATCH K')).toEqual(['WATCH KOREA']);
  });
});

describe('safeExternalUrl', () => {
  it('allows only http(s)', () => {
    expect(safeExternalUrl('https://www.cisa.gov/x')).toBe('https://www.cisa.gov/x');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html,hi')).toBeNull();
    expect(safeExternalUrl('')).toBeNull();
    expect(safeExternalUrl('not a url')).toBeNull();
  });
});

describe('time formatting', () => {
  it('formats UTC and relative ages', () => {
    expect(formatUtc('2026-11-20T07:05:09Z')).toBe('2026-11-20 07:05Z');
    expect(formatUtc(null)).toBe('—');
    const now = Date.parse('2026-11-20T12:00:00Z');
    expect(formatAge('2026-11-20T11:15:00Z', now)).toBe('45m');
    expect(formatAge('2026-11-19T12:00:00Z', now)).toBe('24h');
    expect(formatAge('2026-11-15T12:00:00Z', now)).toBe('5d');
  });
});
