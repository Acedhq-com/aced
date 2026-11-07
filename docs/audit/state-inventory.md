# State and data inventory

Baseline `0252f6dc`. Citation conventions are in `production-topology.md`. "Sync-eligible" means the key is listed in `aced-core.js` `SYNC_KEYS` and is uploaded by `ACEDCore.sync.push()` when the user is signed in. This happens in production because `ACED_API_URL` is set.

## 1. Namespacing model (observed)

- Per-pack keys use the form `aced:<packId>:<key>`. `<packId>` comes from `?pack=`, sanitised to `[a-z0-9._-]`. Implementations: `aced-core.js` (`NS`), `study.html:L1279-L1300` (`ACED_STORE`, which uses `PACK.id`), `daily.html` `STORE`, `aced-vault.js`, `aced-pro.js`.
- There are **two independent namespace sources**. `aced-core.js` uses the URL `?pack=`, defaulting to `world-capitals`. `study.html` `ACED_STORE` uses `PACK.id`, defaulting to `default`. For `#g=` shared decks, `PACK.id` is `local`, while `aced-core` uses `?pack=` or `world-capitals`. This can split one run's state across two namespaces. Confidence: medium. Verify by opening `study.html#g=<payload>` with no `?pack=` and listing localStorage keys.
- Global (un-namespaced) keys: `aced:packs:v1`, `aced:activity:v1`, `aced:draft:v1`, `aced:pack-migration:v1`, `aced_session`, `aced_leaderboard`, `aced_boot_notes`, `aced:local:customPack`.

## 2. localStorage

| Key | Owner module | Schema / versioning | Sensitive fields | Migration | Corruption behaviour | Deletion | Sync-eligible |
|---|---|---|---|---|---|---|---|
| `aced:packs:v1` | `aced-library.js` | `{version:1, packs:[{version:1,id,name,subject,description,questions[],createdAt,updatedAt}]}` | **User study content** | `migrate()` imports legacy `aced:local:customPack` once (`aced:pack-migration:v1`) | `read()` returns the fallback on JSON error; `registry()` resets to empty if `packs` is not an array, and the **next save overwrites the corrupted value** | `remove(id)` per pack | **No** |
| `aced:activity:v1` | `aced-library.js` | `{packId: lastPlayedMs}` | none | — | fallback `{}` | `remove(id)` deletes the entry | No |
| `aced:draft:v1` | `aced-library.js` | `{text,name,subject}` | **Raw pasted notes** | — | fallback `null` | Overwritten; never cleared on save | No |
| `aced:<id>:learning_v1` | `aced-library.js` / `aced-bridge.js` `recorder` | `{attempts,correct,selfRated,answers:{qid:{attempts,correct,strength,lastCorrect,lastAt,selfRated}}}` | qids may be user-authored | Reset per question when the answer changes (`save()`) | `learning()` normalises | `remove(id)` (prefix scan) | **Yes** |
| `aced:<id>:review` | `aced-core.js` `review` | `{qKey:{seen,miss,ok,box,last,lastReviewedAt,intervalDays,dueAt,lapses,src}}`; keys are `q.id` or legacy `source:hash` | `src` = topic text | `migrateIds()` legacy → canonical (`reviewCanonicalIdsV1`) | `store.get` fallback `{}` | prefix scan on pack delete | **Yes** |
| `aced:<id>:calib` | `aced-core.js` `calibration` | `{samples[≤400]:{b,c,ok,m,t}, byModule:{topic:{n,sum,correct}}}` | topic text | — | fallback | prefix scan | **Yes** |
| `aced:<id>:mastery` | `study.html:L1302-L1308` | `{moduleKey: points}`; % = points×2, capped at 100 | topic text as keys | — | fallback `{}` | prefix scan | **Yes** |
| `aced:<id>:events` | `aced-core.js` `analytics` | ring buffer ≤200 `{e,t,p}`; props scrubbed (`scrubProps`) | module names; email/token redaction is best effort | — | fallback `[]` | prefix scan | **Yes** |
| `aced:<id>:dailyV1` | `daily.html:L337-L344` | `{currentStreak,bestStreak,lastDate,freezes,results:{date:{score,correct,total,glyphs,calib,timeSec,bonus}},freezeUsedFor}` | none | — | fallback | prefix scan | **Yes** |
| `aced:<id>:subscribers` | `notify.js` | `[{email,source,t}]` | **Email addresses** | — | fallback `[]` | never cleared | **Yes** |
| `aced:<id>:vault` | `aced-vault.js` | `{v:1,bal,earned,spent,tiers,unlocks,lastWinDay}` | none | `normalize()` | normalised | `reset()` | **Yes** |
| `aced:<id>:unlocked`, `bestScore`, `bestAnte`, `nemesis*`, `progress`, `objectives`, `runStats_v1`, `muted`, `unlocks` | engine and meta modules | various | none known | — | fallback | prefix scan | **Yes** |
| `aced:<id>:missedEver`, `streak`, `lastDailyDate`, `seenAuditTeach`, `retention`, `lastSyncPush`, `lastSyncApplied`, `aced_league_v1`, `pro` | engine, `aced-core.js`, `leagues.js`, `aced-pro.js` | various | none known | — | fallback | prefix scan | No |
| `aced_session` | `aced-account.js` | **JWT (60-day expiry)** | **Bearer credential** | — | dropped on HTTP 401 | `signOut()` | No |
| `aced_leaderboard` | `social.js` | top 10 `{score,section,ante,streak,bossesDefeated,date}` | none | — | fallback `[]` | never | No |
| `aced:local:customPack` | `importer-classic.html:L669`, `study.html:L948`, `aced-arcade.html` | `{title,exam,questions}` | **User content** | migrated by `aced-library.js` | try/catch | not cleared after migration | No |
| `aced_boot_notes` | `index.html` hero → `importer-classic.html:L961` | raw text | **User notes** | — | — | removed after use | No |

