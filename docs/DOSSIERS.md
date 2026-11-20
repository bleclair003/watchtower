# Incident Dossiers

**Status: implemented (Phase 5).** Code: [`shared/domain/incidents/`](../shared/domain/incidents/) (model, validation, timeline, suggestions, Markdown export). UI: **DOSSIERS** (index), `/dossiers/:id` (workspace), and **+ DOSSIER** on expanded feed items.

## Principles

- **Operator-curated.** WATCHTOWER suggests possibly related records, but only you decide what is evidence and how it is assessed. Nothing is linked automatically.
- **Assessment is separate from credibility.** Each linked record keeps its source credibility (e.g. *Official statement*) and also gets your assessment within this incident:

  | Assessment | Meaning |
  |---|---|
  | `confirmed` | You judge the claim established, e.g. by independent corroboration |
  | `unconfirmed` | Reported but not yet established. The default for new evidence |
  | `disputed` | Contradicted by other evidence or by the parties involved |
  | `context` | Background that informs the situation but is not itself a development |

  An official statement establishes that a statement was made, not that its claims are true.
- **Traceable and durable.** Each linked record stores a copy of its title, source, link, credibility, regions and all three timestamps. A dossier therefore stays complete after the record ages out of the dashboard's 31-day window.

## The three clocks (PDD §9.2)

The timeline can be ordered by any of three times:

| Clock | Meaning |
|---|---|
| **Occurred** | When the event reportedly happened |
| **Published** | When the source published it |
| **Collected** | When WATCHTOWER first collected it |

If an item lacks the chosen time, it falls back to the next available one and is flagged `↳`; it is never placed at an invented time. Each entry also shows its reporting lag (occurred → published) and collection lag (published → collected). A large collection lag usually means the item was backfilled on a source's first run.

## Suggestions

`suggestRelated()` is deterministic and explains itself. A record must share a substantive title term or a country with the dossier to be suggested at all. Its score then adds:

- shared title terms, weighted by how much of the two titles overlap;
- shared country, region and category;
- closeness in time (within 3 days) to existing evidence.

Generic words and feed boilerplate are ignored. For example, the travel-advisory label "Level 4: Do Not Travel" would otherwise link every Level 4 country. This filter was added after verification showed exactly that.

Suggestions come only from records currently loaded on the dashboard.

## Saving and concurrency

You edit a draft, and **SAVE** writes the whole dossier. The UI warns before you leave with unsaved changes.

Security rules require every update to carry `version = stored version + 1` and an unchanged `createdAt`. If you save from a stale copy (another tab or device saved first), the save is rejected and the UI asks you to reload. Newer work is never silently overwritten.

Rules also enforce the shape and size limits:

| Field | Limit |
|---|---|
| Title | ≤ 120 characters |
| Summary | ≤ 4,000 characters |
| Evidence | ≤ 200 records |
| Notes | ≤ 100 |
| Linked dossiers | ≤ 20, and no self-link |
| Indicators | ≤ 30 |

`validateIncident()` runs the full validation in the browser before every save.

## Export

**COPY AS MARKDOWN** produces an evidence packet you can paste into Claude, as in PDD §12.2 "Export Intelligence Context". It contains:

- status, regions and dates;
- analytical caveats;
- your summary;
- the timeline, with every record's source link, credibility, three timestamps, your assessment and note;
- your analyst notes;
- attached indicators.

Records that are not live collections are labelled as such. The packet contains nothing that isn't in the dossier.

## Not yet built

- Automatic clustering of new events into existing dossiers. Today the app suggests and you decide.
- Edit history and an audit trail per dossier. Today there is only a version counter.
- Dossiers in demo mode. They need Firestore.
