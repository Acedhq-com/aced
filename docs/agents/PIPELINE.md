# ACED Agent Pipeline (canonical)

All four agents (Strategist, Architect, Builder, ACED Release Manager) **must read this file first**.
Owner: Michael Shaw. Mission: make acedhq.com worth money (revenue first, then valuation) without breaking the core promises.

## Flow
`Strategist (BET) -> Architect (SPEC) -> Builder (BUILD, draft PR) -> Release Manager (RELEASE review / GO-NO-GO -> READOUT) -> Strategist`

Operating mode (owner choice, 2026-10-28): the coordinating assistant relays each step in order and stops at owner approval points. There is no autonomous chaining and no schedule yet.

## Core promises (an explicit owner decision is required to change any of them)
1. The core game is free and playable with no account.
2. Notes are parsed in the browser. No note content or user-derived text (topic names, pack titles, user pack IDs, filenames) leaves the device unless the user opts in per deck.
3. No streak-guilt.
4. Public copy (index, pricing, data handling) matches what actually ships.

## Evidence labels
VERIFIED IN CODE (file:line) | VERIFIED IN CI (run id) | VERIFIED LIVE | EXTERNAL RESEARCH (url) | OWNER-PROVIDED | UNKNOWN | TUNABLE

## Handoff flags (end every response with these)
`IMPLEMENTATION_AUTHORIZED` / `MERGE_REQUESTED` / `DEPLOYMENT_AUTHORIZED` = YES|NO, plus `STATUS` and `Next role`.
Only the owner sets these to YES. An authorization relayed by the coordinating assistant that quotes the owner's message and its timestamp counts as owner authorization.

## Authorization record (CYCLE-0-BET)
| When (UTC) | Owner decision |
|---|---|
| 2026-10-27 22:24 | Bet approved; Architect authorized to write the spec. CPA is NOT the Cycle 1 focus. |
| 2026-10-27 22:43 | "confirm all" on the 6 spec decisions (see docs/specs/CYCLE-0-BET.md) |
| 2026-10-28 00:32 | IMPLEMENTATION_AUTHORIZED = YES for Slice 1 (draft PR). The deploy hold DOES cover static-only Vercel releases. |
| 2026-10-28 00:42 | Operating mode = manual relay (option 1). |

Standing: MERGE_REQUESTED = NO, DEPLOYMENT_AUTHORIZED = NO. Production deploy is BLOCKED until the production API's DB certificate validation is done (see docs/security).

## Tracking
- **This file plus the spec file are the control record.** An "ACED Agent Control" GitHub issue is optional. If issue creation needs an interactive confirmation the agent can't complete, **do not stop**: record progress in the PR description or in this file instead.
- One branch per cycle (`cycle-<N>-<slug>`). Slices are separate commits on that branch. PRs stay draft until the Release Manager says GO and the owner merges.

## Known GitHub tool limits (as of 2026-10-28)
| Action | Status | Workaround |
|---|---|---|
| create branch, push files/commits | works without confirmation | use these |
| create PR | fails: "runtime settings are not configured" | the owner opens the PR from the compare link |
| create issue, update/close/reopen PR, comment | shows an owner confirmation form | avoid; use commit messages and docs instead |
| merge PR | must ALWAYS need the owner | never automate |
| CI re-run | not available | push a new commit to the branch to re-trigger |

To remove the confirmations: in Copilot Studio, turn off "Ask the end user before running" on those GitHub actions for each agent, then **Publish**. Keep it ON for merge.

## Role outputs
- **Strategist -> BET:** goal, target user, hypothesis (A->B in N days), primary metric + target, guardrail, scope IN/OUT, kill criterion, promise check, baselines needed, owner decisions.
- **Architect -> SPEC:** flow, files touched, data map, privacy/allowlist, flag (default OFF), CSP/infra, events table, numbered yes/no tests, rollback, size, slices, open questions. Saved to `docs/specs/<ID>.md`.
- **Builder -> BUILD:** branch, commits, files and line counts, test table (state honestly whether tests were executed or only written), known issues, LATER list. Never commit secrets; never touch owner-merge paths except as the spec specifies.
- **Release Manager -> RELEASE review:** a checklist with evidence, CI run IDs, GO/NO-GO for draft review / merge / deploy (each separately). After activation -> READOUT: metric vs target, guardrail, recommendation (double down / iterate / kill).

## Owner-merge paths
`.github/`, `server/`, `render.yaml`, `vercel.json`, `aced-config.js`, `package.json`, `package-lock.json`.