## 3. Other client state

| Store | Finding | Evidence | Confidence |
|---|---|---|---|
| sessionStorage | Not found in files read | reads of the core modules | medium |
| IndexedDB | Not found in files read | — | medium |
| Cookies | Not set by client code read; the server uses Bearer tokens, not cookies | `server/server.js` `auth` | high |
| Cache Storage / service worker | Not found | — | medium |
| URL state | `?pack`, `?difficulty`, `?relic`, `?daily`, `?date=YYYY-MM-DD`, `?s=` (challenge score), `?edit`, `?boot`, `?paid`, `?upgrade`, `?study`; `#g=` (deck), `#pack=` (library payload), `#notes=` (raw notes), `#token=` (session JWT, removed by `history.replaceState`) | `study.html:L924-L938`, `daily.html:L261-L267`, `aced-account.js` `captureFragmentToken`, `aced-ui.js` `init` | high |
| In-memory fallbacks | Each store keeps a `mem` map when storage throws; data is lost on navigation | `aced-core.js` `rd/wr`, `aced-library.js` `read/write` | high |

## 4. Server-side stores (`server/db.js`)

| Table | Columns | Sensitive | Versioning / migration | Deletion |
|---|---|---|---|---|
| `users` | `id, email UNIQUE, created_at, token_version, handle` | **email** | additive `ALTER TABLE ... IF NOT EXISTS` at boot | **none** |
| `magic` | `token PK, email, expires` | **plaintext single-use token** (15-minute expiry) | — | deleted on use; hourly GC |
| `state` | `user_id, pack_id, updated_at, json TEXT` | **all sync-eligible keys above, including subscriber emails** | none; the blob is schemaless | **none** |
| `entitlements` | `user_id, pack_id, granted_at` | — | — | **none** (no refund revocation) |
| `leaderboard` | `user_id, pack_id, handle, best_streak, readiness, mock_best, updated_at` | handle (opt-in) | — | opt-out nulls the handle; the row stays |
| `subscribers` | `email PK, source, created_at` | **email** | — | **none** (no unsubscribe route) |

- Postgres TLS uses `ssl: { rejectUnauthorized: false }` unless `PGSSL=off` (`server/db.js` `makePg`), so the server certificate is not verified. Confidence: high.
- Backups: there is no backup configuration in the repository. The Render free Postgres plan is described in `render.yaml` comments as expiring after about 30 days. Confidence: high (repository) and low (actual hosting state, which wasn't inspected).

## 5. Authentication tokens

- **Session JWT:** HS256 via `jsonwebtoken` defaults, `{sub,email,tv}`, `expiresIn:"60d"`. It is stored in localStorage `aced_session`, so any script running on the origin can read it. The Render blueprint generates the secret; the server fails closed in production if the secret is weak (`server/server.js`, top-level guard).
- **Magic link:** `GET /auth/verify?token=` is single-use. GET links can be consumed by email security scanners that prefetch links.

## 6. Analytics queues

- **Local only:** `aced-core.js` `analytics.track` writes `events`. A live sink runs only if `window.ACED_ANALYTICS_SINK` is defined, and no definition was found in the files read. Events are also printed with `console.debug`.
- Events are **uploaded as part of sync** (`events` is in `SYNC_KEYS`). No other transmission was found.

## 7. Recommendations

1. Remove `subscribers` and `events` from `SYNC_KEYS`, or document why they are there. Never store raw email in a synced blob.
2. Add per-key schema versions and a corruption quarantine (copy the bad value aside) before resetting `aced:packs:v1`.
3. Add a user-facing "export all my data" and "delete all my data" action, both local and server-side.
4. Clear `aced:draft:v1` and `aced:local:customPack` after a successful save or migration.
