# Critical-gap status

Baseline `0252f6dc`. Severity: **S1** means user data loss or a security exposure in production. **S2** means a material correctness or trust issue. **S3** means hygiene. Facts come first; recommendations are in the last column.

## G1. Sync pulls the wrong pack's state (S1)

| Field | Detail |
|---|---|
| Observed | `aced-core.js` `backend.pull` requests `_be.endpoint + "/state"` with **no `pack` query**. `server/server.js` `packId(req)` returns `req.query.pack || req.body.pack || "world-capitals"`, and a GET body is empty, so the server returns **world-capitals** state. `sync.pull` then writes every returned key into the **current** pack's namespace (`store.set(keys[i], …)`), guarded only by `remote.updatedAt <= lastSyncApplied`, and `lastSyncApplied` is stored per pack. |
| Reachability | Production. `ACED_API_URL` is set (`aced-config.js`). `aced-account.js` `activate()` runs push then pull on page load for signed-in users. `study.html:L3273` and `daily.html:L824` also call `sync.pull()`. |
| Impact | A signed-in user with world-capitals history who opens any other pack (CPA FAR, a library pack and so on) has that pack's local `mastery`, `review`, `calib`, `dailyV1`, `learning_v1`, `vault` and other keys **overwritten** with world-capitals data. This conflicts with the requirement to preserve learning history and CPA FAR content. |
| Verification | (a) Static: `grep -n '"/state"' aced-core.js` and `grep -n 'function packId' server/server.js`. (b) Unit: load `aced-core.js` with `location.search="?pack=cpa-far"`, stub `fetch` to record the URL, call `ACEDCore.backend.configure({endpoint:"x",token:"t"}); ACEDCore.sync.pull()`, and assert that the URL contains `pack=cpa-far`. This fails today. |
| Confidence | high (static); runtime impact not reproduced |
| Recommendation | Owner decision required (this touches synchronisation): send `?pack=` on pull, add a characterization test first, and consider a one-time server-side repair. |

## G2. Synchronisation conflict handling (S2)

- Server merge (`server/merge.js`): `mastery` takes the max, `review` takes the newer `last`, `dailyV1` takes the newer side for current-day fields, and **everything else is last-write-wins by the client-supplied `updatedAt`**. Client clock skew decides conflicts. Confidence: high.
- Client pull **does not merge**. It overwrites local keys wholesale with the server copy (`aced-core.js` `sync.pull`). The push-then-pull order in `activate()` mitigates this only for the first load. Mid-session pulls (`study.html:L3273`) can discard local writes made after the last push.
- No tombstones: a per-pack local delete (`aced-library.js` `remove`) is not propagated, so the server keeps the state indefinitely.
- No schema or version check on the sync blob (`v:1` is sent but never validated).

## G3. Authentication and server authorisation (S2)

| Item | Status | Evidence |
|---|---|---|
| JWT verification and revocation (`token_version`) | implemented | `server/server.js` `auth` |
| Fail-closed JWT secret in production | implemented | `server/server.js` top-level guard |
| Rate limits (IP, auth, per-email, notify) | implemented (in-memory) | `server/server.js` |
| **Session fixation through `#token=`** | open | `aced-account.js` `captureFragmentToken` accepts any token in any link |
| Magic link consumed by GET | open | link scanners can burn single-use tokens |
| 60-day bearer token in localStorage | design risk | `aced-account.js` `TOKEN_KEY` |
| Account deletion, email change, data export | **not found** | `server/server.js` route list |
| Postgres TLS certificate verification | **disabled** (`rejectUnauthorized:false`) | `server/db.js` `makePg` |
| Plaintext magic tokens at rest | open | `server/db.js` `magic` table |

## G4. Backup and recovery (S1 for user data once accounts exist)

- **Not found** in the repository: backups, point-in-time recovery, export jobs or restore runbooks.
- `render.yaml` provisions **Render free Postgres**, which its own comment says "expires after ~30 days". The live hosting plan was not inspected and needs owner confirmation.
- Client side: per-pack JSON export of content only. Learning history can't be exported.

## G5. Billing ledger and webhook reconciliation (S3 today, S1 if billing is enabled)

- `PRICES = {}`, so checkout is inert (`server/server.js`). `ACED_MONETIZATION.enabled:false` (`aced-config.js`).
- The webhook only grants. **Not found:** an event-id ledger, refund and dispute revocation, subscription lifecycle, reconciliation against Stripe, or audit records of grants. `entitlements` has no source event id.
- `/billing/checkout` would return Stripe `e.message` to the client.
- Recommendation: do not enable billing until a ledger and revocation exist (owner approval is required in any case).

## G6. Operational logging and monitoring (S2)

- Logging is `console.*` only. **Email addresses are logged in production** on every magic-link request (`server/server.js` `/auth/request`). Without a Resend key, full magic links are logged (`server/email.js` `consoleProvider`).
- `/health` reports `stripe`, `db` kind (includes the SQLite path) and email provider name, without authentication.
- **Not found:** structured logs, request ids, error tracking, uptime monitoring, alerting, or a client error reporter.
- Client analytics are local-only plus the synced `events` blob. There is no live sink.

## G7. Repository governance (S2)

| Item | Observed | Evidence |
|---|---|---|
| Branch protection on `main` | `"protected": false` | `list_branches` result |
| CODEOWNERS | not found | `.github/` listing: `copilot-instructions.md`, `workflows/` |
| Required checks | can't be enforced without protection | — |
| Stale branches | 11 non-main branches, including `alert-autofix-12`, 2 Dependabot branches and several feature branches | `list_branches` |
| Preview deployments | Vercel deploys every PR (PR #44 status) | GitHub status API |
| License | `README.md` "All Rights Reserved"; GitHub reports `NOASSERTION` | repository metadata |

## G8. Dependency and workflow supply-chain controls (S2)

| Item | Observed | Evidence |
|---|---|---|
| Workflow token | `permissions: contents: read` | `validate.yml` |
| Action pinning | tag-pinned (`actions/checkout@v4`, `actions/setup-node@v4`), not SHA-pinned | `validate.yml` |
| Dependabot config | `.github/dependabot.yml` **not found**, although Dependabot branches exist (so it is probably enabled in repository settings) | `.github/` listing; branch list |
| Server install in deploy | `npm install --build-from-source`, not `npm ci`, so the lockfile is not strictly enforced | `render.yaml` |
| Server dependency ranges | caret ranges (`express ^4.22.3`, `stripe ^16.0.0`, …); lockfile present | `server/package.json`, `server/package-lock.json` |
| CI dependency audit | not found | `validate.yml` |
| Runtime third-party scripts | pdf.js and mammoth from cdnjs without SRI | `importer-classic.html:L619-L622` |
| Vendored library | `vendor/purify.min.js` (version not recorded in the files read) | `study.html:L1003` |
| CodeQL | runs (default setup, inferred) | PR #44 checks |

## Owner decisions needed

These are listed in `open-questions.md`. No fixes were attempted in this phase.
