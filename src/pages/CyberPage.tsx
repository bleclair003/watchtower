import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { CAUSE_LABEL, type CyberItem, type KevItem } from '@shared/domain/cyber';
import { useData } from '../state/DataContext';
import { useNow } from '../hooks/useNow';
import { formatAge } from '../lib/time';
import { safeExternalUrl } from '../lib/sanitize';
import { Panel } from '../components/ui/Panel';
import { Tag } from '../components/ui/Tag';
import { MeterCard } from '../components/meters/MeterCard';
import { CensorshipPanel } from '../components/cyber/CensorshipPanel';

const NVD = (cve: string) => `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve)}`;
const pct = (p: number) => `${p >= 0.1 ? Math.round(p * 100) : (p * 100).toFixed(1)}%`;

function ItemLink({ item }: { item: Pick<CyberItem, 'title' | 'url'> }) {
  const url = safeExternalUrl(item.url);
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
      {item.title} <ExternalLink size={9} className="inline" aria-hidden />
    </a>
  ) : (
    <span>{item.title}</span>
  );
}

function ItemList({ items, now, empty }: { items: CyberItem[]; now: number; empty: string }) {
  if (!items.length) return <p className="px-2 py-1.5 text-2xs text-wt-fg-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-wt-line text-2xs">
      {items.map((it) => (
        <li key={`${it.url}-${it.at}`} className="flex flex-wrap items-start gap-x-2 gap-y-0.5 px-2 py-1">
          <span className="w-16 shrink-0 tabular-nums text-wt-fg-dim">{formatAge(it.at, now)} ago</span>
          <Tag tone={it.routine ? 'muted' : 'info'}>{it.label}</Tag>
          {it.cause !== undefined && it.cause !== null && <Tag tone={['GOVERNMENT_DIRECTED', 'MILITARY_ACTION', 'CYBERATTACK'].includes(it.cause) ? 'warn' : 'muted'}>{CAUSE_LABEL[it.cause] ?? it.cause.toLowerCase()}</Tag>}
          {it.ongoing && <Tag tone="warn">ONGOING</Tag>}
          <span className="min-w-0 basis-full sm:basis-0 sm:flex-1">
            <ItemLink item={it} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function KevTable({ kev }: { kev: KevItem[] }) {
  if (!kev.length) return <p className="px-2 py-1.5 text-2xs text-wt-fg-muted">No vulnerabilities added in the last 30 days.</p>;
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Known exploited vulnerabilities table">
      <table className="w-full text-2xs">
        <thead className="text-wt-fg-dim">
          <tr className="border-b border-wt-line">
            <th className="px-2 py-1 text-left font-normal">Added</th>
            <th className="px-2 py-1 text-left font-normal">CVE</th>
            <th className="px-2 py-1 text-left font-normal">Product and weakness</th>
            <th className="px-2 py-1 text-right font-normal" title="FIRST EPSS: modelled probability of exploitation activity in the next 30 days (percentile in brackets)">
              EPSS
            </th>
            <th className="px-2 py-1 text-right font-normal" title="Remediation deadline for US federal agencies">
              Due
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-wt-line">
          {kev.map((k) => (
            <tr key={k.cve}>
              <td className="px-2 py-1 tabular-nums whitespace-nowrap text-wt-fg-muted">{k.added.slice(5)}</td>
              <td className="px-2 py-1 whitespace-nowrap">
                <a href={NVD(k.cve)} target="_blank" rel="noopener noreferrer nofollow" className="tabular-nums hover:underline">
                  {k.cve}
                </a>
              </td>
              <td className="px-2 py-1">
                <span className="text-wt-fg">
                  {k.vendor} {k.product}
                </span>
                {k.ransomware && (
                  <>
                    {' '}
                    <Tag tone="crit">RANSOMWARE</Tag>
                  </>
                )}
                <span className="block text-wt-fg-dim">{k.name}</span>
              </td>
              <td className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${k.epss !== null && k.epss >= 0.5 ? 'text-wt-warn' : ''}`}>
                {k.epss === null ? '—' : `${pct(k.epss)}`}
                {k.percentile !== null && <span className="block text-wt-fg-dim">p{Math.round(k.percentile * 100)}</span>}
              </td>
              <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-wt-fg-muted">{k.due ? k.due.slice(5) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** CYBER: exploited vulnerabilities, CISA and national cyber agencies, internet disruptions, the cyber meter. */
export default function CyberPage() {
  const { cyber, meters, mode, censorship } = useData();
  const now = useNow(60_000).getTime();
  const [showRoutine, setShowRoutine] = useState(false);
  useEffect(() => {
    document.title = 'WATCHTOWER // CYBER';
  }, []);
  const cyberMeter = meters?.meters.find((m) => m.id === 'cyber') ?? null;
  const advisories = useMemo(() => (cyber?.advisories ?? []).filter((a) => showRoutine || !a.routine), [cyber, showRoutine]);
  const routineCount = (cyber?.advisories ?? []).filter((a) => a.routine).length;

  if (!cyber) {
    return (
      <div className="p-1.5">
        <Panel title="Cyber" designator="C0">
          <p className="px-3 py-2 text-xs text-wt-fg-muted">{mode === 'demo' ? 'Loading…' : 'Cyber data appears after the next collection run.'}</p>
        </Panel>
      </div>
    );
  }
  const ransomware = cyber.kev.filter((k) => k.ransomware).length;
  const highEpss = cyber.kev.filter((k) => (k.epss ?? 0) >= 0.5).length;
  const alerts = cyber.advisories.filter((a) => !a.routine).length;
  const disruptions = cyber.outages.filter((o) => o.ongoing).length;

  return (
    <div className="h-full space-y-1.5 overflow-y-auto p-1.5">
      <Panel title="Cyber" designator="C0" actions={cyber.simulated ? <Tag tone="warn">SIMULATED</Tag> : undefined}>
        <dl className="grid grid-cols-2 gap-px border-b border-wt-line bg-wt-line text-2xs sm:grid-cols-5">
          {[
            ['Exploited vulns added (30 d)', cyber.kev.length],
            ['…linked to ransomware', ransomware],
            ['…with EPSS ≥ 50%', highEpss],
            ['CISA alerts and advisories (30 d)', alerts],
            ['Disruptions ongoing (7 d)', disruptions],
          ].map(([label, n]) => (
            <div key={label} className="bg-wt-panel px-2 py-1">
              <dt className="text-wt-fg-dim">{label}</dt>
              <dd className="text-sm tabular-nums text-wt-fg">{n}</dd>
            </div>
          ))}
        </dl>
        {cyberMeter && (
          <div className="px-2 py-1.5">
            <MeterCard meter={cyberMeter} history={meters?.history ?? []} now={now} simulated={cyber.simulated} />
          </div>
        )}
        <p className="border-t border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
          Official sources: CISA (US), UK NCSC, Canadian Centre for Cyber Security, JPCERT/CC (Japan), CERT-UA (Ukraine), with FIRST EPSS scores, internet disruptions from Cloudflare Radar and IODA, and censorship measurements from OONI. Cyber records also appear in the feed under{' '}
          <Link to="/regions/global-cyber" className="text-wt-info underline">
            Global cybersecurity
          </Link>
          .
        </p>
      </Panel>

      <div className="grid gap-1.5 xl:grid-cols-2">
        <Panel title={`Known exploited vulnerabilities (${cyber.kev.length})`} designator="C1">
          <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">
            Added to CISA’s catalog in the last 30 days: each is being exploited in the wild. EPSS (FIRST) is the modelled chance of exploitation activity in the next 30 days{cyber.epssAt ? `, scored ${formatAge(cyber.epssAt, now)} ago` : ''}.
          </p>
          <KevTable kev={cyber.kev} />
        </Panel>

        <div className="space-y-1.5">
          <Panel
            title={`CISA alerts and advisories (${advisories.length})`}
            designator="C2"
            actions={
              routineCount > 0 ? (
                <button className="text-2xs text-wt-info underline" onClick={() => setShowRoutine((v) => !v)} aria-pressed={showRoutine}>
                  {showRoutine ? 'hide' : 'show'} {routineCount} routine
                </button>
              ) : undefined
            }
          >
            <ItemList items={advisories} now={now} empty="No CISA alerts or advisories in 30 days (routine ICS advisories hidden)." />
          </Panel>
          <Panel title={`National cyber agencies (${cyber.agencies.length})`} designator="C3">
            <ItemList items={cyber.agencies} now={now} empty="No items from UK NCSC, the Canadian Centre for Cyber Security, JPCERT/CC or CERT-UA in 30 days." />
          </Panel>
          <Panel title={`Internet disruptions (${cyber.outages.length})`} designator="C4">
            <p className="border-b border-wt-line px-2 py-1 text-2xs text-wt-fg-dim">Last 7 days. Cloudflare states a cause; IODA cannot tell a shutdown from a power cut or cable fault.</p>
            <ItemList items={cyber.outages} now={now} empty="No internet disruptions in 7 days." />
          </Panel>
        </div>
      </div>
      <CensorshipPanel data={censorship} now={now} />
    </div>
  );
}
