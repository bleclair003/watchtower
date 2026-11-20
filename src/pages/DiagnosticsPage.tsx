import { useEffect, type ReactNode } from 'react';
import { SOURCE_REGISTRY } from '@shared/domain/sources';
import { useData, DASHBOARD_EVENT_LIMIT } from '../state/DataContext';
import { isFirebaseConfigured } from '../config/firebase';
import { formatUtc } from '../lib/time';
import { Panel } from '../components/ui/Panel';
import { Tag } from '../components/ui/Tag';
import type { Tone } from '../config/categories';

function Row({ k, v, tone }: { k: string; v: ReactNode; tone?: Tone }) {
  return (
    <div className="grid grid-cols-[220px_1fr] gap-3 border-b border-wt-line px-2 py-1 text-xs last:border-b-0">
      <span className="text-wt-fg-dim">{k}</span>
      <span>{tone ? <Tag tone={tone}>{v}</Tag> : v}</span>
    </div>
  );
}

function storageAvailable(): boolean {
  try {
    const k = '__wt_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/** Operator diagnostics. Reports only what the application can actually measure. */
export default function DiagnosticsPage() {
  const { mode, events, loadedAt, error, sourceStatus } = useData();
  useEffect(() => {
    document.title = 'WATCHTOWER // DIAGNOSTICS';
  }, []);

  const demo = events.filter((e) => e.dataOrigin === 'demo').length;
  const configured = sourceStatus.filter((s) => s.health !== 'NOT_CONFIGURED').length;

  return (
    <div className="grid h-full content-start gap-1.5 overflow-y-auto p-1.5 lg:grid-cols-2">
      <Panel title="Data Layer" designator="D1">
        <Row k="REPOSITORY MODE" v={mode === 'demo' ? 'DEMO FIXTURES' : 'FIRESTORE'} tone={mode === 'demo' ? 'warn' : 'ok'} />
        <Row k="FIREBASE WEB CONFIG" v={isFirebaseConfigured ? 'PRESENT' : 'NOT SET (.env.local)'} tone={isFirebaseConfigured ? 'ok' : 'inactive'} />
        <Row k="LAST LOAD" v={formatUtc(loadedAt, true)} />
        <Row k="LOAD ERROR" v={error ?? 'NONE'} tone={error ? 'crit' : 'ok'} />
        <Row k="RECORDS IN WORKING SET" v={`${events.length} (cap ${DASHBOARD_EVENT_LIMIT})`} />
        <Row k="OF WHICH DEMO" v={demo} tone={demo ? 'warn' : 'ok'} />
        <Row k="FIRESTORE READS (SESSION)" v="N/A — NOT CONNECTED" />
        <Row k="LOCAL STORAGE" v={storageAvailable() ? 'AVAILABLE' : 'UNAVAILABLE — SETTINGS WILL NOT PERSIST'} tone={storageAvailable() ? 'ok' : 'warn'} />
      </Panel>

      <Panel title="Collection Pipeline" designator="D2">
        <Row k="REGISTERED SOURCES" v={SOURCE_REGISTRY.length} />
        <Row k="ACTIVE COLLECTORS" v={configured} tone={configured ? 'ok' : 'inactive'} />
        <Row k="LAST INGESTION CYCLE" v="NEVER — COLLECTORS NOT DEPLOYED" tone="inactive" />
        <Row k="RECORDS IMPORTED" v="—" />
        <Row k="RECORDS REJECTED" v="—" />
        <Row k="DUPLICATES SUPPRESSED" v="—" />
        <Row k="RECENT WORKFLOW FAILURES" v="—" />
        <Row k="SCHEDULER" v="GITHUB ACTIONS (PHASE 2) — BEST-EFFORT TIMING" />
      </Panel>

      <Panel title="Analysis & Alerting" designator="D3">
        <Row k="INDICATOR ENGINE" v="NOT DEPLOYED (PHASE 3)" tone="inactive" />
        <Row k="REGIONAL ACTIVITY INDEX" v="NOT EVALUATED" tone="inactive" />
        <Row k="ALERT ENGINE" v="NOT DEPLOYED (PHASE 4)" tone="inactive" />
        <Row k="DISCORD WEBHOOK" v="NOT CONFIGURED" tone="inactive" />
      </Panel>

      <Panel title="Client" designator="D4">
        <Row k="BUILD MODE" v={import.meta.env.MODE.toUpperCase()} />
        <Row k="USER AGENT ONLINE" v={navigator.onLine ? 'YES' : 'NO'} tone={navigator.onLine ? 'ok' : 'crit'} />
        <Row
          k="REDUCED MOTION"
          v={window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'REQUESTED — ANIMATION SUPPRESSED' : 'NOT REQUESTED'}
        />
        <Row k="BASEMAP" v="OPENFREEMAP (DARK) — RECOLOURED" />
      </Panel>
    </div>
  );
}
