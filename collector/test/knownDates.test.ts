// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { KNOWN_DATES, knownDatesAhead } from '../../shared/domain/knownDates.ts';
import { WATCH_REGIONS } from '../../shared/domain/regions.ts';
import { buildBrief } from '../../shared/domain/brief/brief.ts';

const at = (iso: string) => Date.parse(iso);

describe('known dates', () => {
  it('the list is well-formed: valid regions, months and days, exercises without a day, elections with a date', () => {
    const regions = new Set(WATCH_REGIONS.map((r) => r.id));
    for (const d of KNOWN_DATES) {
      expect(d.regionIds.every((r) => regions.has(r)), d.id).toBe(true);
      expect(d.month >= 1 && d.month <= 12, d.id).toBe(true);
      if (d.kind === 'exercise') expect(d.day, d.id).toBeUndefined();
      if (d.kind === 'election') expect(d.date, d.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (d.day) expect(new Date(Date.UTC(2027, d.month - 1, d.day)).getUTCMonth()).toBe(d.month - 1);
    }
    expect(new Set(KNOWN_DATES.map((d) => d.id)).size).toBe(KNOWN_DATES.length);
  });

  it('recurring dates roll into next year; the election appears once', () => {
    const ahead = knownDatesAhead(at('2026-11-21T15:00:00Z'), 120);
    expect(ahead.map((d) => d.id)).toEqual(expect.arrayContaining(['taiwan-local-2026', 'soleimani', 'iran-revolution', 'kim-jong-il-birthday', 'invasion-anniversary']));
    expect(ahead.find((d) => d.id === 'soleimani')!.at).toBe('2027-01-03T00:00:00.000Z');
    expect(knownDatesAhead(at('2027-11-21T00:00:00Z'), 30).some((d) => d.id === 'taiwan-local-2026')).toBe(false);
  });

  it('exercises are approximate and shown while their usual month is ahead', () => {
    const march = knownDatesAhead(at('2027-03-10T00:00:00Z'), 10).find((d) => d.id === 'freedom-shield')!;
    expect(march).toMatchObject({ approximate: true, at: '2027-03-10T00:00:00.000Z' });
    expect(knownDatesAhead(at('2027-02-20T00:00:00Z'), 15).find((d) => d.id === 'freedom-shield')!.at).toBe('2027-03-01T00:00:00.000Z');
    expect(knownDatesAhead(at('2027-04-02T00:00:00Z'), 10).some((d) => d.id === 'freedom-shield')).toBe(false);
  });

  it('the daily brief lists the next 7 days', () => {
    const now = at('2026-11-23T11:00:00Z');
    const brief = buildBrief({ generatedAt: new Date(now).toISOString(), events: [], sourceStatus: [], lastRun: null, totalEventsStored: 0, indicatorEvaluations: [], regionScores: [], scoreHistory: [] } as never, now);
    expect(brief.sections.find((s) => s.title === 'Known dates (next 7 days)')!.lines.map((l) => l.text)).toEqual(['2026-11-28: Taiwan local elections ("nine-in-one") and nuclear-energy referendum [TWSTRAIT]']);
  });
});
