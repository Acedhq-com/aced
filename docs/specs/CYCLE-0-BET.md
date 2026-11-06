# CYCLE-0-BET: privacy-safe funnel measurement (FINAL SPEC)

Status: approved by the owner ("confirm all", 2026-10-27 22:43 UTC). Baseline: main @ 2728a77.
Implementation: Slice 1 authorized (2026-10-28 00:32 UTC). Merge: NO. Deploy: NO (blocked by the DB-certificate hold, which covers static-only Vercel releases).

## Goal
Measure the visit -> repeat-study funnel across all subjects without collecting personal data, so Cycle 1 can be chosen on real numbers. Bring-Your-Own-Notes (BYO) is the main segment; library (CPA is a sub-segment) and demo-only are the others.
Hypothesis: funnel steps with daily counts go from **1/9 to 9/9** within 7 days of activation. The window is 14 days.

## Owner decisions
1. Per-browser `returned` / `byo_repeat` events may reach Plausible with no IDs and no content. The disclosure must say Plausible turns IP + User-Agent into a daily hash and does not store them raw.
2. The device stores a first-seen UTC date and emitted-day markers (no random ID, no pack ID). The D1/D7 denominator is a first visit to ANY instrumented page.
3. Both demos are instrumented: study.html `?demo=1` (the landing CTA) and the aced-arcade.html `source:"demo"` pack. A confirmed voluntary end counts as demo_finished and run_finished.
4. `email_captured` fires only after `/notify` returns `response.ok === true`. The only verified live form is index.html `capForm` (source `home`).
5. One-line `connect-src https://plausible.io` addition in vercel.json (owner-merge). Kill switch = flag false + static redeploy, measured on a preview at under 10 minutes.
6. Plausible 30-day Business trial, no purchase. Count buckets 1 / 2-5 / 6-20 / 21-100 / 101+. "Too few BYO" = fewer than 50 `deck_compiled` events in 14 days (TUNABLE).

Brand: option C. No paid launch or brand spend until trademark clearance relative to "Aced" (aced.io).
Cycle 1 planning note: Pro at $8.99/mo (TUNABLE). This is not the CPA Pass.

## Design
- `aced-analytics.js`: literal `ACED_ANALYTICS_ENABLED = false`, strict allowlist, direct POST to the Plausible Events API (no Plausible script), fixed origin plus a fixed path table, `credentials:'omit'`, `referrerPolicy:'no-referrer'`, no retry or queue. The existing localStorage events ring is never forwarded.
- Do not load aced-config.js or aced-core.js into importer.html just for analytics.
- New local-only record `aced:analytics:site:v1`: never synced, expires after 14 days.

## Allowlist
| Event | Properties |
|---|---|
| landing_viewed | none |
| demo_started, demo_finished | none |
| deck_compiled | source in {paste,file,doc}; count_bucket in {1,2-5,6-20,21-100,101+} |
| run_started, run_finished | pack_kind in {starter,library,user_pack,demo} |
| returned | dayIndex in {1,7}; segment in {byo,library,demo_only} |
| byo_repeat | days_bucket in {1,2,3+} |
| email_captured | source in {home} |
| library_pack_started | library_id in {world-capitals,spanish-1k,cpa-far,cpa-aud,cpa-reg,cpa-bar} |

## Acceptance tests (yes/no)
1. Flag OFF: 0 Plausible requests, 0 new writes or listeners, 0 new console errors, no behavior change.
2. Outbound boundary: only allowlisted names, values and paths. No content, IDs, query, hash or cookies. Credentials omitted, no referrer.
3. Site-wide state: one first-seen record. D1 and D7 each fire at most once, independent of per-pack retention.
4. State failure (malformed data, full or blocked storage, offline, reload): no learning changes, no fake returns, no replay queue.
5. Both demo paths: exactly one started and one finished event per run.
6. Runs: correct pack_kind. library_pack_started carries only a curated ID.
7. Both importers: exactly one deck_compiled per valid build. Invalid, empty, example, edit and rerender produce none.
8. BYO repeat: correct days_bucket, once per distinct UTC day.
9. Email: only fires on a 2xx response from the home form.
10. Disclosure is accurate and passes accessibility checks. Pricing copy is unchanged.
11. All CI passes, the single CSP host is present, and the preview kill switch takes under 10 minutes.
12. After activation: 9/9 steps covered by day 7, 0 privacy breaks, and the BYO count compared against 50 at day 14. Stop if coverage is under 7/9 or Plausible needs cookies.

## Slices
| # | Scope | Must pass | State |
|---|---|---|---|
| 1 | Boundary: adapter, flag, allowlist, tests, +1 line in validate.yml | 1, 2, 4 + core regression | **committed 2261dc0, PR #48 (draft)**; CI pending |
| 2 | Runs & demos (study.html, aced-arcade.html) | 1, 2, 5, 6 | not started |
| 3 | Importers & return state | 1-4, 7, 8 | not started |
| 4 | Email capture & curated IDs | 1, 2, 6, 9 | not started |
| 5 | Disclosure, CSP line, regression, kill rehearsal | 1-11 | not started |

## Kill criteria
A non-allowlisted payload is seen -> flag OFF the same day. Plausible needs cookies or a banner, or coverage is under 7/9 by day 7 -> stop and go to the owner. Fewer than 50 BYO compiles in 14 days -> Cycle 1 becomes acquisition.
