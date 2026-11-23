import type { AlertRecord, AlertSeverity, FeedbackVerdict } from '@shared/domain/alerts/types';
import type { MissedIncident } from '@shared/domain/alerts/scorecard';
import type { CollectionRun } from '@shared/domain/types';

/**
 * Demo-only scorecard input (v0.67.0). Every title is marked [SIMULATED]; nothing here is a real
 * alert, verdict or incident.
 */
export function buildDemoScorecardInput(now: number): { alerts: AlertRecord[]; missed: MissedIncident[]; runs: CollectionRun[] } {
  const H = 3_600_000;
  const rules: { id: string; name: string; severity: AlertSeverity; version: number; verdicts: (FeedbackVerdict | null)[] }[] = [
    { id: 'demo-r1', name: '[SIMULATED] Carrier enters a watch region', severity: 'WARNING', version: 2, verdicts: ['useful', 'useful', 'useful', 'irrelevant', null] },
    { id: 'demo-r2', name: '[SIMULATED] Any Red Sea maritime record', severity: 'ADVISORY', version: 1, verdicts: ['irrelevant', 'irrelevant', 'useful', 'false-positive', 'irrelevant', 'irrelevant', null, null] },
    { id: 'demo-r3', name: '[SIMULATED] Embassy drawdown', severity: 'CRITICAL', version: 1, verdicts: ['useful', 'useful'] },
    { id: 'demo-r4', name: '[SIMULATED] Strike reports near nuclear sites', severity: 'WARNING', version: 3, verdicts: ['false-positive', 'miscategorised', 'useful', null] },
  ];
  const alerts: AlertRecord[] = [];
  let k = 0;
  for (const r of rules) {
    r.verdicts.forEach((v, i) => {
      const created = new Date(now - (k * 37 + i * 11 + 5) * H).toISOString();
      k++;
      alerts.push({
        id: `demo-a${k}`,
        ruleId: r.id,
        ruleName: r.name,
        ruleVersion: r.version,
        catalogVersion: 21,
        severity: r.severity,
        title: `[SIMULATED] Demo alert ${k}`,
        body: '',
        regionIds: [],
        url: '',
        evidenceEventIds: [],
        dedupeKey: `demo:${k}`,
        createdAt: created,
        acknowledged: v != null,
        acknowledgedAt: v != null ? created : null,
        dismissed: false,
        dismissedAt: null,
        delivery: { discord: 'not-requested', at: null, error: null },
        feedback: v ? { verdict: v, note: '', at: created } : null,
      });
    });
  }
  const iso = (h: number) => new Date(now - h * H).toISOString();
  const missed: MissedIncident[] = [
    { id: 'demo-m1', title: '[SIMULATED] Port closure announced on state TV', occurredAt: iso(80), kind: 'missed', lateHours: null, regionIds: ['red-sea'], category: 'maritime', url: '', note: 'No source covers that broadcaster.', createdAt: iso(70), updatedAt: iso(70), version: 1 },
    { id: 'demo-m2', title: '[SIMULATED] Airspace closure', occurredAt: iso(200), kind: 'late', lateHours: 9, regionIds: ['middle-east'], category: 'aviation', url: '', note: '', createdAt: iso(180), updatedAt: iso(180), version: 1 },
  ];
  const runs: CollectionRun[] = Array.from({ length: 160 }, (_, i) => ({
    id: `demo-run-${i}`,
    startedAt: iso(i + 0.1),
    finishedAt: iso(i),
    trigger: 'schedule',
    recordsFetched: 0,
    recordsImported: 0,
    recordsRejected: 0,
    duplicatesSuppressed: 0,
    errors: i % 9 === 0 ? [{ sourceId: 'demo-ais', message: 'simulated' }] : i % 31 === 0 ? [{ sourceId: 'demo-feed', message: 'simulated' }] : [],
  }));
  return { alerts, missed, runs };
}
