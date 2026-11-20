import { useEffect, type ReactNode } from 'react';
import { SOURCE_REGISTRY } from '@shared/domain/sources';
import { CATALOG_VERSION, INDICATOR_CATALOG } from '@shared/domain/indicators/catalog';
import { useData, DASHBOARD_EVENT_LIMIT, LIVE_REFRESH_MINUTES } from '../state/DataContext';
import { useAuth } from '../state/AuthContext';
import { backendMode, firebaseConfig } from '../config/firebase';
import { formatAge, formatUtc } from '../lib/time';
import { isCollectionOverdue, mergeSourceStatus } from '../lib/sourceHealth';
import { useNow } from '../hooks/useNow';
import { Panel } from '../components/ui/Panel';
import { Tag } from '../components/ui/Tag';
import type { Tone } from '../config/categories';

function Row({ k, v, tone }: { k: string; v: ReactNode; tone?: Tone }) {
  return (
    <div className="grid grid-cols-[220px_1fr] gap-3 border-b border-wt-line px-2 py-1 text-xs last:border-b-0">
      <span className="text-wt-fg-dim">{k}</span>
      <span className="min-w-0 break-words">{tone ? <Tag tone={tone}>{v}</Tag> : v}</span>
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

const MODE_TONE: Record<typeof backendMode, Tone> = { demo: 'warn', emulator: 'info', live: 'ok' };

/** Operator diagnostics. Reports only what the application can actually measure. */
export default function DiagnosticsPage() {
  const data = useData();
  const { user } = useAuth();
  const now = useNow(30_000).getTime();
  useEffect(() => {
    document.title = 'WATCHTOWER // DIAGNOSTICS';
  }, []);

  const { mode, events, loadedAt, error, sourceStatus, lastRun, generatedAt, totalEventsStored, readsThisSession } = data;
  const demo = events.filter((e) => e.dataOrigin === 'demo').length;
  const statuses = mergeSourceStatus(sourceStatus, now);
  const active = statuses.filter((s) => s.health !== 'NOT_CONFIGURED').length;
  const live = mode !== 'demo';
  const storage = storageAvailable();

  return (
    <div className="grid h-full content-start gap-1.5 overflow-y-auto p-1.5 lg:grid-cols-2">
      <Panel title="Data Layer" designator="D1">
        <Row k="BACKEND MODE" v={mode.toUpperCase()} tone={MODE_TONE[mode]} />
        <Row k="FIREBASE PROJECT" v={firebaseConfig?.projectId ?? 'NOT CONFIGURED (.env.local)'} />
        <Row k="SIGNED IN AS" v={user?.email ?? (live ? '—' : 'N/A (demo)')} />
        <Row k="LAST LOAD" v={formatUtc(loadedAt, true)} />
        <Row k="LOAD ERROR" v={error ?? 'NONE'} tone={error ? 'crit' : 'ok'} />
        <Row k="SNAPSHOT GENERATED" v={generatedAt ? `${formatUtc(generatedAt, true)} (${formatAge(generatedAt, now)} ago)` : live ? 'NO SNAPSHOT YET' : 'N/A'} tone={isCollectionOverdue(generatedAt, now) ? 'warn' : undefined} />
        <Row k="RECORDS IN WORKING SET" v={`${events.length} (cap ${DASHBOARD_EVENT_LIMIT})`} />
        <Row k="RECORDS STORED (TOTAL)" v={totalEventsStored ?? '—'} />
        <Row k="OF WHICH DEMO" v={demo} tone={demo ? 'warn' : 'ok'} />
        <Row k="FIRESTORE READS (SESSION)" v={readsThisSession ?? 'N/A'} />
        <Row k="AUTO-REFRESH" v={live ? `EVERY ${LIVE_REFRESH_MINUTES} MIN (1 READ)` : 'OFF (DEMO)'} />
        <Row k="LOCAL STORAGE" v={storage ? 'AVAILABLE' : 'UNAVAILABLE — SETTINGS WILL NOT PERSIST'} tone={storage ? 'ok' : 'warn'} />
      </Panel>

      <Panel title="Collection Pipeline" designator="D2">
        <Row k="REGISTERED SOURCES" v={SOURCE_REGISTRY.length} />
        <Row k="ACTIVE COLLECTORS" v={active} tone={active ? 'ok' : 'inactive'} />
        {lastRun ? (
          <>
            <Row k="LAST INGESTION CYCLE" v={`${formatUtc(lastRun.finishedAt, true)} · ${lastRun.trigger.toUpperCase()}`} />
            <Row k="DURATION" v={lastRun.finishedAt ? `${((Date.parse(lastRun.finishedAt) - Date.parse(lastRun.startedAt)) / 1000).toFixed(1)} s` : 'INCOMPLETE'} />
            <Row k="RECORDS FETCHED" v={lastRun.recordsFetched} />
            <Row k="RECORDS IMPORTED" v={lastRun.recordsImported} />
            <Row k="RECORDS REJECTED" v={lastRun.recordsRejected} tone={lastRun.recordsRejected ? 'warn' : undefined} />
            <Row k="DUPLICATES SUPPRESSED" v={lastRun.duplicatesSuppressed} />
            <Row
              k="SOURCE FAILURES"
              v={lastRun.errors.length ? lastRun.errors.map((e) => `${e.sourceId}: ${e.message}`).join(' · ') : 'NONE'}
              tone={lastRun.errors.length ? 'crit' : 'ok'}
            />
          </>
        ) : (
          <Row k="LAST INGESTION CYCLE" v={live ? 'NONE YET — RUN THE COLLECTOR' : 'N/A (DEMO)'} tone="inactive" />
        )}
        <Row k="SCHEDULER" v="GITHUB ACTIONS · HOURLY · BEST-EFFORT TIMING" />
      </Panel>

      <Panel title="Analysis & Alerting" designator="D3">
        <Row k="INDICATOR ENGINE" v={`CATALOG v${CATALOG_VERSION} · ${INDICATOR_CATALOG.length} INDICATORS`} tone="ok" />
        <Row
          k="LAST EVALUATION"
          v={data.indicatorEvaluations[0] ? formatUtc(data.indicatorEvaluations[0].evaluatedAt, true) : mode === 'demo' ? 'IN-BROWSER (DEMO)' : 'NONE RECORDED YET'}
        />
        <Row
          k="EVALUABLE INDICATORS"
          v={`${data.indicatorEvaluations.filter((e) => ['NORMAL', 'ELEVATED', 'TRIGGERED'].includes(e.state)).length} / ${data.indicatorEvaluations.length}`}
        />
        <Row
          k="REGIONS WITH RAI"
          v={`${data.regionScores.filter((s) => s.score !== null).length} / ${data.regionScores.length}`}
        />
        <Row
          k="ENGINE ERRORS (LAST RUN)"
          v={lastRun?.errors.find((e) => e.sourceId === 'indicator-engine')?.message ?? 'NONE'}
          tone={lastRun?.errors.some((e) => e.sourceId === 'indicator-engine') ? 'crit' : 'ok'}
        />
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
