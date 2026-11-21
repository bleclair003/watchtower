import { forwardRef } from 'react';
import { ExternalLink } from 'lucide-react';
import type { IntelligenceEvent } from '@shared/domain/types';
import { CORROBORATION_LABEL, type Story } from '@shared/domain/stories/stories';
import { offTopicReason } from '@shared/domain/relevance';
import { getRegion } from '@shared/domain/regions';
import { CATEGORY_STYLES, CREDIBILITY_LABELS, SOURCE_CLASS_LABELS } from '../../config/categories';
import { formatAge, formatUtc } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { CategoryGlyph } from '../ui/CategoryGlyph';
import { Tag } from '../ui/Tag';
import { AddToDossier } from './AddToDossier';

interface Props {
  event: IntelligenceEvent;
  /** Names of ELEVATED/TRIGGERED indicators that cite this event as evidence. */
  indicators?: string[];
  /** Show the + DOSSIER control (live backends only). */
  allowDossier?: boolean;
  selected: boolean;
  onSelect: () => void;
  now: number;
  /** Set when this item leads a story; `storyReports` are all its reports, newest first. */
  story?: Story | null;
  storyReports?: IntelligenceEvent[];
}

const PRECISION_LABEL: Record<IntelligenceEvent['locationPrecision'], string> = {
  exact: 'EXACT',
  city: 'CITY',
  country: 'COUNTRY-LEVEL',
  region: 'REGION-LEVEL',
  none: 'NO LOCATION',
};

/** One intelligence feed entry. Expanded view shows full provenance. */
export const FeedItem = forwardRef<HTMLLIElement, Props>(function FeedItem(
  { event: e, selected, onSelect, now, indicators = [], allowDossier = false, story = null, storyReports = [] },
  ref,
) {
  const cred = CREDIBILITY_LABELS[e.credibility];
  const m = e.metadata ?? {};
  const terms = Array.isArray(m.geoTerms) ? (m.geoTerms as unknown[]).filter((t): t is string => typeof t === 'string') : [];
  const geoBasis =
    m.geoBasis === 'text-mention'
      ? `From place names in the headline: ${terms.join(', ')}. A mention is not a location.`
      : m.geoBasis === 'source-coordinates'
        ? 'Coordinates supplied by the source.'
        : m.geoBasis === 'source-country'
          ? 'Country supplied by the source.'
          : null;
  const topicBasis =
    m.topicBasis === 'keyword'
      ? `Classified from the headline keyword "${String(m.topicTerm)}".`
      : m.topicBasis === 'none'
        ? 'No topic keyword in the headline: filed as general news.'
        : null;
  const offTopic = offTopicReason(e);
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
          {offTopic && <Tag tone="inactive" title={offTopic}>OFF-TOPIC</Tag>}
          {indicators.length > 0 && (
            <Tag tone="warn" title={`Evidence for: ${indicators.join('; ')}`}>
              IND ×{indicators.length}
            </Tag>
          )}
          {e.metadata?.change === 'raised' && <Tag tone="warn" title="Advisory level raised">LEVEL ▲</Tag>}
          {e.metadata?.change === 'lowered' && <Tag tone="info" title="Advisory level lowered">LEVEL ▼</Tag>}
          {e.metadata?.change === 'new' && <Tag tone="warn" title="New advisory">NEW</Tag>}
          {e.metadata?.routine === true && <Tag tone="inactive" title="Routine product advisory">ROUTINE</Tag>}
          {e.metadata?.knownRansomwareUse === true && <Tag tone="warn" title="Known ransomware campaign use">RANSOMWARE</Tag>}
          {typeof e.metadata?.alertLevel === 'string' && (
            <Tag tone={e.metadata.alertLevel === 'Red' ? 'crit' : e.metadata.alertLevel === 'Orange' ? 'warn' : 'muted'} title="GDACS alert level">
              {e.metadata.alertLevel.toUpperCase()}
            </Tag>
          )}
          {e.metadata?.geoBasis === 'text-mention' && <Tag tone="inactive" title="Location from place names mentioned in the headline, not geolocation">TXT-GEO</Tag>}
          {story && (
            <Tag tone={story.corroboration === 'single-source' ? 'muted' : 'info'} title={CORROBORATION_LABEL[story.corroboration]}>
              STORY ×{story.memberIds.length} · {story.corroboration === 'official' ? 'OFFICIAL+' : story.corroboration === 'multi-source' ? `${story.publishers.length} PUBLISHERS` : '1 PUBLISHER'}
            </Tag>
          )}
          {!(story && story.corroboration !== 'single-source' && e.credibility === 'single-source') && (
            <Tag tone={cred.tone} title={cred.label}>{cred.code}</Tag>
          )}
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
          {story && (
            <section aria-label="Reports in this story" className="border border-wt-line p-1.5">
              <p className="mb-1 text-wt-fg-dim">
                STORY · {story.memberIds.length} REPORTS · {story.publishers.map((p) => p.publisher).join(' · ')}
              </p>
              <p className="mb-1 text-wt-fg-muted">
                {CORROBORATION_LABEL[story.corroboration]}. Grouped because the headlines share: {story.sharedTerms.join(', ')}.
              </p>
              <ul className="space-y-0.5">
                {storyReports.map((r) => {
                  const rurl = safeExternalUrl(r.sourceUrl);
                  return (
                    <li key={r.id} className="flex items-start gap-1.5">
                      <span className="whitespace-nowrap text-wt-fg-dim tabular-nums">{formatAge(r.publishedAt ?? r.collectedAt, now)}</span>
                      <span className="whitespace-nowrap text-wt-fg-muted">{r.sourceName.split(' — ')[0]}</span>
                      {rurl ? (
                        <a href={rurl} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 text-wt-info hover:underline">
                          {r.title}
                        </a>
                      ) : (
                        <span className="min-w-0">{r.title}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
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
            <dd>
              {cred.label}
              {story && <span className="text-wt-fg-dim"> (this report) · story: {story.publishers.length} publisher{story.publishers.length === 1 ? '' : 's'}</span>}
            </dd>
            <dt className="text-wt-fg-dim">VERIFICATION</dt>
            <dd className="uppercase">{e.verificationStatus}</dd>
            <dt className="text-wt-fg-dim">LOCATION</dt>
            <dd>
              {PRECISION_LABEL[e.locationPrecision]}
              {e.countryCodes.length > 0 && <span className="text-wt-fg-dim"> · {e.countryCodes.join(', ')}</span>}
              {geoBasis && <span className="block text-wt-fg-dim">{geoBasis}</span>}
            </dd>
            {topicBasis && (
              <>
                <dt className="text-wt-fg-dim">TOPIC</dt>
                <dd className="text-wt-fg-dim">{topicBasis}</dd>
              </>
            )}
            {offTopic && (
              <>
                <dt className="text-wt-fg-dim">RELEVANCE</dt>
                <dd className="text-wt-fg-dim">Off-topic: {offTopic}. Hidden unless OFF-TOPIC is shown.</dd>
              </>
            )}
            <dt className="text-wt-fg-dim">INDICATORS</dt>
            <dd className={indicators.length ? 'text-wt-warn' : 'text-wt-fg-dim'}>
              {indicators.length ? indicators.join(' · ') : 'Not cited by any active indicator'}
            </dd>
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
          {allowDossier && <AddToDossier event={e} />}
        </div>
      )}
    </li>
  );
});
