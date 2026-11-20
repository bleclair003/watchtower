# Deployment & Free-Tier Discipline

**Current state (v0.2.0):** collector, Firestore integration, auth and security rules are built and verified end-to-end against the **local Firebase emulators**. The real Firebase project still needs the operator steps in §2 before live data flows.

## 1. $0 path

| Component | Service / plan | Cost control |
|---|---|---|
| Static SPA | Firebase Hosting, **Spark** | No billing account → cannot be charged; quotas hard-stop |
| Database | Cloud Firestore, **Spark** | Dashboard = **1 read per load** (snapshot doc); auto-refresh every 10 min |
| Auth | Firebase Authentication, **Spark** | Google sign-in, single owner (custom claim) |
| Scheduler + collectors | GitHub Actions | Hourly cron, ~1–2 min per run |
| Basemap | OpenFreeMap | Free, no key |

**Never** upgrade the project to Blaze. On Spark, exceeding a quota disables that service until the daily reset — it never bills. Verify current quotas: <https://firebase.google.com/pricing>, <https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions>.

### Measured & estimated usage

| Resource | Per collector run (measured 2026-11-20) | Per day (24 runs) |
|---|---|---|
| Source items fetched | 2,034 first run; 248 steady (KEV answers 304) | — |
| Firestore writes | first run 75 events + ~10 status/state/run/snapshot docs; steady ≈ 10 + new events | **< 500** |
| Firestore reads (collector) | ≤ ~80 dedupe lookups + ≤ 400 snapshot rebuild + 3 status | **≈ 11,500 worst case** |
| Firestore reads (dashboard) | 1 per load / refresh | ~150 |
| Actions minutes | ~1 min | ~24–36 min |

The snapshot rebuild (re-reading up to 400 recent events each run) dominates reads. It is comfortably inside the Spark daily read allowance today; if more sources push it too high, switch the rebuild to an incremental merge (planned optimization, see ARCHITECTURE.md).

## 2. Connecting the real Firebase project (operator steps)

Do these once. Nothing here requires a credit card.

1. **Firestore** — Firebase console → Build → Firestore Database → *Create database* → **production mode** → choose a region near you (cannot be changed later).
2. **Authentication** — Build → Authentication → Sign-in method → enable **Google**.
3. **Web app config** — Project settings → *Your apps* → add a **Web** app (no Hosting setup needed yet). Copy the config values into `watchtower/.env.local`:
   ```bash
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=<project-id>
   VITE_FIREBASE_APP_ID=...
   ```
   These are public identifiers, not secrets — but `.env.local` is gitignored anyway.
4. **Deploy security rules** (one-time `firebase login` opens your browser):
   ```bash
   npx firebase login
   npx firebase deploy --only firestore:rules,firestore:indexes --project <project-id>
   ```
5. **Collector service account** — Google Cloud console (same project) → IAM & Admin → Service Accounts → *Create* `watchtower-collector` with roles **Cloud Datastore User** and **Firebase Authentication Admin** → Keys → *Add key* → JSON. Treat this file as a password: put it in GitHub (next step), then delete the local copy.
6. **GitHub repository** — create a repository, push this project, then under Settings → Secrets and variables → Actions add:
   | Kind | Name | Value |
   |---|---|---|
   | Variable | `WATCHTOWER_PROJECT_ID` | your project id |
   | Secret | `FIREBASE_SERVICE_ACCOUNT` | the JSON key contents |
   | Secret | `OWNER_EMAIL` | the Google account you will sign in with |
7. **Sign in once** — `npm run dev`, open the app, *Sign in with Google*. You'll see **ACCOUNT NOT AUTHORIZED** — expected.
8. **Grant owner** — Actions → *Grant owner* → Run workflow. Back in the app, click **RECHECK ACCESS**.
9. **First collection** — Actions → *Collect* → Run workflow. Reload the dashboard: the DATA readout shows **LIVE** and sources turn **ONLINE**. From then on it runs hourly.

### Public or private repository?
- **Public:** unlimited Actions minutes; code is visible (no secrets are in it). GitHub disables scheduled workflows after **60 days without repository activity** — Diagnostics will show the collector as OVERDUE if that happens; any commit re-enables it.
- **Private:** free plan includes a monthly minutes allowance; hourly collection uses roughly 750–1,100 min/month.

## 3. Local development modes

| Command | Mode | Needs |
|---|---|---|
| `npm run dev` | demo (no `.env.local`) or live (with it) | — |
| `npm run emulators` | starts Auth + Firestore emulators (UI at :4000) | Java 21 |
| `npm run collect:emulator` | collector → emulator | emulators running |
| `npm run dev:emulator` | app ↔ emulators, with emulator-only test sign-in | emulators running |
| `npm run grant-owner:emulator -- <email>` | grant owner in the emulator | emulators running |
| `npm run collect:dry` | fetch + process real sources, write nothing | — |

Emulator project ids start with `demo-`, which the Firebase tools guarantee can never reach real cloud resources.

## 4. Hosting (Phase 7, can be done any time)

```bash
npm run build
npx firebase deploy --only hosting --project <project-id>
```
Firebase automatically authorizes the `*.web.app` / `*.firebaseapp.com` domains for sign-in.

## 5. Secrets policy

- Firebase **web** config is public by design; security comes from rules + the owner claim.
- The service-account key exists only as the `FIREBASE_SERVICE_ACCOUNT` Actions secret. Prefer migrating to Workload Identity Federation (keyless) later.
- `OWNER_EMAIL` is a secret so it never appears in logs or on public run pages.
- The collector redacts token-like URL parameters from stored error messages.
- `.env*` (except the committed `.env.example` and `.env.emulator`), service-account JSON and emulator exports are gitignored.
