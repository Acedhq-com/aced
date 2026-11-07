# Trust boundaries

Baseline `0252f6dc`. Citation conventions are in `production-topology.md`. Untrusted inputs are: URL query and hash, uploaded files, pasted text, shared links, remote pack JSON, the sync response from the API, and Stripe webhooks.

## 1. HTML sinks (`innerHTML` / `insertAdjacentHTML`)

| Location | Observed fact | Risk | Verification | Confidence |
|---|---|---|---|---|
| `study.html` (27 `innerHTML` uses) | Pack- and user-derived strings pass through `esc()` (`L1107-L1110`, which escapes `& < > " '`). Modals go through `sanitizeModalFragment()` → DOMPurify `RETURN_DOM_FRAGMENT` (`L2655-L2664`). `L966` inserts `packId`, which is sanitised to `[a-z0-9-]` at `L878-L879`. `L2866` `tutBody.innerHTML=s.body` uses in-file constants. | Low, provided every new sink keeps using `esc()`. The comment at `L2651-L2653` ("no string is ever assigned to a live element's innerHTML") applies to modals only. | `grep -n innerHTML study.html` and check each for `esc(` | high |
| `daily.html` (8 uses) | Local `esc()` (`L233`) escapes `& < > " '` | low | same | medium |
| `aced-arcade.html` (7 uses) | Its `esc()` (`L407`) does **not** escape `'`. Safe only inside double-quoted attributes. | low to medium | `grep -n "innerHTML" aced-arcade.html` | medium |
| `importer-classic.html` (6 uses) | `renderPreview` (`L570-L579`) builds `value="..."` with `escq()` (`L551`), which escapes `& " <` but not `'` or `>`. Attributes are double-quoted. | low | view `L551`, `L577` | high |
| `aced-importer.js`, `aced-library-page.js`, `aced-ui.js`, `league.html`, `store.html` | All use local `esc()` before `innerHTML`. `league.html` and `store.html` `esc` omit `'`. | low | `grep -n "innerHTML\|esc(" <file>` | high |
| `insertAdjacentHTML` | Not found in the files read | — | grep | medium |

## 2. Dynamic script loading, eval and Function

| Location | Observed fact | Risk | Confidence |
|---|---|---|---|
| `study.html:L963-L990`, `daily.html:L203-L218` | `<script src="packs/<id>.js">`, then each URL in `ACED_PACK.scripts` / `questionBanks` / `questionBank` | Pack JS is executable, so pack review is a code review. Same-origin only for `packs/<id>.js`; listed bank URLs are unrestricted. | high |
| `aced-library.js` `load` | Starter packs loaded as scripts from a fixed table | low | high |
| `importer-classic.html:L619-L636` | `loadScript()` loads pdf.js and mammoth from cdnjs, **with no `integrity` attribute** | Supply-chain compromise would yield arbitrary JavaScript on the origin, with access to `aced_session` | high |
| `importer-classic.html:L773-L850` | Generates a downloadable `packs/<id>.js` file. `${name}` is interpolated raw into a `/* ... */` comment (`L810`), so a name containing `*/` would inject code into the generated file. | Self-inflicted, but the file is designed to be dropped into `packs/` and executed | high |
| `eval` / `new Function` | Not found in files read. `tools/check.js` uses `vm.Script` for syntax checks only (build time). | — | medium |

## 3. Query-string and hash parsing

| Input | Handling | Evidence | Risk |
|---|---|---|---|
| `?pack=` | Sanitised to `[a-z0-9._-]` (core, account, vault, pro, daily); `study.html` also requires `^[a-z0-9][a-z0-9-]*$` | `aced-core.js` `PACKID`; `study.html:L878-L879` | low |
| `aced-arcade.html ?pack=` | **Not sanitised when it contains `/` or ends in `.json`**; passed to `fetch()` and can be any origin | `aced-arcade.html:L332-L338`, `L355-L365` | Phishing or misinformation decks on the ACED origin; CSP `connect-src` is report-only, so it doesn't block this |
| `#g=` | base64url → `JSON.parse`, inside try/catch | `study.html:L924-L929` | Data only; rendered escaped |
| `#pack=` | `ACEDLibrary.decode` (charset and 200000-character limit, fatal UTF-8) → `normalize` (field limits) | `aced-library.js` `decode`, `normalize`; `study.html:L935-L938` | `study.html` **saves to the library without a prompt**; `importer.html` asks for review (`importShared`) |
| `#token=` | Stored as the session; URL cleaned | `aced-account.js` `captureFragmentToken` | **Login CSRF / session fixation:** any link `https://<site>/#token=<attacker JWT>` signs the victim into the attacker's account. Their local progress is then pushed into the attacker's server state (activate → `sync.push`). |
| `?date=` / `?s=` | Regex-validated | `daily.html:L264`, `L267` | low |

