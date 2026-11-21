import { getRegion } from '../regions.ts';
import { ACTIVE_MIN, coverageGaps, sideLabel } from '../coverage.ts';
import type { MeterInput } from './input.ts';
import type { Meter, MeterComponent } from './types.ts';
import { meter, plural } from './util.ts';

/** Coverage gaps (per region): possible one-sided stories over 72 hours, and which sides reported at all. */
export function coverageMeter(input: MeterInput, regionId: string): Meter {
  const c = coverageGaps(input.events, regionId, input.now);
  const total = c.sides.reduce((s, x) => s + x.reports, 0);
  const assessed = c.sides.some((s) => s.active);
  const components: MeterComponent[] = c.sides.map((s) => ({ label: s.label, value: `${s.reports} report${s.reports === 1 ? '' : 's'}`, active: s.active, note: s.active ? 'reporting on the region' : s.reports ? `under ${ACTIVE_MIN}: not counted as covering` : undefined }));
  const short = getRegion(regionId)?.shortCode ?? regionId;
  return meter({
    id: `coverage.${regionId}`,
    kind: 'coverage',
    family: 'quality',
    name: `${short} coverage gaps`,
    regionId,
    level: null,
    label: !total ? 'NO REPORTS' : c.onlySide ? `ONLY ${sideLabel(c.onlySide).toUpperCase()}` : !assessed ? 'TOO FEW REPORTS' : c.gaps.length ? `${c.gaps.length} POSSIBLE GAP${c.gaps.length > 1 ? 'S' : ''}` : 'NO GAPS',
    value: total && assessed ? c.gaps.length : null,
    reading: !total
      ? 'No reports about the region from the compared outlets in 72 hours.'
      : c.onlySide
        ? `Only ${sideLabel(c.onlySide)} reported on the region in 72 hours.`
        : !assessed
          ? `${plural(total, 'report')} in 72 hours, but no side had ${ACTIVE_MIN} or more: gaps are not assessed.`
          : c.gaps.length
          ? `${plural(c.gaps.length, 'story', 'stories')} reported by one side only while others covered the region: ${c.gaps
              .slice(0, 2)
              .map((g) => `${sideLabel(g.side)} only`)
              .join(', ')}${c.gaps.length > 2 ? '…' : ''}.`
          : 'Every multi-report or strike story was also reported by another side covering the region.',
    components,
    evidence: c.gaps.slice(0, 6).map((g) => ({ title: g.title, url: g.url, at: g.at, why: `${sideLabel(g.side)} only (${plural(g.reports, 'report')}); not ${g.missingFrom.map(sideLabel).join(' or ')}` })),
    asOf: c.gaps[0]?.at ?? null,
    baseline: 'none',
    notes: [
      'Sides: Al Jazeera; BBC; US media (NPR, Defense News, Military Times); official (UN News, war.gov, UK MOD, IAEA, Air Force, Marines). A gap is a story from one side only — 2+ reports, or a strike report — while another side had 3+ reports about the region.',
      'Possible gaps, not proof of silence: reports are matched by shared words, so the same event told very differently can look one-sided. Only the outlets WATCHTOWER collects are compared.',
    ],
  });
}
