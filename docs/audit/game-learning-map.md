# Game and learning model map

Baseline `0252f6dc`. This covers the canonical engine `study.html`, plus `daily.html` and `aced-core.js`. `aced-arcade.html` is a separate engine with a different model and is noted only where it differs. Line references are exact for `study.html` and `daily.html`.

## 1. Run lifecycle and state transitions (`study.html`)

```
load pack (L877-L990) -> _packReady (L1103; runs review.migrateIds L1104)
  -> start -> startBlind (L2180: shuffle masterDeck, draw)
  -> [play hand L1471 | discard L1582]*  (hands 4+bonus, discards 3+bonus per blind, L2165)
       score >= target -> blindClear (L1578 -> L1584)
       hands == 0     -> lose (L1579 -> L2463)
  -> blindClear: cash = base[3,4,5][blind] + unused hands + interest (min(5+bonus, money/5)) (L1592-L1593)
  -> offerStudyBreak (L1602)  ** OPTIONAL **: TAKE -> auditMoment (L1690) | SKIP -> openCashout
  -> openCashout -> shop -> nextBlind (L2161): blind 0->1->2, then ante+1
       blind 2 = boss (audit boss or random BOSSES modifier, L2168-L2175)
  -> final: ante >= MAXANTE (pack.maxAnte or 4, L1200) && blind 2 -> win; endless past MAXANTE (targetFor x1.6/ante, L2480-L2486)
  -> endRunSummary (L2488) / lose (L2463): ACEDProgress run_filed, ACEDVault run_end
```

- Targets for library, imported and shared packs come from `buildDeckFromQuestions` (`L913`): ante 1 is `[150,275,450]` through ante 4 `[9000,13000,20000]`, scaled by stakes (casual 0.75, brutal 1.35; `aced-bridge.js` `STAKES`). Confidence: high.
- **Questions are optional.** After every cleared blind the player may choose "SKIP TO SHOP" (`L1608-L1613`). A full run can be won without answering a question. This conflicts with "every round ends in a real question" (`README.md`, "The game") and "every hand becomes a real question" (`index.html:L17`). Confidence: high.

## 2. Score calculation

- `baseChips` = sum of non-weakness card values + hand chips + hand-level chips, minus boss penalties (`L1481-L1487`).
- `ctx.mult` = hand mult + hand-level mult. Jokers mutate `chips`, `mult` and `_x` through `addChips`, `addMult` and `xMult` (`L1513-L1516`). Treatments rescale a joker's delta by a random factor (`L1529-L1534`; `marked` and `restated` use `Math.random`, `L1151`, `L1155`).
- `total = round(chips * mult)` (`L1556`); the `falsestart` boss halves the first hand (`L1557`). `G.score += total` (`L1565`).
- Verification: `node tools/score.test.js` and `tools/score-harness.js` (not executed in this audit). Confidence: high (code read); whether `_x` is folded into `mult` before `L1556` is medium.

## 3. Confidence timing and effect (Pop Quiz)

- The bet is placed **before** submitting. `submitAudit` refuses to run until both `selected` and `confidence` are set (`L1746`).
- `CONF` mult is LOW 1, MED 1.5, HIGH 2.5 (`L1627`).
- **Correct:** cash = bounty × (HIGH 1.5 / MED 1.2 / LOW 1); mastery += round(5 × mult); Conviction +3 (HIGH) or +2, capped at 12; Insight +3/+2/+1; shop 1 cheaper (`L1762-L1771`).
- **Incorrect:** mastery **+1**; the question is added to `missedThisRun` and `missedEver`. **HIGH miss:** a Weakness card (0 chips) is added to the deck and the shop costs 1 more. LOW/MED miss: no penalty (`L1781-L1787`).
- Calibration: Brier score per answer with p = .50/.75/.95 (`aced-core.js` `calibration.record`); display = (1 − mean Brier) × 100.
- The arcade differs: HUNCH/CONFIDENT/CERTAIN ×1/×2/×3, and a CERTAIN miss costs 1 of 3 integrity (`aced-arcade.html:L394-L399`).

## 4. Raw learning-history storage

Each answer writes up to five places (`L1752-L1756`):

1. `calib.samples` (capped at 400)
2. `review[qKey]`
3. `learning_v1.answers[qid]` (library packs only, through `aced-bridge.js` `recorder`)
4. `events` (capped at 200)
5. `mastery` (module points)

There is **no append-only answer log**. Caps and overwrite-in-place mean raw history is lossy. See `state-inventory.md` for schemas.

## 5. Review scheduling and due-queue ordering (`aced-core.js` `review`)

