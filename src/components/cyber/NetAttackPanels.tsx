import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { asnLabel, ddosSurge, DDOS_PEAK_SHARE, hijackNotable, HIJACK_MIN_CONFIDENCE, LEAK_NOTABLE_PREFIXES, type DdosCountry, type NetAttackSnapshot } from '@shared/domain/netAttacks';
import { countryName } from '../../lib/regionSummary';
import { formatAge, formatUtc } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { Panel } from '../ui/Panel';
import { Tag } from '../ui/Tag';

const radar = (path: string) => safeExternalUrl(`https://radar.cloudflare.com/${path}`);

function RadarLink({ path, label }: { path: string; label: string }) {
  const url = radar(path);
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-wt-info underline">
      {label} <ExternalLink size={9} aria-hidden />
    </a>
  ) : null;
}

/** Route hijacks (high confidence) and leaks involving watch-region countries, last 7 days. */
export function RoutingPanel({ data, now }: { data: NetAttackSnapshot; now: number }) {
  const [all, setAll] = useState(false);
  const notableHijacks = data.hijacks.filter(hijackNotable);
  const hijacks = all ? data.hijacks : notableHijacks;
  const notableLeaks = data.leaks.filter((l) => l.prefixCount >= LEAK_NOTABLE_PREFIXES);
  const leaks = all ? data.leaks : notableLeaks;
  const hidden = data.hijacks.length - notableHijacks.length + data.leaks.length - notableLeaks.length;
  return (
    <Panel
      title={`Internet routing (${notableHijacks.length} cross-border hijack${notableHijacks.length === 1 ? '' : 's'}, ${notableLeaks.length} large leak${notableLeaks.length === 1 ? '' : 's'})`}
      designator="C6"
      actions={
        <span className="flex items-center gap-2">
          {data.simulated && <Tag tone="warn">SIMULATED</Tag>}
          {hidden > 0 && (
            <button className="text-2xs text-wt-info underline" onClick={() => setAll((v) => !v)} aria-pressed={all}>
              {all ? 'hide' : 'show'} {hidden} routine
            </button>
          )}
        </span>
      }
    >
      <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
        Last 7 days, networks registered in watch-region countries (not the US). A <b>hijack</b> is a network announcing address blocks that belong to another, so their traffic can be diverted or dropped; only detections Cloudflare scores {HIJACK_MIN_CONFIDENCE}+ of 10 are kept, and only those between two different watch-region countries are shown by default (most others are mistakes between neighbouring networks). A <b>leak</b> passes on routes it should not; usually a mistake, shown from {LEAK_NOTABLE_PREFIXES} blocks. Neither says who meant what.
        {data.fetchedAt && ` Read ${formatAge(data.fetchedAt, now)} ago.`} Data: Cloudflare Radar, CC BY-NC 4.0.
      </p>
      <ul className="divide-y divide-wt-line text-2xs">
        {hijacks.map((h) => (
          <li key={`h${h.id}`} className="px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag tone={hijackNotable(h) ? 'crit' : 'muted'}>HIJACK {h.confidence}/10</Tag>
              {!hijackNotable(h) && <Tag tone="inactive">ROUTINE</Tag>}
              {h.stale ? <Tag tone="inactive">ENDED</Tag> : <Tag tone="warn">SEEN</Tag>}
              <span className="text-wt-fg-muted tabular-nums">{formatUtc(h.from)}</span>
            </div>
            <p className="mt-0.5 text-xs text-wt-fg">
              {asnLabel(h.hijacker)} announced {h.prefixCount} block{h.prefixCount === 1 ? '' : 's'} of {h.victims.slice(0, 3).map(asnLabel).join(', ') || 'networks not named'}
            </p>
            <p className="text-wt-fg-muted">
              {h.prefixes.slice(0, 4).join(', ')}
              {h.prefixCount > 4 && ` +${h.prefixCount - 4}`}
              {h.to && ` · last seen ${formatUtc(h.to)}`} · <RadarLink path={`as${h.hijacker.asn}`} label={`AS${h.hijacker.asn} on Radar`} />
            </p>
          </li>
        ))}
        {leaks.map((l) => (
          <li key={`l${l.id}`} className="px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag tone="warn">LEAK</Tag>
              {l.finished && <Tag tone="inactive">ENDED</Tag>}
              <span className="text-wt-fg-muted tabular-nums">{formatUtc(l.at)}</span>
            </div>
            <p className="mt-0.5 text-xs text-wt-fg">
              {asnLabel(l.leaker)} leaked {l.prefixCount.toLocaleString('en-US')} blocks from {l.originCount} networks to {l.peerCount} peers
            </p>
            <p className="text-wt-fg-muted">
              Countries: {l.countries.map(countryName).join(', ') || 'not stated'} · <RadarLink path={`as${l.leaker.asn}`} label={`AS${l.leaker.asn} on Radar`} />
            </p>
          </li>
        ))}
        {hijacks.length === 0 && leaks.length === 0 && (
          <li className="px-2 py-1.5 text-wt-fg-muted">
            No cross-border hijacks between watch-region networks or large leaks in 7 days{hidden ? ` (${hidden} routine, shown with the button above and in the feed with routine records on)` : ''}.
          </li>
        )}
      </ul>
    </Panel>
  );
}

