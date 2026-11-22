import type { CensorshipSnapshot } from '@shared/domain/censorship';

/** SIMULATED censorship grid for demo mode and tests: invented readings. */
export function buildDemoCensorship(now: number): CensorshipSnapshot {
  const at = new Date(now - 40 * 60_000).toISOString();
  const t = (id: string, status: 'blocked' | 'partial' | 'ok', share: number, isNew = false) => ({ id, status, share, priorShare: isNew ? 0.05 : share, tests: 120, isNew });
  return {
    simulated: true,
    countries: [
      { cc: 'IR', name: '[SIMULATED] Demo Country A', regionIds: ['middle-east'], fetchedAt: at, targets: [t('whatsapp', 'blocked', 0.9), t('telegram', 'blocked', 0.9), t('signal', 'blocked', 0.88), t('youtube', 'blocked', 0.82), t('instagram', 'blocked', 0.85), t('twitter', 'blocked', 0.8), t('facebook', 'blocked', 0.86)] },
      { cc: 'UA', name: '[SIMULATED] Demo Country B', regionIds: ['eastern-europe'], fetchedAt: at, targets: [t('whatsapp', 'ok', 0.02), t('telegram', 'partial', 0.35, true), t('signal', 'ok', 0.01), t('youtube', 'ok', 0), t('instagram', 'ok', 0.03), t('twitter', 'ok', 0.02), t('facebook', 'ok', 0.01)] },
    ],
  };
}
