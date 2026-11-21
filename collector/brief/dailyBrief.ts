import type { DashboardSnapshot } from '../../shared/domain/snapshot.ts';
import { buildBrief, type Brief } from '../../shared/domain/brief/brief.ts';
import { escapeDiscord, sendDiscord, type DiscordPayload } from '../alerts/discord.ts';
import type { CollectorStore } from '../store/types.ts';

/** First collection at or after this UTC hour sends the day's brief (11:00 UTC ≈ 6 am US Eastern). */
export const DEFAULT_BRIEF_HOUR_UTC = 11;
/** Delivery attempts per day before giving up until tomorrow (each later run retries). */
export const MAX_ATTEMPTS_PER_DAY = 3;
const STATE_KEY = 'dailyBrief';

export interface BriefState {
  lastSentDate: string | null;
  attemptsDate: string | null;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const safeLink = (url?: string) => {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href.replace(/[()\s]/g, encodeURIComponent) : null;
  } catch {
    return null;
  }
};

/** Discord message: one embed per section, within Discord's limits (10 embeds, 6,000 characters). */
export function briefToDiscord(brief: Brief, appUrl?: string): DiscordPayload {
  const day = new Date(`${brief.date}T00:00:00Z`).toUTCString().slice(0, 16);
  const embeds: Record<string, unknown>[] = brief.sections.map((s) => {
    const lines = s.lines.map((l) => {
      const text = clip(escapeDiscord(l.text), 180);
      const url = safeLink(l.url);
      return url ? `• [${text}](${url})` : `• ${text}`;
    });
    if (s.more) lines.push(`• …and ${s.more} more`);
    let description = lines.length ? lines.join('\n') : `_${escapeDiscord(s.empty)}_`;
    if (description.length > 950) description = `${description.slice(0, 940).replace(/\n[^\n]*$/, '')}\n• …`;
    return { title: s.title, description, color: 0x6aff9b };
  });
  embeds[0] = {
    ...embeds[0],
    author: { name: `WATCHTOWER Daily Brief — ${day}` },
  };
  embeds.push({
    description: `${brief.relevantNews} relevant news item(s) in the period. Built from recorded data only; a report is not a confirmed fact.${appUrl ? `\n[Open WATCHTOWER](${appUrl}) · [SITREP](${appUrl}/sitrep)` : ''}`,
    color: 0x4c6b5a,
    footer: { text: `Period ${brief.from.slice(0, 16).replace('T', ' ')} → ${brief.to.slice(0, 16).replace('T', ' ')} UTC` },
  });
  return { username: 'WATCHTOWER', allowed_mentions: { parse: [] }, embeds };
}

/** Plain-text form for logs and dry runs. */
export function briefToText(brief: Brief): string {
  const out = [`WATCHTOWER DAILY BRIEF ${brief.date} (${brief.from} → ${brief.to})`];
  for (const s of brief.sections) {
    out.push(`  ${s.title}`);
    if (!s.lines.length) out.push(`    (${s.empty})`);
    for (const l of s.lines) out.push(`    • ${l.text}`);
    if (s.more) out.push(`    • …and ${s.more} more`);
  }
  return out.join('\n');
}

export interface DailyBriefOptions {
  now: number;
  webhookUrl: string | null;
  appUrl?: string;
  hourUtc?: number;
  /** Send now even if today's brief was already sent (manual test). */
  force?: boolean;
  fetchImpl?: typeof fetch;
  log?: (m: string) => void;
}

export type DailyBriefResult = { sent: true } | { sent: false; reason: string; error?: string };

/** Sends the day's brief once, on the first run at or after the configured hour. */
export async function runDailyBrief(store: CollectorStore, snapshot: DashboardSnapshot, o: DailyBriefOptions): Promise<DailyBriefResult> {
  const log = o.log ?? (() => {});
  if (!o.webhookUrl) return { sent: false, reason: 'no Discord webhook configured' };
  const today = new Date(o.now).toISOString().slice(0, 10);
  const hour = new Date(o.now).getUTCHours();
  const state = (await store.getCollectorState<BriefState>(STATE_KEY)) ?? {
    lastSentDate: null, attemptsDate: null, attempts: 0, lastError: null, updatedAt: '',
  };
  if (!o.force) {
    if (hour < (o.hourUtc ?? DEFAULT_BRIEF_HOUR_UTC)) return { sent: false, reason: `before ${o.hourUtc ?? DEFAULT_BRIEF_HOUR_UTC}:00 UTC` };
    if (state.lastSentDate === today) return { sent: false, reason: 'already sent today' };
    if (state.attemptsDate === today && state.attempts >= MAX_ATTEMPTS_PER_DAY) return { sent: false, reason: `gave up after ${MAX_ATTEMPTS_PER_DAY} failed attempts today` };
  }
  const brief = buildBrief(snapshot, o.now);
  const attempts = state.attemptsDate === today ? state.attempts + 1 : 1;
  try {
    await sendDiscord(o.webhookUrl, briefToDiscord(brief, o.appUrl), { fetchImpl: o.fetchImpl });
    await store.putCollectorState(STATE_KEY, { lastSentDate: today, attemptsDate: today, attempts, lastError: null, updatedAt: new Date(o.now).toISOString() });
    log(`BRIEF sent for ${today}${o.force ? ' (forced)' : ''}`);
    return { sent: true };
  } catch (err) {
    const message = (err as Error).message;
    await store.putCollectorState(STATE_KEY, { ...state, attemptsDate: today, attempts, lastError: message, updatedAt: new Date(o.now).toISOString() });
    log(`BRIEF delivery failed (attempt ${attempts}/${MAX_ATTEMPTS_PER_DAY}): ${message}`);
    return { sent: false, reason: 'delivery failed', error: message };
  }
}
