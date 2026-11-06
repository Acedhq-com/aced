/* server/merge.test.js — zero-dependency tests for the sync merge.
   Run:  node server/merge.test.js   (exit 0 = all pass) */
"use strict";
require("../tools/lib/question-id-integrity-tests")("server");
const { mergeState } = require("./merge");
let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; console.log("FAIL: " + name + "\n  expected " + e + "\n  got      " + a); }
}

// mastery takes the max per module (never regress a learner)
eq(mergeState(
  { updatedAt: 100, data: { mastery: { "F2.M1": 120, "F1.M1": 10 } } },
  { updatedAt: 200, data: { mastery: { "F2.M1": 80, "F3.M5": 64 } } }
).mastery, { "F2.M1": 120, "F1.M1": 10, "F3.M5": 64 }, "mastery max-merge");

// review resolves by the NEWER `last` timestamp; `seen` is only the tiebreak when
// `last` ties. (Neither record here has `last`, so the larger-seen record wins.)
eq(mergeState(
  { updatedAt: 100, data: { review: { "F2.M1:a": { seen: 5, box: 3 } } } },
  { updatedAt: 200, data: { review: { "F2.M1:a": { seen: 2, box: 1 } } } }
).review["F2.M1:a"], { seen: 5, box: 3 }, "review: tie on last -> larger seen");

// review data-loss guard: a RECENT success (newer `last`, fewer `seen`) must NOT be
// overwritten by an OLD failure that happens to have a higher `seen`. Keying on seen
// used to silently destroy the newer box state; keying on last preserves it.
eq(mergeState(
  { updatedAt: 999, data: { review: { "F2.M1:a": { seen: 2, ok: 2, miss: 0, box: 4, last: 2000 } } } }, // recent success
  { updatedAt: 100, data: { review: { "F2.M1:a": { seen: 9, ok: 1, miss: 8, box: 0, last: 1000 } } } }  // old, higher-seen failure
).review["F2.M1:a"], { seen: 2, ok: 2, miss: 0, box: 4, last: 2000 }, "review: newer last beats higher seen");

// bestStreak is monotonic; currentStreak follows the newer side
eq(mergeState(
  { updatedAt: 300, data: { dailyV1: { currentStreak: 9, bestStreak: 12, lastDate: "2026-06-23" } } }, // stored newer
  { updatedAt: 100, data: { dailyV1: { currentStreak: 3, bestStreak: 4,  lastDate: "2026-06-20" } } }  // incoming older
).dailyV1, { currentStreak: 9, bestStreak: 12, lastDate: "2026-06-23", freezes: 0, longestStreak: 12, results: {} }, "daily: newer current + max best");

// last-write-wins for arbitrary keys by updatedAt
eq(mergeState(
  { updatedAt: 100, data: { bestScore: 5000 } },
  { updatedAt: 200, data: { bestScore: 3000 } }
).bestScore, 3000, "LWW: incoming newer wins");
eq(mergeState(
  { updatedAt: 300, data: { bestScore: 5000 } },
  { updatedAt: 200, data: { bestScore: 3000 } }
).bestScore, 5000, "LWW: stored newer wins");

// brand-new user (empty stored) just takes incoming
eq(mergeState(null, { updatedAt: 200, data: { mastery: { "F1.M1": 5 } } }).mastery, { "F1.M1": 5 }, "empty stored");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
