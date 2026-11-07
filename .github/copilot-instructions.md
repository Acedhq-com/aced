# Contributor instructions for ACED

Read `README.md` first. ACED is a no-framework, client-side study-pack game, with one shared engine for every subject.

## Conventions

- Vanilla HTML/CSS/JavaScript; no bundler or runtime dependencies.
- Each module attaches a single `window.ACED*` global. Use `defer` and promise-based content loading.
- Keep packs data-only. The shared engine owns poker hands, jokers, difficulty, currencies and player levels.
- All user/pack-derived HTML must go through `ACEDUI.esc`; prefer `textContent`.
- Browser storage is optional and can fill up. Never promise a persistent save when it failed.
- Pack and question IDs remain stable during edits. A new import or shared copy must not overwrite an existing pack.
- MCQ answers are zero-based indices into `choices`. Cards without choices are explicitly self-rated recall.
- Playing cards may award game XP, never learning progress.

## Validation

The GitHub Actions workflow in `.github/workflows/validate.yml` is the source of truth for the project validation suite. Use the same commands locally before pushing:

```sh
node tools/check.js
node tools/build.js

node tools/validate.js --pack cpa-far
node tools/validate.js --pack cpa-bar
node tools/validate.js --pack world-capitals
node tools/validate.js --pack spanish-1k

node aced-library.test.js
node --test aced-parser.test.js
node --test aced-bridge.test.js
node aced-importer.test.js
node tools/check.test.js
node tools/score.test.js
node engine-neutrality.test.js
node cpa-shared.test.js
node aced-core.test.js
node aced-pack.test.js
node aced-jokers.test.js
node aced-vault.test.js
node nemesis.test.js
node nemesis-encounter.test.js
node aced-pro.test.js
node importer.extract.test.js
node builder.contract.test.js
node --test aced-game-runtime.test.js
node tools/validate-tbs.js
node aced-tbs.test.js
node server/merge.test.js
node server/leaderboard.test.js
node aced-core.test.js
node aced-account.test.js
node server/sync-auth-guards.test.js
cd server && npm test
node server/auth-flow.test.js
node server/db-tls.test.js
node aced-account-session.test.js
```

Do not use stale commands like `node aced-game-rules.test.js`; that file is not part of the current repository contract. Verify browser flows and mobile layouts before pushing. Keep private content and credentials out of the repository and `dist/`.
