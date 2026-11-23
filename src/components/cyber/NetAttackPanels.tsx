import { ExternalLink } from 'lucide-react';
import { asnLabel, HIJACK_MIN_CONFIDENCE, LEAK_NOTABLE_PREFIXES, type DdosCountry, type NetAttackSnapshot } from '@shared/domain/netAttacks';
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
  const notableLeaks = data.leaks.filter((l) => l.prefixCount >= LEAK_NOTABLE_PREFIXES);
  return (
    <Panel
      title={`Internet routing (${data.hijacks.length} hijack${data.hijacks.length === 1 ? '' : 's'}, ${data.leaks.length} leak${data.leaks.length === 1 ? '' : 's'})`}
      designator="C6"
      actions={data.simulated ? <Tag tone="warn">SIMULATED</Tag> : undefined}
    >
      <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
        Last 7 days, networks registered in watch-region countries (not the US). A <b>hijack</b> is a network announcing address blocks that belong to another, so their traffic can be diverted or dropped; only detections Cloudflare scores {HIJACK_MIN_CONFIDENCE}+ of 10 are kept. A <b>leak</b> passes on routes it should not; usually a mistake, and under {LEAK_NOTABLE_PREFIXES} blocks marked routine. Neither says who meant what.
        {data.fetchedAt && ` Read ${formatAge(data.fetchedAt, now)} ago.`} Data: Cloudflare Radar, CC BY-NC 4.0.
      </p>
      <ul className="divide-y divide-wt-line text-2xs">
        {data.hijacks.map((h) => (
          <li key={`h${h.id}`} className="px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag tone="crit">HIJACK {h.confidence}/10</Tag>
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
        {notableLeaks.map((l) => (
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
        {data.hijacks.length === 0 && notableLeaks.length === 0 && (
          <li className="px-2 py-1.5 text-wt-fg-muted">
            No high-confidence hijacks or large leaks involving watch-region networks in 7 days{data.leaks.length ? ` (${data.leaks.length} small leak${data.leaks.length === 1 ? '' : 's'}, listed in the feed as routine)` : ''}.
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
  const hot = (c.score ?? 0) >= 3 && (c.ratio ?? 0) >= 3;
  const last = c.values.length - 1;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="block">
      <polygon points={`${x(0)},${h - 2} ${pts} ${x(last)},${h - 2}`} fill="currentColor" className="text-wt-fg" opacity={0.12} />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.2} className="text-wt-fg-muted" />
      <circle cx={x(last)} cy={y(c.values[last])} r={2.4} fill="currentColor" className={hot ? 'text-wt-crit' : 'text-wt-fg'} />
    </svg>
  );
}

/** DDoS attack traffic aimed at each watch-region country: yesterday against its own last four weeks. */
export function DdosPanel({ data, now }: { data: NetAttackSnapshot; now: number }) {
  const d = data.ddos;
  if (!d) return null;
  const rows = [...d.countries].sort((a, b) => (b.score ?? -99) - (a.score ?? -99));
  const surges = rows.filter((c) => (c.score ?? 0) >= 3 && (c.ratio ?? 0) >= 3).length;
  return (
    <Panel
      title={`DDoS against watch-region countries (${rows.length})`}
      designator="C7"
      actions={data.simulated ? <Tag tone="warn">SIMULATED</Tag> : surges ? <Tag tone="crit">{surges} SURGE{surges === 1 ? '' : 'S'}</Tag> : undefined}
    >
      <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
        Network-layer attack traffic Cloudflare saw aimed at targets in each country, per day for 28 days; each line is on its own scale, so countries are not compared with each other. The last day is scored against the median of the earlier days: a SURGE is 3× the median and 3+ typical spreads above it. Cloudflare only sees attacks on networks it protects. Read {formatAge(d.fetchedAt, now)} ago.
        {d.noData.length > 0 && ` No data: ${d.noData.join(', ')}.`} Data: Cloudflare Radar, CC BY-NC 4.0.
      </p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="DDoS levels by country">
        <table className="w-full text-2xs">
          <thead className="text-wt-fg-dim">
            <tr className="border-b border-wt-line">
              <th className="px-2 py-1 text-left font-normal">Country</th>
              <th className="px-2 py-1 text-left font-normal">28 days</th>
              <th className="px-2 py-1 text-right font-normal">Last day vs usual</th>
              <th className="px-2 py-1 text-right font-normal">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const hot = (c.score ?? 0) >= 3 && (c.ratio ?? 0) >= 3;
              return (
                <tr key={c.country} className="border-b border-wt-line last:border-0">
                  <td className="px-2 py-1">
                    {countryName(c.country)} <span className="text-wt-fg-dim">{c.day}</span>
                  </td>
                  <td className="px-2 py-1">
                    <Spark c={c} />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{c.ratio == null ? '—' : `${c.ratio}×`}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{c.score == null ? <span className="text-wt-fg-dim">building</span> : hot ? <Tag tone="crit">SURGE {c.score}</Tag> : c.score}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
