# Test and validation baseline

Baseline `0252f6dc`.

## 1. Execution status

**No test, lint, validation or build command was executed by the auditing agent.**

- `git clone` of the repository was blocked by the audit environment, which reported "git network operation is not allowed".
- The connected GitHub tool returns file contents one file at a time, mostly inline, so a faithful full workspace couldn't be built.
- Every command below is therefore marked **blocked: missing capability** for local execution.

## 2. CI evidence (GitHub-executed, not agent-executed)

The connected tool read the check runs on PR #44 (head `4ac4885`, which is the `main` tree plus one documentation file):

| Check | Conclusion | Source |
|---|---|---|
| `validate` (workflow "Validate ACED", 2 runs: push and pull_request) | success | GitHub check runs API, PR #44 |
| `Analyze (javascript-typescript)` (CodeQL) | success | same |
| `Analyze (actions)` (CodeQL) | success | same |
| `CodeQL` | success | same |
| `Vercel` status | "Deployment has completed" (preview) | GitHub status API, PR #44 |

What this shows: every step in `.github/workflows/validate.yml` exited 0 on GitHub's runner for that tree. The job logs were not read, so the individual assertion output is not recorded here. The checks on this audit PR are recorded in the PR report.

CodeQL runs although there is no CodeQL workflow file in `.github/workflows/`. It is presumably GitHub "default setup", which is a repository setting that I didn't inspect.

## 3. Commands discovered

| Command | Where defined | Runs in CI | Local execution |
|---|---|---|---|
| `node tools/check.js` (syntax, JSON, internal links) | `validate.yml`, `README.md` | yes | blocked |
| `node tools/build.js` (dist + reference check) | `validate.yml`, `vercel.json` | yes | blocked |
| `node tools/validate.js --pack cpa-far` / `cpa-bar` / `world-capitals` / `spanish-1k` | `validate.yml` | yes | blocked |
| `node tools/validate.js` (no args) | `README.md` | no | blocked |
| `node aced-library.test.js` | `validate.yml` | yes | blocked |
| `node --test aced-bridge.test.js` | `validate.yml` | yes | blocked |
| `node aced-importer.test.js` | `validate.yml` | yes | blocked |
| `node tools/check.test.js` | `validate.yml` | yes | blocked |
| `node tools/score.test.js` | `validate.yml` | yes | blocked |
| `node engine-neutrality.test.js`, `node cpa-shared.test.js` | `validate.yml` | yes | blocked |
| `node aced-core.test.js`, `aced-pack.test.js`, `aced-jokers.test.js`, `aced-vault.test.js`, `nemesis.test.js`, `nemesis-encounter.test.js`, `aced-pro.test.js`, `importer.extract.test.js`, `builder.contract.test.js` | `validate.yml` | yes | blocked |
| `node tools/validate-tbs.js`, `node aced-tbs.test.js` | `validate.yml` | yes | blocked |
| `node server/merge.test.js`, `node server/leaderboard.test.js` | `validate.yml`; `server/package.json` `test` | yes | blocked |
| `cd server && npm test` | `server/package.json` | no (CI calls the files directly) | blocked |
| `node tools/browser-qa.js` | file present; not in CI | no | blocked; requires a browser, which I didn't inspect |
| `node tools/score-harness.js`, `tools/verify-core-jokers.js`, `tools/dedupe.js`, `tools/js-to-json.js`, `tools/json-to-js.js` | tooling | no | blocked |
| Lint (ESLint or similar) | **not found**; no root `package.json` and no lint config | — | — |
| Dependency audit (`npm audit`) | **not found** in CI | — | — |

## 4. Coverage gaps (observed from file inventory and test files read)

| Area | Test present? | Note |
|---|---|---|
| `aced-core.js` identity and migration, calibration prototype safety | yes (`aced-core.test.js`) | does **not** cover `sync.pull`/`backend.pull` (the pack-param defect G1) |
| `aced-account.js` (token capture, signOut, activate) | **no** | — |
| `server/server.js` routes, auth, webhook | **no** (only `merge.js` and `leaderboard.js` are unit-tested) | — |
| `server/db.js` Postgres path | **no**; the file header says it "should get one live smoke-test" | — |
| `study.html` engine flows (readiness, optional study break, pack loader) | partial (`tools/score.test.js` covers scoring and doctrines) | the readiness-0% defect is not covered |
| `daily.html` determinism | not found | — |
| `leagues.js`, `notify.js`, `social.js`, `aced-progress.js`, `aced-onboarding.js`, `aced-fx.js` | not found | — |
| `importer-classic.html` PDF/DOCX | `importer.extract.test.js` exists (not read) | network-loaded libraries can't be tested offline |
| Browser end-to-end | `tools/browser-qa.js` exists; not in CI | — |

## 5. Recommendations (for the regression-baseline phase, if approved)

1. Add characterization tests before any fix: `sync.pull` request URL, readiness for library packs, daily determinism, and `#token=` capture.
2. Add a server route test harness (supertest, or the node test runner with SQLite in-memory).
3. Record the CI job logs as artifacts for future audits.
