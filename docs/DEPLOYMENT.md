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
| Firestore reads (collector) | ~45 steady (day buckets + status/state docs) + 1 per brand-new item; measured 44–47 on the emulator (v0.9.4) | **≈ 1,500 hourly; ≈ 3,000 every 30 min** |
| Firestore reads (dashboard) | 1 per load / refresh | ~150 |
| Actions minutes | ~1 min | ~24–36 min |

Before v0.9.4 each run re-read every event in the 31-day indicator window (capped at 2,000). With 15 sources that would have passed the Spark limit of 50,000 reads/day at hourly collection within weeks, and the cap would have truncated baselines. Day buckets (ARCHITECTURE.md) replaced that. Each run logs its read count: `Firestore: ~N document reads this run`.

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

### Alert notifications (optional)

1. In Discord: channel → *Edit channel* → *Integrations* → *Webhooks* → *New webhook* → *Copy webhook URL*.
2. Add it as the repository secret `DISCORD_WEBHOOK_URL`. For example, in PowerShell:
   `Get-Clipboard | gh secret set DISCORD_WEBHOOK_URL --repo bleclair003/watchtower`
3. Run **Actions → Test alert delivery** and confirm the test message arrives.
4. Create rules under **ALERTS → RULES**.

Without the secret, alerts are still recorded and shown in the app (delivery `not-configured`).

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

## 4. Hosting (live since Phase 7)

Live at **https://watchtower-b9b2a.web.app**. The page is public, but nothing is readable without the owner sign-in: Firestore rules enforce that, not the UI.

```bash
npm run build                        # needs .env.local (live web config)
npx firebase deploy --only hosting --project watchtower-b9b2a
```
Authenticate with `npx firebase login`, or point `GOOGLE_APPLICATION_CREDENTIALS` at the service-account key kept outside the repo.
Firebase automatically authorizes the `*.web.app` / `*.firebaseapp.com` domains for sign-in.

What `firebase.json` sets:

| Path | Header |
|---|---|
| everything | Content-Security-Policy (self + Google sign-in + Firestore + OpenFreeMap only; no `unsafe-eval`, `object-src 'none'`, `frame-ancestors 'none'`), HSTS, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy, COOP `same-origin-allow-popups` (needed for the Google popup) |
| `/assets/**` | `Cache-Control: immutable`, one year (file names are content-hashed) |
| routes and `index.html` | `Cache-Control: no-cache`, so a deploy takes effect on the next load |

A tab left open across a deploy may request a module chunk that no longer exists. The app reloads once to pick up the new build.

If you add a new external host (a new map style, for example), add it to the CSP. The E2E suite fails on any CSP violation, because `vite preview` serves the same headers.

Hosting stays within the Spark free tier: 10 GB storage and 360 MB/day transfer. A full first load is about 1.1 MB gzipped, and assets are cached for a year.

## 4b. Free-key sources (optional)

| Secret | How to get it | Enables |
|---|---|---|
| `FIRMS_MAP_KEY` | <https://firms.modaps.eosdis.nasa.gov/api/map_key/>: enter your email; the key arrives by email | NASA FIRMS new fire clusters |
| `CLOUDFLARE_RADAR_TOKEN` | Free Cloudflare account → My Profile → API Tokens → Create Token → Custom token → permission **User → User Details → Read** | Cloudflare Radar attributed outages |

Add each one under GitHub → repository → Settings → Secrets and variables → Actions → New repository secret. The next Collect run picks it up. Without it, the source logs `SKIP … not configured`.

## 4c. Reliable hourly trigger (cron-job.org)

GitHub's built-in schedule is best-effort: on 2026-11-21 it skipped five hourly runs in a row. An external scheduler now starts the Collect workflow every 30 minutes (since v0.9.4). GitHub's own cron remains as a 6-hourly fallback at minute 15. The workflow's concurrency group stops overlapping runs.

**1. A GitHub token that can only start this repository's workflows**
- github.com → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
- Name `watchtower-collect-trigger`; expiration up to 1 year (put a reminder in your calendar).
- Repository access: **Only select repositories** → `bleclair003/watchtower`.
- Repository permissions: **Actions → Read and write**. Nothing else. Metadata: Read is added automatically.

**2. The cron job** (cron-job.org, free account)

| Field | Value |
|---|---|
| URL | `https://api.github.com/repos/bleclair003/watchtower/actions/workflows/collect.yml/dispatches` |
| Schedule | Every hour at minutes **0 and 30** (every 30 min) |
| Request method | `POST` (Advanced tab) |
| Headers | `Authorization: Bearer <token>` · `Accept: application/vnd.github+json` · `X-GitHub-Api-Version: 2022-11-28` |
| Request body | `{"ref":"main","inputs":{"trigger":"schedule"}}` |
| Notifications | On failure |

A successful call returns **HTTP 204**, and a Collect run appears in GitHub Actions within a minute, recorded with trigger `schedule`.

**If the token leaks**, the worst anyone can do is start or cancel this repository's workflows (using Actions minutes). Revoke it on GitHub and make a new one.

**Minutes:** the repository is **public** (since 2026-11-21), so Actions minutes are unlimited and a run may take longer than a minute. While it was private, each run had to stay under 60 seconds (billed per started minute against 2,000 free minutes a month).

**Public run logs:** anyone can read the Actions logs. The collector never prints secrets, alert-rule names or watchlist terms (alerts are logged by a short hash), and the grant-owner script prints no uid or email. Keep it that way when adding log lines.

## 5. Secrets policy

- Firebase **web** config is public by design; security comes from rules + the owner claim.
- The service-account key exists only as the `FIREBASE_SERVICE_ACCOUNT` Actions secret. Prefer migrating to Workload Identity Federation (keyless) later.
- `OWNER_EMAIL` is a secret so it never appears in logs or on public run pages.
- The collector redacts token-like URL parameters from stored error messages.
- `.env*` (except the committed `.env.example` and `.env.emulator`), service-account JSON and emulator exports are gitignored.