## 4. File parsing

- `aced-importer.js` `readFile` enforces a 5 MB limit and an extension allow-list, and reads with `file.text()`. `aced-library.js` caps input at 2,000,000 characters and 2000 questions, with per-field length limits, and rejects nested objects and prototype-polluting ids (`validId`). Confidence: high.
- `importer-classic.html` `handleFile` (`L639-L649`) allows 20 MB and parses PDF/DOCX with third-party libraries running in the page origin.
- CSV parsing is a custom state machine (`parseDelimited`), and an unclosed quote is reported as an error.

## 5. Network requests

| Caller | Destination | Auth | Data |
|---|---|---|---|
| `aced-core.js` `backend.push/pull` | `ACED_API_URL/sync`, `/state` | Bearer JWT | sync snapshot (see `state-inventory.md`) |
| `aced-account.js` `api()` | `/auth/request`, `/entitlements`, `/billing/checkout`, `/auth/signout-all`, `/leaderboard/opt*` | Bearer | email, handle |
| `leagues.js` `fetchRoom` | `POST/GET /leaderboard/league` (**not implemented server-side**) | Bearer | weekly points |
| `notify.js` | `data-endpoint`, `ACED_CAPTURE_ENDPOINT`, or `ACED_API_URL/notify` | none | email, source |
| `builder.html` `publish` | `ACED_BACKEND_URL + /games` (not implemented; unreachable) | none | pack |
| `aced-arcade.html` | arbitrary `?pack=` URL | none | — |
| `importer-classic.html` | cdnjs (scripts) | — | — |
| All pages | Google Fonts | — | IP address and Referer |

## 6. Authentication and authorisation boundaries (server)

| Finding | Evidence | Risk | Confidence |
|---|---|---|---|
| Every user-data route checks the JWT and `token_version` | `server/server.js` `async function auth` | — | high |
| `pack_id` is client-chosen but sanitised; data is keyed by `(user_id, pack_id)` from the token, so there is no IDOR path | `server/server.js` `packId`, `db.state.get(req.user.sub, pid)` | — | high |
| `POST /sync` accepts **any JSON up to 2 MB** with no schema, key allow-list or size budget per user. The merge trusts the client `updatedAt` (`incomingNewer`). | `server/server.js` `/sync`; `server/merge.js` `mergeState` | Storage abuse; a device with a skewed clock wins last-write-wins | high |
| CORS allows exactly `APP_URL` | `server/server.js` CORS middleware | — | high |
| `/billing/checkout` returns `e.message` to the client | `server/server.js` checkout `catch` | Information leak | high |
| Rate limits are in-memory (single instance) | `server/server.js` rate-limit comment | Resets on restart | high |

## 7. Billing boundary

- Webhook signature is verified with `stripe.webhooks.constructEvent` on the raw body. Grants happen only when `payment_status` is `paid` or `no_payment_required`, and are idempotent per `(user, pack)`. Confidence: high.
- **Not found:** event-id de-duplication ledger, `charge.refunded`/`charge.dispute.*` revocation, a `customer.subscription.*` lifecycle, and reconciliation jobs. `PRICES = {}`, so no checkout can currently start.

## 8. Imported content entering URLs, logs or analytics

| Path | Finding | Confidence |
|---|---|---|
| Share URLs | The pack content itself is base64url in the fragment. Fragments are not sent to the server, but are kept in history, bookmarks and chat logs. | high |
| `#notes=` | Raw notes in the fragment when storage is blocked (`aced-ui.js` `init`) | high |
| Analytics | `module`/`source` (user topic names) in `quiz_answered`, `confidence_bet_placed` and `drill_started` events, which are uploaded through sync | high |
| Server logs | `console.log("[auth] magic link issued for " + email)` runs in **production**. The email console provider (when no Resend key is set) logs the full magic link (`server/email.js` `consoleProvider`). | high |

## 9. Recommendations

1. Bind `#token=` capture to a state/nonce issued by `/auth/request` (stored in sessionStorage), or exchange a one-time code with a POST.
2. Vendor pdf.js and mammoth under `vendor/` with SRI, or drop them.
3. Restrict the arcade `?pack=` to same-origin `packs/` paths.
4. Escape the pack name in generated JS comments (`importer-classic.html:L810`).
5. Validate the `/sync` payload against a key allow-list and per-key size limits; use server time for ordering.
