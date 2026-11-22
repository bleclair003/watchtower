import { ExternalLink, Radio } from 'lucide-react';
import {
  RADIO_LEGAL_NOTE,
  TWENTE_WEBSDR,
  frequenciesFor,
  kiwiTuneUrl,
  listenPoint,
  nearestReceivers,
  suggestedNow,
  twenteTuneUrl,
  type RadioFrequency,
  type RadioReceiversSnapshot,
} from '@shared/domain/radio';
import { safeExternalUrl } from '../../lib/sanitize';
import { formatUtc } from '../../lib/time';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';

interface Props {
  /** A watch region, or null for the global list. */
  regionId: string | null;
  receivers: RadioReceiversSnapshot | null;
  now: number;
  designator?: string;
}

const ext = { target: '_blank', rel: 'noopener noreferrer nofollow' } as const;

/** Phase 28: frequencies worth listening to for a region, each with "tune nearby" links to public receivers. */
export function RadioPanel({ regionId, receivers, now, designator = 'RF' }: Props) {
  const list = frequenciesFor(regionId);
  const own = regionId ? list.filter((f) => f.regions !== 'global').length : 0;
  return (
    <Panel title={regionId ? 'Radio — listen nearby' : 'Radio — global frequencies'} designator={designator}>
      <div className="space-y-2 px-2 py-1.5 text-2xs">
        {regionId && own === 0 && (
          <p className="text-wt-fg-dim">No frequency specific to this region is confirmed by a public source yet; the global ones are below.</p>
        )}
        <ul className="space-y-2">
          {list.map((f) => (
            <FrequencyRow key={f.id} f={f} regionId={regionId} receivers={receivers} now={now} />
          ))}
        </ul>
        <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-dim">
          <p>
            {receivers
              ? `Receivers: KiwiSDR public list${receivers.simulated ? ' (SIMULATED)' : ''}, ${receivers.receivers.length} online as of ${formatUtc(receivers.listTime ?? receivers.fetchedAt)}. Each takes 4–8 listeners, so one may be busy: try the next.`
              : `The receiver list has not been collected yet; links use the ${TWENTE_WEBSDR.name}.`}
          </p>
          <p>{RADIO_LEGAL_NOTE}</p>
        </div>
      </div>
    </Panel>
  );
}

function FrequencyRow({ f, regionId, receivers, now }: { f: RadioFrequency; regionId: string | null; receivers: RadioReceiversSnapshot | null; now: number }) {
  const [lat, lon] = listenPoint(f, regionId);
  const near = receivers ? nearestReceivers(receivers.receivers, lat, lon, f.kHz, 3) : [];
  const best = near[0];
  const tune = (kHz: number) => (best ? kiwiTuneUrl(best, kHz, f.mode) : kHz <= TWENTE_WEBSDR.maxKhz ? twenteTuneUrl(kHz, f.mode) : null);
  const suggested = suggestedNow(f, now);
  return (
    <li className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Radio size={11} className="text-wt-fg-dim" aria-hidden />
        <span className="text-xs text-wt-fg">{f.name}</span>
        <Tag tone={f.kind === 'broadcast' ? 'info' : 'muted'} title={f.kind === 'broadcast' ? 'A broadcast meant for anyone' : 'Traffic between stations: some countries, the UK among them, forbid listening'}>
          {f.kind === 'broadcast' ? 'BROADCAST' : 'COMMS'}
        </Tag>
        <span className="text-wt-fg-dim uppercase">{f.mode}</span>
      </div>
      <p className="text-wt-fg-muted">{f.hear}</p>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-wt-fg-dim">kHz</span>
        {f.kHz.map((k) => {
          const href = safeExternalUrl(tune(k));
          const label = `${k}${suggested === k ? ' ◂ now' : ''}`;
          return href ? (
            <a key={k} href={href} {...ext} title={`Open ${best ? best.name : TWENTE_WEBSDR.name} tuned to ${k} kHz ${f.mode.toUpperCase()}`} className={`border px-1 tabular-nums hover:bg-wt-bg2 ${suggested === k ? 'border-wt-info text-wt-info' : 'border-wt-line text-wt-fg'}`}>
              {label}
            </a>
          ) : (
            <span key={k} className="border border-wt-line px-1 text-wt-fg-dim tabular-nums">{label}</span>
          );
        })}
      </div>
      {f.when && <p className="text-wt-fg-dim">{f.when}</p>}
      <p className="text-wt-fg-dim">
        {near.length > 0 ? (
          <>
            Nearest receivers:{' '}
            {near.map((r, i) => {
              const href = safeExternalUrl(kiwiTuneUrl(r, suggested ?? f.kHz[0], f.mode));
              return (
                <span key={r.url}>
                  {i > 0 && ' · '}
                  {href ? <a href={href} {...ext} className="text-wt-info hover:underline">{r.name}</a> : r.name}
                  <span className="tabular-nums"> ({Math.round(r.km).toLocaleString('en-US')} km)</span>
                </span>
              );
            })}
          </>
        ) : (
          <>Receiver: {TWENTE_WEBSDR.name}</>
        )}
      </p>
      <p className="text-wt-fg-dim">
        Source:{' '}
        {f.sources.map((s, i) => (
          <span key={s.url}>
            {i > 0 && ' · '}
            <a href={s.url} {...ext} className="inline-flex items-center gap-0.5 hover:text-wt-fg hover:underline">
              {s.label} <ExternalLink size={9} aria-hidden />
            </a>
          </span>
        ))}
      </p>
    </li>
  );
}
