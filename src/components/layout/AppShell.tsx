import { NavLink, Outlet } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import { TopBar } from './TopBar';
import { useData } from '../../state/DataContext';

interface NavItem {
  to: string;
  label: string;
  /** Phase in which the module ships; present = not yet available. */
  phase?: number;
}

const NAV: NavItem[] = [
  { to: '/', label: 'GOC' },
  { to: '/regions', label: 'REGIONS' },
  { to: '/sources', label: 'SOURCES' },
  { to: '/diagnostics', label: 'DIAGNOSTICS' },
  { to: '/settings', label: 'SETTINGS' },
  { to: '/indicators', label: 'INDICATORS' },
  { to: '/meters', label: 'METERS' },
  { to: '/alerts', label: 'ALERTS' },
  { to: '/dossiers', label: 'DOSSIERS' },
  { to: '/sitrep', label: 'SITREP' },
  { to: '/replay', label: 'REPLAY' },
  { to: '/signal-lab', label: 'SIGNAL LAB' },
];

function DemoStrip() {
  const { mode } = useData();
  if (mode === 'emulator') {
    return (
      <div role="note" className="flex shrink-0 items-center gap-2 border-b border-wt-info/40 bg-wt-info/10 px-3 py-0.5 text-2xs tracking-wider text-wt-info">
        <TriangleAlert size={11} aria-hidden />
        <span>LOCAL EMULATOR — REAL PUBLIC-SOURCE RECORDS IN A LOCAL TEST DATABASE. NOT THE PRODUCTION PROJECT.</span>
      </div>
    );
  }
  if (mode !== 'demo') return null;
  return (
    <div
      role="note"
      className="flex shrink-0 items-center gap-2 border-b border-wt-warn/40 bg-wt-warn/10 px-3 py-0.5 text-2xs tracking-wider text-wt-warn"
    >
      <TriangleAlert size={11} aria-hidden />
      <span>
        DEMONSTRATION DATA — ALL EVENTS SHOWN ARE SIMULATED FIXTURES, NOT REAL INTELLIGENCE. CONFIGURE FIREBASE IN .ENV.LOCAL FOR LIVE DATA.
      </span>
    </div>
  );
}

export function AppShell() {
  return (
    <div className="flex h-full flex-col">
      <a
        href="#main"
        className="sr-only z-50 bg-wt-fg px-2 py-1 text-xs text-wt-bg focus:not-sr-only focus:absolute focus:top-1 focus:left-1"
      >
        Skip to content
      </a>
      <TopBar />
      <DemoStrip />
      <nav aria-label="Modules" className="flex h-7 shrink-0 items-stretch gap-px overflow-x-auto border-b border-wt-line bg-wt-bg px-2">
        {NAV.map((n) =>
          n.phase ? (
            <span
              key={n.to}
              aria-disabled="true"
              title={`Module not yet built — scheduled for Phase ${n.phase}`}
              className="flex cursor-not-allowed items-center gap-1 px-2.5 text-2xs tracking-widest whitespace-nowrap text-wt-inactive/70"
            >
              {n.label}
              <span className="text-[9px] text-wt-inactive/60">P{n.phase}</span>
            </span>
          ) : (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center px-2.5 text-2xs tracking-widest whitespace-nowrap ${
                  isActive ? 'bg-wt-fg text-wt-bg' : 'text-wt-fg-muted hover:text-wt-fg'
                }`
              }
            >
              {n.label}
            </NavLink>
          ),
        )}
      </nav>
      <main id="main" tabIndex={-1} className="min-h-0 flex-1 focus:outline-none">
        <Outlet />
      </main>
    </div>
  );
}
