# ACED repository audit: summary

- **Repository:** `storyshaw2-hue/aced`
- **Baseline:** `main` @ `0252f6dc57a6f9004e750fd268ffa2d9d2f7bfc4` ("Make the engine subject-neutral; CPA flavor now lives in the CPA packs (#43)")
- **Branch:** `audit/repository-baseline`
- **Phase:** REPOSITORY AUDIT (read-only; documentation under `docs/audit/` only)
- **Date:** 2026-10-25

## Documents

| File | Contents |
|---|---|
| `production-topology.md` | Hosting, routes, scripts per page, file classification, pack loading |
| `capability-truth-matrix.md` | 19 capabilities classified, plus a claim/implementation conflict table |
| `state-inventory.md` | Every storage key, server table, token and URL state |
| `trust-boundaries.md` | HTML sinks, script loading, URL and hash parsing, network, auth and billing boundaries |
| `game-learning-map.md` | Run lifecycle, scoring, confidence, review scheduling, daily derivation |
| `test-baseline.md` | Commands discovered, CI evidence, execution status |
| `critical-gap-status.md` | G1–G8 with severity |
| `open-questions.md` | Owner decisions and unknowns |

## Top findings

Facts only. Details and evidence are in the linked documents.

| # | Sev | Finding | Doc | Confidence |
|---|---|---|---|---|
| 1 | S1 | **Sync pull ignores the pack.** `GET /state` is sent without `?pack=`, and the server defaults to `world-capitals`. The client writes that state into the current pack, overwriting learning history for signed-in users. Sync is enabled in production. | `critical-gap-status.md` G1 | high (static) |
| 2 | S1 | **Session fixation.** Any `#token=` link is accepted as the user's session, and local progress is then pushed to that account. | `trust-boundaries.md` §3 | high |
| 3 | S2 | **Privacy copy overstates.** Synced keys include subscriber **email addresses**, analytics events and user-authored topic names. The copy says "only... XP, streaks, deck IDs — never your note contents" and "progress stay on your device". | capability matrix #12 | high |
| 4 | S2 | **URL import is advertised but not implemented.** Prose-to-questions is claimed but rejected by the canonical importer. PDF/DOCX exist only on the legacy importer and load pdf.js and mammoth from cdnjs **without SRI**. | capability matrix #3–#6 | high |
| 5 | S2 | **Readiness is always 0%** for library, imported and shared packs (`blueprintWeights:{}`). The Mock Test gate is unreachable for them. | `game-learning-map.md` §6 | high |
| 6 | S2 | **Questions are optional.** "SKIP TO SHOP" follows every blind, and mastery also rises from playing cards without answering. This conflicts with "every round ends in a real question". | `game-learning-map.md` §1, §6 | high |
| 7 | S2 | **Leagues labelled "Live league — real players"** when signed in, but the server has no league endpoint, so opponents are simulated bots. | capability matrix conflict table | high |
| 8 | S2 | **No account or data deletion, no learning-history export, no backups in the repository.** Render free Postgres is described as expiring after about 30 days. | G3, G4 | high (repo) |
| 9 | S2 | **Governance.** `main` unprotected; no CODEOWNERS; actions tag-pinned; CSP report-only; every PR triggers a Vercel preview deployment. | G7, G8 | high |
| 10 | S3 | **Billing inert.** `PRICES={}`; the webhook has no ledger or revocation. | G5 | high |

## What is verified as working (static reading)

- Structured `Term: definition`, `Q:/A:`, CSV/TSV and JSON import with validation and limits (`aced-library.js`).
- Local-first storage with an in-memory fallback, per-pack namespacing, per-pack export of content and per-pack delete.
- Deck sharing through URL fragments.
- Leitner review queue (REVIEW button), Brier calibration, and confidence betting with HIGH-miss penalties.
- Seeded daily selection.
- Server auth with JWT revocation and rate limits, and a Stripe webhook signature check.
- CI `validate` and CodeQL succeeded on GitHub for the `main` tree (PR #44 head).

## What was not done

- **No commands or tests were executed by the agent.** `git clone` was blocked; see `test-baseline.md`.
- No browser or runtime verification. No production, hosting or database access.
- Several modules and pages were not read (`open-questions.md` B7).
- **No product code, tests, dependencies, workflows, configuration or settings were modified.** This branch adds only files under `docs/audit/`.

## Recommendations

Not authorised in this phase. Suggested order for later phases, subject to owner approval:

1. **Regression baseline:** characterization tests for G1 (pull URL), the readiness fallback, `#token=` capture and daily determinism.
2. **Approved fixes:** G1 (sync pull pack param), then session fixation.
3. **Claim corrections:** privacy copy, URL import, leagues label, "every round" wording.
4. **Data rights:** export-all, delete-all (local and server), and removing PII from the sync blob.
5. **Governance:** branch protection, required checks, CODEOWNERS, SHA-pinned actions, a Dependabot config file, and vendored PDF/DOCX libraries with SRI.