- Box 0–5. Correct → box+1 and `dueAt = now + [0,1,3,7,14,30][box]` days. Miss → box 0 and `dueAt = now + 10 min`.
- "Due" = weak (`miss > ok` or (`miss > 0` and `box <= 1`)) **and** `dueAt <= now`. A card that is not weak is never queued, even when its `dueAt` has passed.
- Queue rank = `miss*10 − box + (5 − min(5,ok)) + min(20, overdueDays)`, sorted descending, top `n` (default 10). Used by REVIEW (`study.html:L3014`) and the drill weak-set (`L3028`).
- **Pop Quiz selection ignores the due queue.** It chooses the Nemesis module or the weakest-mastery module (ties: insertion order), then `Math.random` within the module (`L1618-L1626`, `L1649`). Charged-topic picker: `L1690-L1700`.

## 6. Mastery and readiness

- `masteryPct(k) = min(100, round(points × 2))` (`L1307`). Points also accrue **+1 per scored card** of that module (`L1571`), so poker play alone raises "mastery" without any question being answered.
- `readinessPct` weights blueprint areas (`L2537-L2545`). For library, imported and shared packs, `blueprintWeights:{}` (`L920`) is truthy, so `W={}` and readiness is **always 0%**. The "MOCK TEST (60%)" gate is therefore unreachable for those packs. Confidence: high. Verify by playing a library pack and checking that `#rPct` stays at "0%".

## 7. Pack validation and selection

- Library packs: `aced-library.js` `normalize` (2–8 unique choices, answer index in range, id rules, 2000-question cap) → `aced-bridge.js` `toEngineQuestions` (recall cards get up to 3 distractors from other answers, same topic first, seeded by `hash(id+q)`; "None of the above" if no other answers).
- Engine re-validation: `buildDeckFromQuestions` drops rows without 2+ choices or with a non-numeric answer (`L885-L895`).
- Built-in packs: `tools/validate.js --pack <id>` in CI (`.github/workflows/validate.yml`).
- Selection order: `#g=` → saved library pack → `#pack=` payload (saved automatically) → `?pack=local` → `packs/<id>.js` (`L924-L990`).

## 8. Randomness and seeding

| Use | Source | Seeded? |
|---|---|---|
| Deck shuffle, shop, treatments, finishes, vouchers, Pop Quiz pick, drill pick | `Math.random` (`L1346`, `L1879-L1881`, `L1960`, `L1625`, `L2575`) | **No**; runs are not reproducible |
| Recall distractors | `aced-bridge.js` `rng(hash(id+q))` | Yes (stable per question) |
| Daily Run selection | `mulberry32(hashStr(date+"|"+PACK.id))` (`daily.html:L281`) | Yes |
| League bots | `leagues.js` `rngFrom(hash(week+tier))` | Yes |

## 9. Daily-challenge derivation (`daily.html`)

- Local-calendar date key (`L254`); `?date=` override (`L264`). `NUM_Q = min(7, bank)`. Buckets by `source`, sorted, seeded shuffle of modules and of each bucket, round-robin pick (`L279-L300`).
- Results are stored per date in `dailyV1.results`. Streak: a 1-day gap uses a freeze; a longer gap resets. One freeze is earned every 7-day multiple (`L336`, `L345-L363`, `L562`).
- Limits: players in different time zones can be on different dates. Library packs have per-user ids, so their daily is not shared. Any bank edit changes the selection (the comment at `L285-L288` overstates this).

## 10. Behaviour after incorrect answers and high-confidence misses

| Event | Effect | Evidence |
|---|---|---|
| Any miss (Pop Quiz) | review box 0, due in 10 minutes; mastery +1; `missedEver`; combo reset; Nemesis may gain HP | `aced-core.js` `review.record`; `study.html:L1781-L1795` |
| HIGH miss | Weakness card added to the deck permanently for the run; shop +1 | `study.html:L1785` |
| Later correct answer on a `missedEver` question | "REDEEMED" callout; cleared from `missedEver` | `L1767` |
| Library pack | `learning_v1.answers[qid].strength` reset to 0 | `aced-bridge.js` `recorder` |
| Signed in | `ACEDCore.sync.push()` after **every** answer (one network call per answer) | `L1801` |

## 11. Recommendations

1. Decide whether questions are mandatory, then align copy or code.
2. Let the Pop Quiz draw from `review.queue` when due items exist.
3. Fix readiness for packs without blueprint weights (fall back to a uniform weighting by topic).
4. Add a seeded RNG option for reproducible runs and tests.
5. Separate "mastery from play" from "mastery from answers"; only answers should count as learning evidence.
