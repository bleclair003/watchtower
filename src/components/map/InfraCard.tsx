import { ExternalLink, X } from 'lucide-react';
import { INFRA_LABEL, INFRA_RADIUS_KM, isNuclearType, type FlaggedSite, type InfraDataset, type InfraSite } from '@shared/domain/infrastructure';
import { countryName } from '../../lib/regionSummary';
import { formatAge } from '../../lib/time';
import { safeExternalUrl } from '../../lib/sanitize';
import { Tag } from '../ui/Tag';
import { INFRA_COLOR } from './WorldMap';

/** A critical-infrastructure site: facts from its source, and records near or naming it (72 h). */
export function InfraCard({ site, flagged, dataset, now, onClose }: { site: InfraSite | null; flagged: FlaggedSite | null; dataset: InfraDataset | null; now: number; onClose: () => void }) {
  const name = site?.n[0] ?? flagged?.name ?? '';
  const type = site?.t ?? flagged?.type ?? 'power';
  const lat = site?.la ?? flagged?.lat ?? 0;
  const lon = site?.lo ?? flagged?.lon ?? 0;
  const country = site?.c ?? flagged?.country ?? '';
  const wiki = site?.w ? safeExternalUrl(`https://en.wikipedia.org/wiki/${encodeURIComponent(site.w)}`) : null;
  const osm = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=13/${lat}/${lon}`;
  const sources = dataset?.sources.filter((s) => (site?.s ?? []).some((k) => s.name.toLowerCase().startsWith(k === 'wri' ? 'world resources' : 'wikidata'))) ?? [];
  return (
    <section aria-label={name} className="absolute top-2 right-2 z-20 max-h-[calc(100%-1rem)] w-80 max-w-[calc(100%-1rem)] overflow-y-auto border border-wt-line bg-wt-panel/95 text-2xs shadow-lg">
      <header className="flex items-start gap-2 border-b border-wt-line px-2 py-1.5">
        <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: INFRA_COLOR[type] }} aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-xs text-wt-fg">{name}</h3>
          <p className="text-wt-fg-muted">
            {INFRA_LABEL[type]} · {countryName(country)}
          </p>
        </div>
        {flagged && <Tag tone={isNuclearType(flagged.type) ? 'crit' : 'warn'}>FLAGGED</Tag>}
        <button onClick={onClose} aria-label="Close" className="text-wt-fg-muted hover:text-wt-fg">
          <X size={12} />
        </button>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 px-2 py-1.5">
        {site?.f && (
          <>
            <dt className="text-wt-fg-dim">FUEL</dt>
            <dd>
              {site.f}
              {site.mw ? ` · ${site.mw.toLocaleString('en-US')} MW` : ''}
            </dd>
          </>
        )}
        {site && site.n.length > 1 && (
          <>
            <dt className="text-wt-fg-dim">ALSO KNOWN AS</dt>
            <dd className="text-wt-fg-muted">{site.n.slice(1).join(' · ')}</dd>
          </>
        )}
        <dt className="text-wt-fg-dim">LOCATION</dt>
        <dd className="tabular-nums">
          {lat.toFixed(4)}, {lon.toFixed(4)}
        </dd>
        <dt className="text-wt-fg-dim">LOOK UP</dt>
        <dd className="flex gap-2">
          {wiki && (
            <a href={wiki} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-wt-info underline">
              Wikipedia <ExternalLink size={9} aria-hidden />
            </a>
          )}
          <a href={osm} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-wt-info underline">
            OpenStreetMap <ExternalLink size={9} aria-hidden />
          </a>
        </dd>
        {sources.length > 0 && (
          <>
            <dt className="text-wt-fg-dim">SOURCE</dt>
            <dd className="text-wt-fg-muted">{sources.map((s) => `${s.name.split(' — ')[0]} (${s.licence.split(' (')[0]}, ${s.dataCurrency})`).join('; ')}</dd>
          </>
        )}
      </dl>
      <div className="border-t border-wt-line px-2 py-1">
        <h4 className="text-wt-fg-dim">RECORDS NEAR OR NAMING IT — 72 H</h4>
        {!flagged ? (
          <p className="text-wt-fg-dim">None.</p>
        ) : (
          <ul className="space-y-0.5">
            {flagged.matches.map((m, i) => {
              const url = safeExternalUrl(m.url);
              return (
                <li key={`${m.title}-${i}`} className="flex gap-1.5">
                  <span className="min-w-0 flex-1">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                        {m.title}
                      </a>
                    ) : (
                      m.title
                    )}
                    <span className="text-wt-fg-dim"> · {m.how === 'near' ? `${m.km} km away` : 'names it'}{m.kind === 'fire' ? ', fire detection' : m.kind === 'strike' ? ', strike report' : ''}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-wt-fg-dim">{formatAge(m.at, now)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="border-t border-wt-line px-2 py-1 text-wt-fg-dim">
        Near = a new fire cluster or an exactly located military record within {INFRA_RADIUS_KM[type]} km. Named = the record names the site with its type (“… nuclear plant”, “Port of …”); embassies are matched by location only. A fire near an industrial site can be routine.{type === 'embassy' && ' Embassies and consulates come from Wikidata, where only some missions have a location.'}{type === 'nuclear-site' && ' Other nuclear facilities are as Wikidata classes them (research reactors, enrichment and fuel-cycle sites, some former test or waste sites).'}
      </p>
    </section>
  );
}
