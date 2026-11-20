import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { DataProvider } from './state/DataContext';
import { DashboardProvider } from './state/DashboardContext';
import { SettingsProvider } from './state/SettingsContext';
import { AuthProvider } from './state/AuthContext';
import { AuthGate } from './components/layout/AuthGate';
import GlobalOperationsPage from './pages/GlobalOperationsPage';
import SourcesPage from './pages/SourcesPage';
import DiagnosticsPage from './pages/DiagnosticsPage';
import SettingsPage from './pages/SettingsPage';
import IndicatorsPage from './pages/IndicatorsPage';
import AlertsPage from './pages/AlertsPage';
import DossiersPage from './pages/DossiersPage';
import DossierPage from './pages/DossierPage';

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
                    <Route index element={<GlobalOperationsPage />} />
                    <Route path="sources" element={<SourcesPage />} />
                    <Route path="diagnostics" element={<DiagnosticsPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="indicators" element={<IndicatorsPage />} />
                    <Route path="alerts" element={<AlertsPage />} />
                    <Route path="dossiers" element={<DossiersPage />} />
                    <Route path="dossiers/:id" element={<DossierPage />} />
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
