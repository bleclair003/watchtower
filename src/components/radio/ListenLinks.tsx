import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { IntelligenceEvent } from '@shared/domain/types';
import { listenLinks, unpackAirports, type Airport } from '@shared/domain/radio';
import { useOptionalData } from '../../state/DataContext';
import { safeExternalUrl } from '../../lib/sanitize';

let airportsPromise: Promise<Airport[]> | null = null;
/** The airport table is large, so it loads only when a located record is opened (once per visit). */
function loadAirports(): Promise<Airport[]> {
  airportsPromise ??= import('@shared/domain/airportsData').then((m) => unpackAirports(m.AIRPORTS_PACKED));
  return airportsPromise;
}

const AIRCRAFT_SUBTYPES = new Set(['aircraft-emergency', 'military-aircraft-sighting', 'aircraft-pattern']);
const isAviationRecord = (e: IntelligenceEvent) => e.category === 'aviation' || AIRCRAFT_SUBTYPES.has(String(e.metadata?.subtype ?? ''));

/** Phase 28: radio listening links for a located record (nearest ATC, US scanner feeds, oceanic HF). */
export function ListenLinks({ event: e }: { event: IntelligenceEvent }) {
  const radioReceivers = useOptionalData()?.radioReceivers ?? null;
  const [airports, setAirports] = useState<Airport[] | null>(null);
  const located = typeof e.latitude === 'number' && typeof e.longitude === 'number' && e.locationPrecision !== 'none';
  useEffect(() => {
    if (!located) return;
    let live = true;
    loadAirports().then((a) => live && setAirports(a), () => live && setAirports([]));
    return () => {
      live = false;
    };
  }, [located]);
  if (!located || !airports) return null;
  const links = listenLinks({ lat: e.latitude!, lon: e.longitude!, aviation: isAviationRecord(e) }, airports, radioReceivers?.receivers ?? []);
  if (links.length === 0) return null;
  return (
    <>
      <dt className="text-wt-fg-dim">LISTEN</dt>
      <dd className="space-y-0.5">
        {links.map((l) => {
          const href = safeExternalUrl(l.url);
          return (
            <span key={l.url} className="block">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-wt-info hover:underline">
                  {l.label} <ExternalLink size={9} aria-hidden />
                </a>
              ) : (
                l.label
              )}
              {l.note && <span className="block text-wt-fg-dim">{l.note}</span>}
            </span>
          );
        })}
        <span className="block text-wt-fg-dim">Links to services run by others; listening rules differ by country.</span>
      </dd>
    </>
  );
}
