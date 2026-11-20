# Security & Accessibility Review (Phase 7)

Reviewed 2026-11-20 against v0.7.0. This is a single-operator tool. The review covers what an attacker could reach and what a keyboard or screen-reader user could use. It is not a formal audit.

## Threat model

| Asset | Who could want it | Protection |
|---|---|---|
| Collected archive, dossiers, alert rules | Anyone who finds the URL | Firestore rules: read only with the `owner: true` custom claim. The claim is set server-side (Admin SDK) and cannot be set by a browser. 11 rules tests, including a spoofed-claim case |
| Collected data integrity | A signed-in browser, including the owner's if the session is hijacked | Browsers cannot write `events`, `sourceStatus`, `snapshots`, `raiHistory` or other collected data. Only the collector's service account can |
| Service-account key | Repo readers, CI logs | Never in the repo: stored outside it locally and as a GitHub Actions secret. `git ls-files` contains no key. The build output was scanned for `private_key` and webhook URLs |
| Discord webhook | CI logs, alert text | Secret only; redacted from collector logs (tested); strict URL regex; mentions disabled |
| Operator's AI analysis | Hostile text in a public feed | Markdown exports neutralise source text (below) |

## Findings and fixes

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | No Content-Security-Policy. Any injected script would run with the owner's Firestore session | Medium | **Fixed.** Strict CSP: scripts only from self and `apis.google.com` (Google sign-in); no `unsafe-eval`; `object-src 'none'`; `frame-ancestors 'none'`; connections only to Firestore, Google auth and OpenFreeMap |
| 2 | SITREP and dossier exports inserted feed titles verbatim into Markdown meant for pasting into Claude. A crafted headline could add headings or pose as operator instructions (prompt injection) | Medium | **Fixed.** `mdInline` collapses newlines, escapes Markdown and HTML, and caps length; `mdUrl` emits only http(s) autolinks; each export states that quoted source text is data, not instructions. Tested |
| 3 | No HSTS, Permissions-Policy or COOP | Low | **Fixed.** COOP is `same-origin-allow-popups`, so the Google popup still works |
| 4 | HTML was cacheable for an hour after a deploy, and code-split chunks from the old build disappear on deploy | Low (availability) | **Fixed.** Routes are served `no-cache`; the app reloads once if a chunk is missing; an error boundary contains module failures |
| 5 | `style-src 'unsafe-inline'` remains | Accepted | MapLibre and React style attributes need it. Style injection cannot run script under this CSP |
| 6 | 13 moderate `npm audit` advisories in `firebase-tools` | Accepted | Dev-only CLI, never shipped. The production audit is clean, and CI fails on high-severity production advisories |

Checked and found clean:
- No `innerHTML`, `dangerouslySetInnerHTML` or `eval`. Map popups use `textContent`.
- Every external link is http(s) only (feed URLs pass through `safeExternalUrl`; registry links are constants) and has `rel="noopener noreferrer"`. This is also asserted in E2E.
- Firebase web config in the bundle is public by design.

## Accessibility

Automated: axe-core WCAG 2.1 A/AA runs on all 10 modules in CI, with no violations. Fixed in this phase:

| Issue | Fix |
|---|---|
| `fg-dim` text at 3.2–3.4:1 contrast, used for labels throughout | Lightened to `#628a73`: 4.6:1 on the lightest surface |
| `inactive` text at 3.8:1 | Lightened to `#74857b`: 4.6:1 |
| Logo link's accessible name did not contain its visible text | Label removed, so the visible text is the name |
| No way to skip the header and navigation | Skip link, visible on focus, moves focus to `<main>` (E2E tested) |
| Feed list removed the focus outline | Visible focus ring on keyboard focus |

Already in place and confirmed by hand:
- A global `:focus-visible` outline.
- `prefers-reduced-motion` disables animation.
- Landmarks: header, navigation and main.
- The command console is an ARIA combobox.
- Status is never shown by colour alone: health lamps carry text labels, and charts have a table view.
- Every module works without the map.

**Known gaps:**
- The map canvas is not accessible. The feed and tables carry the same records.
- No full screen-reader walkthrough has been done.
- The dense 10–11 px type is a deliberate part of the console design. It respects browser zoom, but at default zoom it is small.
