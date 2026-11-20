# Alerting

**Status: implemented (Phase 4).** Code: [`shared/domain/alerts/`](../shared/domain/alerts/) (rule model, validation, evaluation) and [`collector/alerts/`](../collector/alerts/) (pipeline stage, Discord delivery). UI: **ALERTS** (inbox, rules, builder).

## Levels

| Level | Intended use |
|---|---|
| INFORMATION | A monitored source published a new relevant item |
| ADVISORY | An indicator shows increased or unusual activity |
| WARNING | A significant configured condition has been satisfied |
| CRITICAL | A high-priority event or combination meets a predefined threshold |

These are **WATCHTOWER application classifications, not official government warning levels**. Every Discord message carries that statement in its footer.

## Rules

Rules are declarative JSON stored in Firestore `alertRules`. They can contain no code. Every trigger is **edge-based**: only a *change* can fire it.

| Trigger | Fires when | Dedupe key |
|---|---|---|
| **New event** | A newly collected event matches the condition (the same condition language as the indicators). Only events collected after the rule was created count. | the event's content hash |
| **Indicator** | An indicator **enters** one of the chosen states | indicator + state + time the state began |
| **RAI** | A region's RAI **crosses** the threshold upward | region + threshold + evaluation time |

**First look:** a rule created since the previous evaluation treats the current state as its first crossing. So a new rule fires once if its indicator is already TRIGGERED or its RAI is already above the threshold, and then follows normal edge detection. Because keys are based on when a state began, a first-look alert and a later transition for the same state cannot both fire.

**Validation happens twice.**
- Firestore security rules check the shape: allowed keys, name length, severity, trigger kind, cooldown range, and that the id matches the document path.
- The collector runs the full `validateAlertRule()` check, including the condition. Invalid rules are **skipped and reported**: they appear as *INVALID — NOT EVALUATED* on the Rules tab and on the Diagnostics page.

## Alert lifecycle

1. The collector evaluates rules after the indicator engine, using only this run's changes: newly imported events, indicator transitions, and RAI movement.
2. Each candidate gets a deterministic id, `hash(ruleId, dedupeKey)`. Ids already stored are dropped, and storage uses `create()`. **An unchanged input can never produce a second alert.**
3. Alerts are **written first** with delivery status `pending`, then Discord is notified. A crash can therefore leave an alert pending, but cannot cause a duplicate notification.
4. Delivery outcomes:

   | Status | Meaning |
   |---|---|
   | `sent` | Delivered to Discord |
   | `failed` | Delivery failed; the HTTP status is recorded and the job exits with code 2, so GitHub emails you |
   | `suppressed-cooldown` | Recorded, but not sent because the rule's cooldown is active |
   | `not-requested` | The rule has Discord turned off |
   | `not-configured` | No webhook secret is set |

5. In the inbox you can **acknowledge** or **dismiss** an alert; dismissing also acknowledges it. Security rules allow the browser to change only those four fields. No client can create or delete alerts.

**Cooldown** (per rule, 0–7 days) limits Discord messages only; alerts are always recorded. All of a rule's alerts from one run go out as **one message**, with at most 10 embeds and a "+N more" summary.

## Discord

- Create a webhook in Discord (channel → *Edit channel* → *Integrations* → *Webhooks* → *New webhook* → *Copy webhook URL*). Save it as the GitHub Actions secret `DISCORD_WEBHOOK_URL`. Never put it in the repository.
- Only genuine `https://discord.com/api/webhooks/...` URLs are accepted (including the `ptb.` and `canary.` variants). Anything else disables notifications and is reported.
- The URL is never logged or stored. Delivery errors record only the HTTP status.
- Source text is untrusted. Markdown is escaped, `@` and `<@…>` mentions are neutralized, and `allowed_mentions` is empty, so nothing can ping your server.
- If Discord rate-limits a message (429), it is retried once, honouring `retry_after` up to 10 s.
- To check delivery, run **Actions → Test alert delivery**. It sends one labelled test message and creates no alert records.

## Test mode

**TEST RULE** in the builder runs the rule in your browser on the loaded data:
- **Event rules** list matching events from the last 7 days.
- **Indicator rules** list indicators currently in the chosen states.
- **RAI rules** show the current score against the threshold.

Test mode creates nothing and sends nothing.

## Firestore cost

Per run, alerting costs:
- **Reads:** one listing of rules (≤ 200), one alerting-state document, and a de-duplication check for each candidate alert.
- **Writes:** one per new alert plus a delivery update.

In the browser:
- Each Alerts page visit lists up to 100 alerts.
- The top-bar counter uses a `count()` aggregation, billed as 1 read per 1,000 matching documents.

## Not yet built

- Email or browser push notifications (planned later; see the PDD §10.2).
- Rules combining several triggers. Today, use one rule per trigger, or a single event condition with ALL/ANY logic.
- Editing the indicator catalog from the UI.
