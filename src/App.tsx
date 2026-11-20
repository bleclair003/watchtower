import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { DataProvider } from './state/DataContext';
import { DashboardProvider } from './state/DashboardContext';
import { SettingsProvider } from './state/SettingsContext';
import { AuthProvider } from './state/AuthContext';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { AuthGate } from './components/layout/AuthGate';

/**
 * After a deploy, an open tab may ask for a chunk that no longer exists. Reload once to pick up the
 * new build instead of showing a broken page; a second failure is shown as a normal error.
 */
const RELOAD_KEY = 'wt.chunkReload';
function lazyPage<T extends { default: ComponentType }>(load: () => Promise<T>) {
  return lazy(() =>
    load().then(
      (m) => {
        try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* storage unavailable */ }
        return m;
      },
      (err: unknown) => {
        let reloaded = true;
        try {
          reloaded = sessionStorage.getItem(RELOAD_KEY) === '1';
          if (!reloaded) sessionStorage.setItem(RELOAD_KEY, '1');
        } catch { /* storage unavailable: do not loop */ }
        if (!reloaded) window.location.reload();
        throw err;
      },
    ),
  );
}

const GlobalOperationsPage = lazyPage(() => import('./pages/GlobalOperationsPage'));
const SourcesPage = lazyPage(() => import('./pages/SourcesPage'));
const DiagnosticsPage = lazyPage(() => import('./pages/DiagnosticsPage'));
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'));
const IndicatorsPage = lazyPage(() => import('./pages/IndicatorsPage'));
const AlertsPage = lazyPage(() => import('./pages/AlertsPage'));
const DossiersPage = lazyPage(() => import('./pages/DossiersPage'));
const DossierPage = lazyPage(() => import('./pages/DossierPage'));
const SitrepPage = lazyPage(() => import('./pages/SitrepPage'));
const ReplayPage = lazyPage(() => import('./pages/ReplayPage'));
const SignalLabPage = lazyPage(() => import('./pages/SignalLabPage'));

function RouteLoading() {
  return (
    <div role="status" className="grid h-full place-items-center text-2xs tracking-widest text-wt-fg-dim">
      LOADING MODULE…
    </div>
  );
}

/** Each module is its own chunk; this keeps the first load small. */
const page = (node: ReactNode) => (
  <ErrorBoundary>
    <Suspense fallback={<RouteLoading />}>{node}</Suspense>
  </ErrorBoundary>
);

function NotFound() {
  return (
    <div className="grid h-full place-items-center text-center text-xs">
      <div>
        <p className="tracking-widest text-wt-warn">ROUTE NOT RECOGNIZED</p>
        <Link to="/" className="mt-2 inline-block text-wt-fg-muted hover:text-wt-fg">[RETURN TO GOC]</Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <AuthProvider>
        <AuthGate>
          <DataProvider>
            <BrowserRouter>
              <DashboardProvider>
                <Routes>
                  <Route element={<AppShell />}>
                    <Route index element={page(<GlobalOperationsPage />)} />
                    <Route path="sources" element={page(<SourcesPage />)} />
                    <Route path="diagnostics" element={page(<DiagnosticsPage />)} />
                    <Route path="settings" element={page(<SettingsPage />)} />
                    <Route path="indicators" element={page(<IndicatorsPage />)} />
                    <Route path="alerts" element={page(<AlertsPage />)} />
                    <Route path="dossiers" element={page(<DossiersPage />)} />
                    <Route path="dossiers/:id" element={page(<DossierPage />)} />
                    <Route path="sitrep" element={page(<SitrepPage />)} />
                    <Route path="replay" element={page(<ReplayPage />)} />
                    <Route path="signal-lab" element={page(<SignalLabPage />)} />
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Routes>
              </DashboardProvider>
            </BrowserRouter>
          </DataProvider>
        </AuthGate>
      </AuthProvider>
    </SettingsProvider>
  );
}
