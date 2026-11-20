import { forwardRef } from 'react';
import { ExternalLink } from 'lucide-react';
import type { IntelligenceEvent } from '@shared/domain/types';
import { getRegion } from '@shared/domain/regions';
import { CATEGORY_STYLES, CREDIBILITY_LABELS, SOURCE_CLASS_LABELS } from '../../config/categories';
import { formatAge, formatUtc } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { CategoryGlyph } from '../ui/CategoryGlyph';
import { Tag } from '../ui/Tag';

interface Props {
  event: IntelligenceEvent;
  selected: boolean;
  onSelect: () => void;
  now: number;
}

const PRECISION_LABEL: Record<IntelligenceEvent['locationPrecision'], string> = {
  exact: 'EXACT',
  city: 'CITY',
  country: 'COUNTRY-LEVEL',
  region: 'REGION-LEVEL',
  none: 'NO LOCATION',
};

/** One intelligence feed entry. Expanded view shows full provenance. */
export const FeedItem = forwardRef<HTMLLIElement, Props>(function FeedItem({ event: e, selected, onSelect, now }, ref) {
  const cred = CREDIBILITY_LABELS[e.credibility];
  const url = safeExternalUrl(e.sourceUrl);
  const isDemo = e.dataOrigin === 'demo';

  return (
    <li ref={ref} className={selected ? 'bg-wt-info/[0.07]' : ''}>
      <button
        onClick={onSelect}
        aria-expanded={selected}
        className={`block w-full border-l-2 px-2 py-1.5 text-left ${
          selected ? 'border-wt-info' : 'border-transparent hover:bg-wt-bg2'
        }`}
      >
        <div className="flex items-start gap-1.5">
          <span className="mt-0.5 text-wt-fg">
            <CategoryGlyph category={e.category} size={11} />
          </span>
          <span className={`text-xs leading-snug ${selected ? 'text-wt-info' : 'text-wt-fg'}`}>{e.title}</span>
          <span className="ml-auto pl-1 text-2xs whitespace-nowrap text-wt-fg-muted tabular-nums" title={formatUtc(e.publishedAt)}>
            {formatAge(e.publishedAt ?? e.collectedAt, now)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1 pl-[17px]">
          {isDemo && <Tag tone="warn">DEMO</Tag>}
          <Tag tone={cred.tone} title={cred.label}>{cred.code}</Tag>
          <Tag>{CATEGORY_STYLES[e.category].code}</Tag>
          {e.regionIds.map((r) => (
            <Tag key={r} tone="muted">{getRegion(r)?.shortCode ?? r}</Tag>
          ))}
          <span className="truncate text-2xs text-wt-fg-dim">{e.sourceName}</span>
        </div>
      </button>

      {selected && (
        <div className="space-y-1.5 border-l-2 border-wt-info px-2 pt-0.5 pb-2 pl-[25px] text-2xs">
          {e.summary && <p className="text-xs leading-snug text-wt-fg-muted">{e.summary}</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <dt className="text-wt-fg-dim">SOURCE</dt>
            <dd>
              {e.sourceName} <span className="text-wt-fg-dim">({SOURCE_CLASS_LABELS[e.sourceClass]})</span>
            </dd>
            <dt className="text-wt-fg-dim">PUBLISHED</dt>
            <dd className="tabular-nums">{formatUtc(e.publishedAt)}</dd>
            <dt className="text-wt-fg-dim">OCCURRED</dt>
            <dd className="tabular-nums">{e.occurredAt ? formatUtc(e.occurredAt) : 'NOT STATED'}</dd>
            <dt className="text-wt-fg-dim">COLLECTED</dt>
            <dd className="tabular-nums">{formatUtc(e.collectedAt)}</dd>
            <dt className="text-wt-fg-dim">CREDIBILITY</dt>
            <dd>{cred.label}</dd>
            <dt className="text-wt-fg-dim">VERIFICATION</dt>
            <dd className="uppercase">{e.verificationStatus}</dd>
            <dt className="text-wt-fg-dim">LOCATION</dt>
            <dd>
              {PRECISION_LABEL[e.locationPrecision]}
              {e.countryCodes.length > 0 && <span className="text-wt-fg-dim"> · {e.countryCodes.join(', ')}</span>}
            </dd>
            <dt className="text-wt-fg-dim">INDICATORS</dt>
            <dd className="text-wt-inactive">{e.indicatorIds?.length ? e.indicatorIds.join(', ') : 'NONE (ENGINE PHASE 3)'}</dd>
            <dt className="text-wt-fg-dim">RECORD</dt>
            <dd className="text-wt-fg-dim">{e.id}</dd>
          </dl>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1 text-wt-info hover:underline"
            >
              OPEN ORIGINAL SOURCE <ExternalLink size={10} aria-hidden />
            </a>
          ) : (
            <p className="text-wt-warn">{isDemo ? 'SIMULATED RECORD — NO ORIGINAL SOURCE EXISTS' : 'SOURCE LINK UNAVAILABLE'}</p>
          )}
        </div>
      )}
    </li>
  );
});
