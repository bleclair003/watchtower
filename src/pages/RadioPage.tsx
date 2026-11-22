import { useEffect, useState } from 'react';
import { WATCH_REGIONS } from '@shared/domain/regions';
import { RadioPanel } from '../components/radio/RadioPanel';
import { useData } from '../state/DataContext';

/** Phase 28: radio reference — global frequencies, and each region's with receivers near it. */
export default function RadioPage() {
  const { radioReceivers } = useData();
  const [regionId, setRegionId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    document.title = 'WATCHTOWER // RADIO';
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10 * 60_000);
    return () => clearInterval(t);
  }, []);
  const regions = WATCH_REGIONS.filter((r) => r.bbox);
  return (
    <div className="h-full space-y-1.5 overflow-y-auto p-1.5">
      <div className="flex flex-wrap items-center gap-2 border border-wt-line bg-wt-panel px-2 py-1 text-2xs">
        <label htmlFor="radio-region" className="text-wt-fg-dim">
          REGION
        </label>
        <select
          id="radio-region"
          value={regionId ?? ''}
          onChange={(ev) => setRegionId(ev.target.value || null)}
          className="border border-wt-line bg-wt-bg px-1 py-0.5 text-wt-fg"
        >
          <option value="">Global list</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <span className="text-wt-fg-dim">A region adds its own stations and finds ship-channel receivers near it; other stations use receivers near their transmitters. Links open public receivers run by volunteers, already tuned. Nothing plays or is recorded here.</span>
      </div>
      <RadioPanel regionId={regionId} receivers={radioReceivers} now={now} designator="RF" />
    </div>
  );
}
