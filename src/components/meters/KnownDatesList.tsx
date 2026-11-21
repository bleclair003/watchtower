import { useMemo } from 'react';
import { knownDatesAhead } from '@shared/domain/knownDates';
import { getRegion } from '@shared/domain/regions';
import { safeExternalUrl } from '../../lib/sanitize';
import { Tag } from '../ui/Tag';

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' });
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Curated tension-prone dates ahead (shared/domain/knownDates.ts), optionally for one region. */
export function KnownDatesList({ now, days = 90, regionId, heading = true }: { now: number; days?: number; regionId?: string; heading?: boolean }) {
  const list = useMemo(() => knownDatesAhead(now, days).filter((d) => !regionId || d.regionIds.includes(regionId)), [now, days, regionId]);
  return (
    <div className={`px-2 py-1 text-2xs ${heading ? 'border-t border-wt-line' : ''}`}>
      {heading && <h3 className="text-wt-fg-dim">KNOWN DATES AHEAD — {days} DAYS</h3>}
      {list.length === 0 ? (
        <p className="text-wt-fg-dim">None in the curated list.</p>
      ) : (
        <ul className="divide-y divide-wt-line">
          {list.map((d) => {
            const url = d.url ? safeExternalUrl(d.url) : null;
            return (
              <li key={d.id} className="flex flex-wrap items-start gap-x-2 gap-y-0.5 py-1">
                <span className="w-20 shrink-0 tabular-nums text-wt-fg-muted">{d.approximate ? `~${MONTH.format(new Date(d.at))}` : DAY.format(new Date(d.at))}</span>
                <Tag tone={d.kind === 'election' ? 'warn' : d.kind === 'exercise' ? 'info' : 'muted'}>{d.kind}</Tag>
                <span className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                      {d.title}
                    </a>
                  ) : (
                    d.title
                  )}
                  {!regionId && <span className="text-wt-fg-dim"> · {d.regionIds.map((r) => getRegion(r)?.shortCode ?? r).join('/')}</span>}
                  <span className="block text-wt-fg-dim">{d.note}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="pt-1 text-wt-fg-dim">
        A curated list (shared/domain/knownDates.ts): fixed national days and anniversaries; regular exercises by the month they are usually held (~); elections only once their date is confirmed. Lunar-calendar dates are not listed.
      </p>
    </div>
  );
}
