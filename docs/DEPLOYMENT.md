# Deployment & Free-Tier Discipline

**Current state:** runs locally only (`npm run dev`). Nothing is deployed.

## $0 path

| Component | Service / plan | Cost control |
|---|---|---|
| Static SPA | Firebase Hosting, **Spark** | No billing account attached, so it cannot be charged; quotas hard-stop |
| Database | Cloud Firestore, **Spark** | Same. Dashboard reads one snapshot doc; archive queries are paginated |
| Auth | Firebase Authentication, **Spark** | Single owner account |
| Scheduler + collectors | GitHub Actions | Hourly cron; ~1–2 min per run |
| Basemap | OpenFreeMap | Free, no key |
| Alerts (Phase 4) | Discord webhook | Free |

**Never** upgrade the Firebase project to Blaze. Spark has no billing account, which makes overage charges impossible. On Spark, exceeding a quota disables that service until the daily reset.

Check the current quotas on the official pricing pages before deploying: <https://firebase.google.com/pricing> and <https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions>.

### Estimated usage (single operator, Phase 4 steady state)

| Resource | Estimate / day | Note |
|---|---|---|
| Collector writes | 24 runs × (≤ 50 new events + ~15 status/snapshot docs) ≈ **< 1,600** | Duplicate items are skipped before writing |
| Dashboard reads | ~3 reads per load × 50 loads ≈ **150** | Snapshot pattern |
| Archive reads | paginated 50 / page × 40 pages ≈ **2,000** | Heavy research day |
| Actions minutes | 24 × ~1.5 min ≈ **36 min** | Private repo: ~1,100 min/month, within the free allowance |

## Phase 2 setup checklist (operator actions)

1. Create a Firebase project in the console. Leave it on Spark and do **not** add billing.
2. Enable Firestore (production mode) and Authentication (Google or email provider).
3. Register a Web app, copy its config into `.env.local` (see `.env.example`).
4. Create a service account with the *Cloud Datastore User* role, or set up Workload Identity Federation for GitHub.
5. Add GitHub Actions secrets: `FIREBASE_SERVICE_ACCOUNT` (or WIF settings) and later `DISCORD_WEBHOOK_URL`.
6. Set `OWNER_UID` in `firestore.rules` after the first sign-in.
7. `npx firebase-tools deploy --only firestore:rules,firestore:indexes,hosting`. The Firebase CLI is free; run it via `npx`, no global install needed.

## Secrets policy

- The Firebase **web** config is public by design; security comes from rules.
- Service-account credentials and webhooks live **only** in GitHub Actions secrets.
- `.env*.local` is gitignored. Never commit keys, and never log secret values in Actions.
