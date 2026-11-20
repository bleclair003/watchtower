import type { AlertRecord, AlertRule, AlertSeverity } from '../../shared/domain/alerts/types.ts';
import { getRegion } from '../../shared/domain/regions.ts';

/**
 * Discord webhook delivery.
 *
 * The webhook URL is a secret (anyone holding it can post to the channel):
 * it comes only from the DISCORD_WEBHOOK_URL Actions secret, is validated to
 * be a genuine Discord webhook endpoint, and is NEVER logged or persisted —
 * errors report only the HTTP status.
 */
const WEBHOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d{5,30}\/[A-Za-z0-9_-]{20,100}$/;

export function isDiscordWebhookUrl(url: string): boolean {
  return WEBHOOK_RE.test(url.trim());
}

const SEVERITY_COLOR: Record<AlertSeverity, number> = {
  INFORMATION: 0x69c6d5,
  ADVISORY: 0x6aff9b,
  WARNING: 0xffc857,
  CRITICAL: 0xff5555,
};

/** Source text is untrusted: neutralize Discord markdown and mention syntax. */
export function escapeDiscord(text: string): string {
  return text
    .replace(/[\\*_~`|>[\]()]/g, (c) => `\\${c}`)
    .replace(/@/g, '@\u200b')
    .replace(/<(?=[@#:])/g, '<\u200b');
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

export interface DiscordPayload {
  username: string;
  allowed_mentions: { parse: never[] };
  embeds: Record<string, unknown>[];
}

/** One message per rule per run (up to 10 embeds; Discord's limit). */
export function buildDiscordPayload(rule: Pick<AlertRule, 'name' | 'severity'>, alerts: AlertRecord[], appUrl?: string): DiscordPayload {
  const shown = alerts.length > 10 ? alerts.slice(0, 9) : alerts;
  const embeds: Record<string, unknown>[] = shown.map((a) => ({
    title: clip(escapeDiscord(a.title), 250),
    ...(a.url ? { url: a.url } : {}),
    description: clip(escapeDiscord(a.body), 600),
    color: SEVERITY_COLOR[a.severity],
    fields: [
      { name: 'Level', value: a.severity, inline: true },
      { name: 'Rule', value: clip(escapeDiscord(a.ruleName), 100), inline: true },
      ...(a.regionIds.length
        ? [{ name: 'Region', value: clip(a.regionIds.map((r) => getRegion(r)?.name ?? r).join(', '), 100), inline: true }]
        : []),
    ],
    timestamp: a.createdAt,
    footer: { text: 'WATCHTOWER · application alert level, not an official warning' },
  }));
  if (alerts.length > shown.length) {
    embeds.push({
      title: `+${alerts.length - shown.length} more alert(s) from this rule`,
      description: appUrl ? `Open WATCHTOWER: ${appUrl}/alerts` : 'Open WATCHTOWER → ALERTS to review.',
      color: SEVERITY_COLOR[rule.severity],
    });
  }
  return { username: 'WATCHTOWER', allowed_mentions: { parse: [] }, embeds };
}

export class DiscordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscordError';
  }
}

/** Posts a payload; retries once on 429 honouring retry_after (capped). Never includes the URL in errors. */
export async function sendDiscord(
  webhookUrl: string,
  payload: DiscordPayload,
  opts: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  if (!isDiscordWebhookUrl(webhookUrl)) throw new DiscordError('Webhook URL is not a Discord webhook endpoint');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(webhookUrl.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new DiscordError(`Discord request failed: ${(err as Error).name}`);
    }
    if (res.ok) return;
    if (res.status === 429 && attempt === 0) {
      let wait = 2_000;
      try {
        wait = Math.min(10_000, Math.ceil(Number((await res.json()).retry_after ?? 2) * 1000));
      } catch {
        /* default wait */
      }
      await sleep(wait);
      continue;
    }
    throw new DiscordError(`Discord returned HTTP ${res.status}`);
  }
  throw new DiscordError('Discord rate limit persisted');
}
