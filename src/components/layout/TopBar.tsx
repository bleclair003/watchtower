import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Settings, Radar } from 'lucide-react';
import { WATCH_REGIONS } from '@shared/domain/regions';
import { formatClock, formatAge } from '../../lib/time';
import { useNow, useOnline } from '../../hooks/useNow';
import { useData } from '../../state/DataContext';
import { Lamp } from '../ui/Tag';
import { CommandConsole } from './CommandConsole';

function Readout({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="flex flex-col justify-center leading-tight" title={title}>
      <span className="text-2xs tracking-widest text-wt-fg-dim">{label}</span>
      <span className="text-xs whitespace-nowrap tabular-nums">{children}</span>
    </div>
  );
}

export function TopBar() {
  const now = useNow(1000);
  const online = useOnline();
  const { loadedAt, error, mode } = useData();

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-wt-line-strong bg-wt-bg2 px-3 py-1.5 md:h-12 md:flex-nowrap md:py-0">
      <Link to="/" className="flex items-center gap-2 pr-2" aria-label="WATCHTOWER home">
        <span className="relative grid size-7 place-items-center border border-wt-fg/60">
          <Radar size={16} className="text-wt-fg" aria-hidden />
        </span>
        <span className="flex flex-col leading-none">
          <span className="glow font-display text-base tracking-[0.3em]">WATCHTOWER</span>
          <span className="text-2xs tracking-[0.2em] text-wt-fg-dim">WT-01 // GLOBAL OPERATIONS CENTER</span>
        </span>
      </Link>

      <div className="hidden gap-4 lg:flex">
        <Readout label="UTC">{formatClock(now, 'utc')}Z</Readout>
        <Readout label="LOCAL">{formatClock(now, 'local')}</Readout>
      </div>

      <div className="order-last flex min-w-0 basis-full justify-center md:order-none md:flex-1 md:basis-auto">
        <CommandConsole />
      </div>

      <div className="hidden items-center gap-4 xl:flex">
        <Readout label="LINK" title="Browser network connectivity (navigator.onLine)">
          <span className="flex items-center gap-1.5">
            <Lamp tone={online ? 'ok' : 'crit'} label={online ? 'Online' : 'Offline'} />
            {online ? 'ONLINE' : 'OFFLINE'}
          </span>
        </Readout>
        <Readout label="LAST REFRESH" title="When this dashboard last loaded data from its repository">
          <span className={error ? 'text-wt-crit' : ''}>
            {error ? 'ERROR' : loadedAt ? `${formatAge(loadedAt, now.getTime())} AGO` : '—'}
          </span>
        </Readout>
        <Readout label="WATCHES">{WATCH_REGIONS.length}</Readout>
        <Readout label="ALERTS" title="Alert system not deployed until Phase 4">
          <span className="text-wt-inactive">OFFLINE</span>
        </Readout>
        <Readout label="DATA">
          <span className={mode === 'demo' ? 'text-wt-warn' : mode === 'emulator' ? 'text-wt-info' : 'text-wt-fg'}>{mode.toUpperCase()}</span>
        </Readout>
      </div>

      <Link
        to="/settings"
        className="ml-auto grid size-7 place-items-center border border-wt-line-strong text-wt-fg-muted hover:border-wt-fg hover:text-wt-fg md:ml-0"
        aria-label="Settings"
        title="Settings"
      >
        <Settings size={14} aria-hidden />
      </Link>
    </header>
  );
}
