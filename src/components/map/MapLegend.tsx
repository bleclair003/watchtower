import { BRANCH_COLOR, OPERATION_COLOR, OPERATION_LABEL } from './WorldMap';
import { useState } from 'react';
import { EVENT_CATEGORIES } from '@shared/domain/types';
import { CATEGORY_STYLES } from '../../config/categories';
import { CategoryGlyph } from '../ui/CategoryGlyph';

interface Props {
  plotted: number;
  areaLevel: number;
  unlocated: number;
  /** Installations shown on the map (omit when the layer is off). */
  installations?: number;
  worldInstallations?: number;
  /** Name of the operating country the bases are filtered to, if any. */
  operatorFilter?: string;
}

const BRANCH_LABEL = { army: 'Army', navy: 'Navy', 'air-force': 'Air Force', marines: 'Marines', other: 'Other DoD' } as const;

/** Collapsible legend explaining symbols and location-precision handling. */
export function MapLegend({ plotted, areaLevel, unlocated, installations, worldInstallations, operatorFilter }: Props) {
  const [open, setOpen] = useState(true);
  return (
    <div className="pointer-events-auto absolute bottom-2 left-2 z-10 max-w-[230px] border border-wt-line-strong bg-wt-panel/95 text-2xs">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-2 py-1 tracking-widest text-wt-fg-muted hover:text-wt-fg"
      >
        LEGEND <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-wt-line p-2">
          <ul className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {EVENT_CATEGORIES.map((c) => (
              <li key={c} className="flex items-center gap-1 text-wt-fg">
                <CategoryGlyph category={c} size={10} />
                <span className="text-wt-fg-muted">{CATEGORY_STYLES[c].label}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
            <div className="flex justify-between">
              <span>Plotted (exact/city)</span>
              <span className="text-wt-fg tabular-nums">{plotted}</span>
            </div>
            <div className="flex justify-between" title="Country- or region-level reports. Counted on the dashed watch area, never pinned to an invented point.">
              <span>Area-level (dashed box)</span>
              <span className="text-wt-fg tabular-nums">{areaLevel}</span>
            </div>
            <div className="flex justify-between">
              <span>No geography (feed only)</span>
              <span className="text-wt-fg tabular-nums">{unlocated}</span>
            </div>
          </div>
          {installations !== undefined && (
            <div className="space-y-0.5 border-t border-wt-line pt-1.5 text-wt-fg-muted">
              {operatorFilter && <p className="text-wt-info">Operated by {operatorFilter} only</p>}
              <div className="flex justify-between">
                <span>Installations (DoD, US)</span>
                <span className="text-wt-fg tabular-nums">{installations}</span>
              </div>
              <ul className="grid grid-cols-2 gap-x-2">
                {(['army', 'navy', 'air-force', 'marines', 'other'] as const).map((b) => (
                  <li key={b} className="flex items-center gap-1">
                    <span className="size-2 rounded-full" style={{ background: BRANCH_COLOR[b] }} aria-hidden />
                    {BRANCH_LABEL[b]}
                  </li>
                ))}
              </ul>
              {worldInstallations !== undefined && (
                <>
                  <div className="flex justify-between pt-1">
                    <span title="Wikidata, community-maintained">Worldwide (Wikidata)</span>
                    <span className="text-wt-fg tabular-nums">{worldInstallations}</span>
                  </div>
                  <ul>
                    {(['us-abroad', 'foreign', 'national'] as const).map((o) => (
                      <li key={o} className="flex items-center gap-1">
                        <span className="size-2 rounded-full border-[1.5px]" style={{ borderColor: OPERATION_COLOR[o] }} aria-hidden />
                        {OPERATION_LABEL[o]}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
