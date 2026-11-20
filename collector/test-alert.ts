/**
 * Sends one clearly-labelled TEST notification to the configured Discord
 * webhook, to verify delivery end-to-end. Creates no alert records.
 *
 *   DISCORD_WEBHOOK_URL=... node collector/test-alert.ts
 */
import { buildDiscordPayload, isDiscordWebhookUrl, sendDiscord } from './alerts/discord.ts';

async function main(): Promise<number> {
  const url = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!url) {
    console.error('DISCORD_WEBHOOK_URL is not set.');
    return 1;
  }
  if (!isDiscordWebhookUrl(url)) {
    console.error('DISCORD_WEBHOOK_URL is not a Discord webhook URL.');
    return 1;
  }
  const now = new Date().toISOString();
  const payload = buildDiscordPayload({ name: 'Delivery test', severity: 'INFORMATION' }, [
    {
      id: 'test', ruleId: 'test', ruleName: 'Delivery test', ruleVersion: 1, severity: 'INFORMATION',
      title: 'WATCHTOWER test notification',
      body: 'This is a test of alert delivery. No real event triggered it.',
      regionIds: [], url: '', evidenceEventIds: [], dedupeKey: 'test', createdAt: now,
      acknowledged: false, acknowledgedAt: null, dismissed: false, dismissedAt: null,
      delivery: { discord: 'pending', at: null, error: null },
    },
  ]);
  await sendDiscord(url, payload);
  console.log('Test notification delivered to Discord.');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