/** A 28-day line, scaled to its own maximum, with the last day marked. */
function Spark({ c }: { c: DdosCountry }) {
  const w = 112;
  const h = 22;
  const max = Math.max(...c.values, 1e-9);
  const x = (i: number) => (i / Math.max(c.values.length - 1, 1)) * (w - 4) + 2;
  const y = (v: number) => h - 2 - (v / max) * (h - 4);
  const pts = c.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = c.values.length - 1;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="block">
      <polygon points={`${x(0)},${h - 2} ${pts} ${x(last)},${h - 2}`} fill="currentColor" className="text-wt-fg" opacity={0.12} />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.2} className="text-wt-fg-muted" />
      <circle cx={x(last)} cy={y(c.values[last])} r={2.4} fill="currentColor" className={ddosSurge(c) ? 'text-wt-crit' : 'text-wt-fg'} />
    </svg>
  );
}

/** DDoS attack traffic aimed at each watch-region country: the last day against the biggest of four weeks. */
export function DdosPanel({ data, now }: { data: NetAttackSnapshot; now: number }) {
  const d = data.ddos;
  if (!d) return null;
  // Older snapshots (before the peak rule) lack peakShare; they are skipped until the next daily read.
  const rows = d.countries.filter((c) => typeof c.peakShare === 'number').sort((a, b) => b.peakShare - a.peakShare || a.country.localeCompare(b.country));
  const surges = rows.filter(ddosSurge).length;
  return (
    <Panel
      title={`DDoS against watch-region countries (${rows.length})`}
      designator="C7"
      actions={data.simulated ? <Tag tone="warn">SIMULATED</Tag> : surges ? <Tag tone="crit">{surges} SURGE{surges === 1 ? '' : 'S'}</Tag> : undefined}
    >
      <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
        Network-layer attack traffic Cloudflare saw aimed at targets in each country, per day for 28 days. Cloudflare gives relative values, so each line is on its own scale and countries are not compared with each other. Attacks come in bursts, so the last day is measured against the biggest day of the four weeks: a SURGE is {Math.round(DDOS_PEAK_SHARE * 100)}% of that peak or more. Cloudflare only sees attacks on networks it protects. Read {formatAge(d.fetchedAt, now)} ago.
        {d.noData.length > 0 && ` No data: ${d.noData.join(', ')}.`} Data: Cloudflare Radar, CC BY-NC 4.0.
      </p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="DDoS levels by country">
        <table className="w-full text-2xs">
          <thead className="text-wt-fg-dim">
            <tr className="border-b border-wt-line">
              <th className="px-2 py-1 text-left font-normal">Country</th>
              <th className="px-2 py-1 text-left font-normal">28 days</th>
              <th className="px-2 py-1 text-right font-normal">Last day, share of peak</th>
              <th className="px-2 py-1 text-right font-normal" title="Days with attack traffic of 5% of the peak or more">Attack days</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.country} className="border-b border-wt-line last:border-0">
                <td className="px-2 py-1">
                  {countryName(c.country)} <span className="text-wt-fg-dim">{c.day}</span>
                </td>
                <td className="px-2 py-1">
                  <Spark c={c} />
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {ddosSurge(c) ? <Tag tone="crit">SURGE {Math.round(c.peakShare * 100)}%</Tag> : `${Math.round(c.peakShare * 100)}%`}
                  {c.peakDay !== c.day && <span className="block text-wt-fg-dim">peak {c.peakDay}</span>}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{c.activeDays} / {c.values.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
