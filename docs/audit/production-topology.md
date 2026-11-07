# Production topology

Audit baseline: `main` @ `0252f6dc57a6f9004e750fd268ffa2d9d2f7bfc4`. Read-only audit. No product code was changed.

## Citation conventions

- `path:Lx-Ly` means exact line numbers. These were taken from files that the connected GitHub tool saved to disk at the baseline SHA: `study.html`, `daily.html`, `index.html`, `aced-arcade.html` and `importer-classic.html`.
- `path` with an anchor such as `` `function name` `` is used for all other files. The connected tool returned their contents inline without line numbers, and `git clone` was blocked in the audit environment. To reproduce any anchor, check out the baseline SHA and run `grep -n '<anchor>' <path>`.
- Confidence: **high** means read directly in code. **Medium** means inferred from code paths without execution. **Low** means the evidence is indirect.

## 1. Hosting and deployment

| Item | Observed fact | Evidence | Confidence |
|---|---|---|---|
| Static host | Vercel builds with `node tools/build.js`, serves `dist/`, and sets `cleanUrls:false`. | `vercel.json` (`buildCommand`, `outputDirectory`) | high |
| Security headers | nosniff, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`, HSTS. | `vercel.json` `headers` | high |
| CSP | The CSP is **`Content-Security-Policy-Report-Only`** and is not enforced. It lists `script-src 'self' 'unsafe-inline'` and `connect-src 'self' https://aced-api.onrender.com`. Pages that load cdnjs scripts or Google Fonts would violate an enforced policy. | `vercel.json` (`Content-Security-Policy-Report-Only`) | high |
| Build output | Copies root `*.html`, `*.css`, non-test `*.js`, `packs/**/*.js|json`, `learn/**` and `vendor/**`, plus icons, manifest, robots, sitemap and security.txt. Fails if a referenced local file is missing. Demo and legacy root pages (`aced-jokers-demo.html`, `importer-classic.html`, `builder.html`) **are published** because every root `.html` is copied. | `tools/build.js` (root loop, `walk("packs"...)`) | high |
| API host | Render blueprint: web service `aced-api` (`rootDir: server`, `npm install --build-from-source`, `node server.js`, `/health`) and Postgres `aced-db` (free plan). The secret values use `sync:false` and are not recorded here. | `render.yaml` | high |
| API enabled in the client | `window.ACED_API_URL` is **set** (not commented out), so sign-in and sync are live on every page that loads `aced-config.js`. | `aced-config.js` (`window.ACED_API_URL =`) | high |
| Preview deployments | Opening a PR produced a `Vercel` commit status "Deployment has completed" (seen on PR #44 head `4ac4885`). Every PR, including audit PRs, triggers a Vercel preview deployment. | GitHub status API on PR #44 | high |
| Static dev server | `serve.json` sets `cleanUrls:false` only. | `serve.json` | high |

## 2. Service worker, manifest and cache

- **Service worker: not found.** No `serviceWorker.register` appears in the pages read. GitHub code search returned no results for this repository because it is not indexed, so I can't rule out other pages. Confidence: medium.
- **Manifest:** `manifest.webmanifest` sets `display: standalone` and `start_url: /`, with an SVG icon only. Its description claims "spaced review baked into the core loop. Free, no signup." Confidence: high.
- **Cache behaviour:** `aced-config.js?v=5` is cache-busted with a query string. Other scripts have no versioning, so stale-asset risk depends on Vercel defaults. The arcade fetches packs with `cache:"no-store"` (`aced-arcade.html:L359`). Confidence: high.

## 3. Public routes and the scripts they load

| Route | Role | Scripts loaded (in order) | Classification |
|---|---|---|---|
| `/index.html` | Landing page, quick-paste handoff | `aced-config.js?v=5`, `aced-core.js`, `aced-account.js`, `aced-progress.js`, `aced-library.js` (`index.html:L535-L539`); Google Fonts; `theme.css` | canonical |
| `/study.html?pack=ID` | Main game engine (canonical) | `aced-library.js`, `aced-bridge.js` (`L871-L872`), inline pack loader (`L873-L990`), `vendor/purify.min.js`, `aced-config.js`, `aced-core.js`, `aced-account.js`, `aced-progress.js`, `aced-vault.js`, `aced-tbs.js`, `aced-fx.js`, `packs/core-jokers.js` (`L1003-L1021`), then `social.js`, `nemesis.js`, `aced-onboarding.js` (`L3298-L3304`) | canonical |
| `/daily.html` | Daily Run | `aced-library.js` (`L163`), `aced-config.js`, `aced-core.js`, `aced-account.js`, `aced-vault.js`, `aced-progress.js`, `aced-fx.js`, `aced-bridge.js` (`L172-L184`), inline loader (`L186-L218`), `social.js` (`L829`) | canonical |
| `/library.html` | Saved packs and built-in runs | `aced-library.js`, `aced-library-page.js` | canonical |
| `/importer.html` | Structured importer | `aced-library.js`, `aced-ui.js`, `aced-importer.js` (all `defer`) | canonical |
| `/importer-classic.html` | "Document importer" for PDF and DOCX | `aced-library.js` (`L277`), large inline scripts (`L278-L961`); **dynamically loads pdf.js and mammoth from cdnjs** (`L619-L636`) | legacy, still linked from `importer.html`, `index.html:L345` and `library.html` |
| `/aced-arcade.html` | Separate, older arcade engine with its own SR model | `aced-config.js`, `aced-core.js`, `aced-pack.js`, `aced-vault.js`, `cpa-far.bossnames.js`, `nemesis.js`, `nemesis-encounter.js`, `aced-pro.js` (`L230-L241`) | legacy/alternate. It is still the "PLAY" target in `pricing.html`, `store.html`, `league.html` and `builder.html`. |
| `/store.html` | Static catalogue (`PACKS` array) | inline only | canonical marketing |
| `/pricing.html` | "ACED is free" | `aced-config.js`, `aced-core.js` | marketing |
| `/league.html` | Weekly leagues | `aced-config.js`, `aced-core.js`, `aced-account.js`, `leagues.js` | canonical; data partly simulated (see the capability matrix) |
| `/builder.html` | Game builder; "Publish" is scaffolding | `aced-pack.js` | demo/scaffold |
| `/aced-jokers-demo.html` | Joker sandbox | not inspected | demo |
| `/cpa.html`, `/usmle.html`, `/mcat.html`, `/nclex.html`, `/lsat.html`, `/bar-exam.html` | Exam hubs | not inspected | marketing hubs |
| `/learn/*.html` (20 FAR pages and an index) | CPA FAR learning pages | not inspected | content |
| `/cheatsheet.html`, `/start.html` | Not inspected | — | unknown |

## 4. Root JavaScript modules

| Module | Classification | Notes |
|---|---|---|
| `aced-core.js` | canonical | store, analytics, calibration, review/SR, streak, backend, sync, retention |
| `aced-library.js`, `aced-bridge.js`, `aced-importer.js`, `aced-ui.js`, `aced-library-page.js` | canonical | pack schema, storage, import, share |
| `aced-account.js`, `aced-config.js` | canonical | live sign-in and sync configuration |
| `aced-progress.js`, `aced-vault.js`, `aced-fx.js`, `aced-onboarding.js`, `aced-tbs.js`, `aced-jokers.js`, `aced-pack.js` | canonical (meta and game feel) | not all fully read |
| `aced-pro.js` | scaffold | Header says it "ships INERT". Loaded only by `aced-arcade.html`. |
| `confidence.js`, `daily.js`, `nemesis.js` | `confidence.js` and `daily.js` are legacy | `aced-core.js` header says it "supersedes the earlier confidence.js / nemesis.js / daily.js drafts". `nemesis.js` is still loaded by `study.html:L3299`. |
| `leagues.js`, `social.js`, `notify.js` | canonical | leagues are simulated without the server endpoint |
| `cpa-far.bossnames.js` | content | loaded by the arcade |
| `tools/_build_f1_batch.js`, `_build_f3_batch.js`, `_fix_tell*.js`, `_integrate_batch07.js` | generated or one-off tooling | not published by `build.js` |

## 5. Dynamic assets and pack loading

| Path | Mechanism | Evidence | Risk | Confidence |
|---|---|---|---|---|
| `study.html` built-in packs | `?pack=` is sanitised to `[a-z0-9-]` and loaded as `<script src="packs/ID.js">`. The pack can then list `scripts` and `questionBanks`, which are loaded sequentially as further `<script>` tags. | `study.html:L878-L879`, `L963-L990` | Pack files run as code. They are repo-owned, but a pack can pull in any script URL it lists. | high |
| `study.html` shared deck | `#g=<base64url JSON>` or `?g=` is decoded with `JSON.parse` into question data. | `study.html:L924-L929` | Untrusted data enters the engine. Output paths use `esc()` and DOMPurify (see trust boundaries). | high |
| `study.html` library pack via hash | If `?pack=ID` is not saved locally and `#pack=<payload>` is present, the payload is normalised and **saved to the library without a prompt** (`L.save(tmp)`). | `study.html:L935-L938` | Silent write to storage from a URL | high |
| `study.html` legacy local | `?pack=local` reads `aced:local:customPack`. | `study.html:L947-L949` | legacy key | high |
| `daily.html` | Same loader: library pack, else `packs/ID.js` plus banks. | `daily.html:L186-L218` | — | high |
| `aced-arcade.html` | `?pack=` containing `/` or ending in `.json` is passed **unchanged to `fetch()`** and can be any origin. | `aced-arcade.html:L332-L338`, `L355-L365` | Third-party content injection (data only) | high |
| `importer-classic.html` | Loads pdf.js 3.11.174 and mammoth 1.6.0 from `cdnjs.cloudflare.com` at runtime **without SRI**. | `importer-classic.html:L619-L636` | Supply chain; contradicts "self-contained" claims | high |
| `aced-library.js` starters | `world-capitals` and `spanish-1k` are loaded as `<script src=packs/*.js>`. | `aced-library.js` (`function load`) | — | high |
| Fonts | Google Fonts CSS from `fonts.googleapis.com` on most pages | e.g. `study.html:L25` | Third-party request on every page view | high |

## 6. Recommendations (separate from the facts above)

1. Decide the canonical play route (`study.html` or `aced-arcade.html`) and record it in an architecture decision. Marketing "PLAY" links currently point to the alternate engine.
2. Exclude demo and legacy pages from `dist/`, or label them, through an explicit allow-list in `build.js`.
3. Move from CSP report-only to enforced only after vendoring pdf.js and mammoth (with SRI) or removing them.
4. Confirm whether Vercel preview deployments on PRs are intended for audit PRs.
