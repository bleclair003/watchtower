import { describe, expect, it } from 'vitest';
import { can, effectiveRole } from './members.ts';

describe('roles', () => {
  it('owner claim wins; otherwise the stored role; missing or unknown = pending', () => {
    expect(effectiveRole(true, { role: 'blocked' })).toBe('owner');
    expect(effectiveRole(false, { role: 'editor' })).toBe('editor');
    expect(effectiveRole(false, null)).toBe('pending');
    expect(effectiveRole(false, { role: 'admin' as never })).toBe('pending');
  });

  it('grants each role exactly its permissions', () => {
    expect(can('viewer', 'view')).toBe(true);
    expect(can('viewer', 'editIncidents')).toBe(false);
    expect(can('viewer', 'watchlistAlerts')).toBe(false);
    expect(can('editor', 'editIncidents')).toBe(true);
    expect(can('editor', 'triageAlerts')).toBe(true);
    expect(can('editor', 'manageRules')).toBe(false);
    expect(can('editor', 'manageUsers')).toBe(false);
    expect(can('owner', 'manageUsers')).toBe(true);
    for (const r of ['pending', 'blocked'] as const) expect(can(r, 'view')).toBe(false);
    expect(can(null, 'view')).toBe(false);
  });
});
