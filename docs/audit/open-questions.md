# Open questions and owner decisions

Baseline `0252f6dc`. Each item needs an explicit owner answer before the related work starts.

## A. Decisions that block fixes (owner approval required by the operating rules)

| # | Decision | Why it matters | Related finding |
|---|---|---|---|
| A1 | Approve a fix to the sync pull (add `?pack=`) and decide whether server-side or client-side repair of already-overwritten pack state is wanted | Touches synchronisation and learning history | `critical-gap-status.md` G1 |
| A2 | Should sign-in and sync stay enabled (`ACED_API_URL` set) while G1 and the session-fixation issue are open? | Production exposure; changing it is a configuration change | G1, G3 |
| A3 | Which keys may be synced? In particular `subscribers` (email addresses), `events` (analytics) and topic-named keys | Privacy claims on `index.html:L486-L490` and `pricing.html` | `state-inventory.md`; capability matrix #12 |
| A4 | Should the privacy, URL-import, prose and "real players" claims be corrected now, or held for an approved content PR? | The operating rules forbid unproven claims | capability matrix conflict table |
| A5 | Canonical engine: `study.html` or `aced-arcade.html`? | Two SR models and two confidence systems; marketing links go to the arcade | `production-topology.md` §3 |
| A6 | Are Pop Quiz questions meant to be optional ("SKIP TO SHOP")? | Learning claims and readiness meaning | `game-learning-map.md` §1 |
| A7 | Readiness for packs without blueprint weights (currently always 0%): approve a uniform-weight fallback? | Gameplay change | `game-learning-map.md` §6 |
| A8 | Keep, vendor (with SRI) or remove the cdnjs pdf.js and mammoth loading? | Dependency and supply-chain change | `trust-boundaries.md` §2 |
| A9 | Billing: confirm it stays disabled until a ledger and revocation exist | Billing boundary | G5 |
| A10 | Enable branch protection, required checks and CODEOWNERS on `main`? | Repository settings are out of the agent's scope | G7 |

## B. Facts the repository can't answer

| # | Question | How to answer |
|---|---|---|
| B1 | Is the production API actually running, and on which Postgres plan (Render free with expiry, Neon, Supabase)? Are there backups? | Owner checks the hosting dashboards. The agent must not access production. |
| B2 | Are any users signed in today, and does the `state` table already hold cross-pack-overwritten data? | Owner-run read-only query; no agent access |
| B3 | Is the CSP report-only policy collecting reports anywhere? (No `report-uri`/`report-to` is configured in `vercel.json`.) | Owner confirms |
| B4 | Is CodeQL "default setup" enabled in settings, and is Dependabot enabled in settings? | Owner checks Settings → Code security |
| B5 | Should PR preview deployments (Vercel) run for audit and documentation PRs? | Owner checks the Vercel project settings |
| B6 | DOMPurify version in `vendor/purify.min.js` | Read the file header (not done in this audit) |
| B7 | Pages not inspected: `cheatsheet.html`, `start.html`, `aced-jokers-demo.html`, exam hubs, `learn/*.html`, `aced-progress.js`, `aced-onboarding.js`, `aced-fx.js`, `aced-tbs.js`, `aced-jokers.js`, `nemesis*.js`, `tools/validate.js` and others | Follow-up read-only pass if wanted |

## C. Audit-method limitations

1. No commands were executed (git clone blocked); see `test-baseline.md`.
2. GitHub code search returned no results for this repository because it is not indexed, so "not found" statements cover the files read, not the whole repository. Those statements carry confidence medium where noted.
3. Line numbers are exact only for the files saved to disk at the baseline SHA. Other citations use grep anchors.
4. No browser execution; runtime behaviour is inferred from code.
