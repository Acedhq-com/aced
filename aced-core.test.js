/* Canonical question-ID identity + review migration tests (Copilot part 2, item 8). Run: node aced-core.test.js */
"use strict";
var assert = require("assert");
var _mem = {};
global.localStorage = { getItem: function (k) { return k in _mem ? _mem[k] : null; }, setItem: function (k, v) { _mem[k] = String(v); }, removeItem: function (k) { delete _mem[k]; } };
global.window = {};
require("./aced-core.js");
var C = window.window && window.window.ACEDCore ? window.window.ACEDCore : window.ACEDCore;

// 1. canonical id wins over stem hash
assert.strictEqual(C.qKey({ id: "cpa-far-f1m1-abc12345", source: "F1.M1", q: "Original wording" }), "cpa-far-f1m1-abc12345");
// 2. editing the stem does NOT change identity
assert.strictEqual(C.qKey({ id: "x1", source: "F1.M1", q: "Original wording" }), C.qKey({ id: "x1", source: "F1.M1", q: "Improved wording" }));
// 3. legacy questions (no id) still work via the fallback
var lq = { source: "F1.M1", q: "Legacy question" };
assert.strictEqual(C.qKey(lq), C.legacyQKey(lq));
// 4. migration moves an old stem-hash record onto the canonical id, preserving history
var q = { id: "cpa-far-f1m1-abc12345", source: "F1.M1", q: "Legacy question" };
var oldKey = C.legacyQKey(q);
C.store.set("review", (function () { var o = {}; o[oldKey] = { seen: 4, miss: 2, ok: 2, box: 1, last: 1000, src: "F1.M1" }; return o; })());
var res = C.review.migrateIds([q]);
var rv = C.store.get("review", {});
assert.strictEqual(res.migrated, 1);
assert.strictEqual(rv[oldKey], undefined);
assert.strictEqual(rv[q.id].seen, 4);
assert.strictEqual(rv[q.id].miss, 2);
// 5. migration is idempotent (won't double-run) but may run for another pack later
var second = C.review.migrateIds([q]);
assert.strictEqual(second.migrated, 0);
assert.strictEqual(second.reason, "complete");
// A global migration flag must not block a second pack's legacy history.
var q2 = { id: "cpa-aud-a1-new-id", source: "AUD.A1", q: "Second pack legacy question" };
var oldKey2 = C.legacyQKey(q2);
var all = C.store.get("review", {});
all[oldKey2] = { seen: 2, miss: 1, ok: 1, box: 1, last: 2000, src: "AUD.A1" };
C.store.set("review", all);
var third = C.review.migrateIds([q2]);
assert.strictEqual(third.migrated, 1);
assert.ok(C.store.get("review", {})[q2.id], "second pack record migrated");
// 6. record() now keys by canonical id
_mem["review"] = "{}";
_mem["reviewCanonicalIdsV1"] = "";  delete _mem["reviewCanonicalIdsV1"];
C.review.record({ id: "cpa-reg-r1-deadbeef", source: "R1", q: "whatever" }, true);
assert.ok(C.store.get("review", {})["cpa-reg-r1-deadbeef"], "record keyed by id");
console.log("aced-core.test.js: all 7 canonical-ID tests passed");

// Topic labels are authored data, including names inherited by ordinary objects.
C.calibration.record({ confidence: "HIGH", correct: true, source: "__proto__" });
C.calibration.record({ confidence: "MED", correct: false, source: "constructor" });
assert.ok(Object.prototype.hasOwnProperty.call(C.store.get("calib", {}).byModule, "__proto__"));
assert.strictEqual({}.n, undefined, "authored topic names must not mutate Object.prototype");
assert.ok(Number.isFinite(C.calibration.summary().accuracy));
console.log("aced-core.test.js: authored-topic prototype safety passed");

// ---- C04/C05: actual core API, isolated storage, deterministic clock, no network ----
(function reviewScheduleTests() {
  var fs = require("fs"), vm = require("vm");
  var source = fs.readFileSync(__dirname + "/aced-core.js", "utf8");
  var NOW = 1800000000000, DAY = 864e5;
  function environment(pack, sharedDisk) {
    var disk = sharedDisk || Object.create(null), now = NOW;
    class ClockDate extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    }
    var context = {
      window: { localStorage: {
        getItem: function (key) { return Object.prototype.hasOwnProperty.call(disk, key) ? disk[key] : null; },
        setItem: function (key, value) { disk[key] = String(value); },
        removeItem: function (key) { delete disk[key]; }
      } },
      location: { search: "?pack=" + pack }, URLSearchParams: URLSearchParams,
      Date: ClockDate,
      fetch: function () { throw new Error("Network is forbidden in review tests"); }
    };
    vm.runInNewContext(source, context, { filename: "aced-core.js" });
    return { core: context.window.ACEDCore, disk: disk, pack: pack,
      time: function (value) { now = value; } };
  }
  function plain(value) { return JSON.parse(JSON.stringify(value)); }
  function question(id) { return { id: id, source: "Topic", q: "Fixture " + id }; }
  function record(extra) { return Object.assign({ seen: 3, miss: 0, ok: 3, box: 3, last: NOW - DAY, src: "Topic" }, extra); }
  function ids(core, bank, limit) { return Array.from(core.review.queue(bank, limit), function (q) { return q.id; }); }
  var env = environment("schedule-fixture"), core = env.core, due = NOW + 100;
  var mature = question("mature"), recovered = question("recovered"), weak = question("weak"), untouched = question("untouched");
  var records = {
    mature: record({ dueAt: due, intervalDays: 7, lastReviewedAt: NOW - DAY }),
    recovered: record({ miss: 1, ok: 2, box: 2, dueAt: due }),
    weak: record({ miss: 3, ok: 0, box: 0, dueAt: due })
  };
  core.store.set("review", records);
  var before = env.disk["aced:schedule-fixture:review"], bank = [mature, recovered, weak, untouched];
  env.time(due - 1);
  assert.deepStrictEqual(ids(core, bank, 10), [], "future weak and nonweak cards do not return early");
  assert.strictEqual(core.review.count(), 0);
  assert.strictEqual(core.review.isWeak(weak), true);
  assert.strictEqual(core.review.isWeak(mature), false);
  assert.strictEqual(core.review.isWeak(recovered), false, "due eligibility does not redefine recovered cards as weak");
  [due, due + 1].forEach(function (time) {
    env.time(time);
    assert.deepStrictEqual(ids(core, bank, 10), ["weak", "recovered", "mature"], "at/after due uses unchanged rank arithmetic");
    assert.strictEqual(core.review.count(), 3, "queue/count share the same eligibility predicate");
    assert.deepStrictEqual(ids(core, bank, 1), ["weak"], "existing queue limit remains effective");
  });
  assert.strictEqual(env.disk["aced:schedule-fixture:review"], before, "visiting queue/count never rewrites records");
  console.log("aced-core.test.js: C04 scheduled mature/recovered/weak boundaries, rank and limits passed");

  env = environment("legacy-fixture"); core = env.core;
  records = {
    missingWeak: record({ miss: 3, ok: 0, box: 0 }),
    zeroWeak: record({ miss: 3, ok: 0, box: 0, dueAt: 0 }),
    missingStrong: record(),
    zeroStrong: record({ dueAt: 0 })
  };
  var malformed = [null, -1, "1", "", false, true, {}, []];
  malformed.forEach(function (value, i) { records["bad" + i] = record({ miss: 3, ok: 0, box: 0, dueAt: value }); });
  core.store.set("review", records);
  bank = Object.keys(records).map(question).concat([untouched]);
  before = env.disk["aced:legacy-fixture:review"];
  assert.deepStrictEqual(ids(core, bank, 30).sort(), ["missingWeak", "zeroWeak"]);
  assert.strictEqual(core.review.count(), 2, "missing/zero schedules keep conservative weakness-only legacy behavior");
  assert.strictEqual(env.disk["aced:legacy-fixture:review"], before, "invalid schedules remain untouched");
  // JSON cannot represent NaN/Infinity; exercise the same public API with these
  // in-memory values rather than accidentally testing JSON's conversion to null.
  var realGet = core.store.get;
  [NaN, Infinity, -Infinity].forEach(function (value) {
    core.store.get = function (key, fallback) {
      return key === "review" ? { invalid: record({ miss: 3, ok: 0, box: 0, dueAt: value }) } : realGet(key, fallback);
    };
    assert.deepStrictEqual(ids(core, [question("invalid")], 10), []);
    assert.strictEqual(core.review.count(), 0, "nonfinite schedules are excluded without coercion");
  });
  core.store.get = realGet;
  console.log("aced-core.test.js: C04 legacy, malformed/nonfinite and untouched-record cases passed");

  env = environment("record-fixture"); core = env.core;
  var answered = question("answered");
  [1, 3, 7, 14, 30, 30].forEach(function (days, i) {
    env.time(NOW + i);
    core.review.record(answered, true);
    var saved = plain(core.store.get("review", {})[answered.id]);
    assert.deepStrictEqual(saved, { seen: i + 1, miss: 0, ok: i + 1, box: Math.min(5, i + 1),
      last: NOW + i, src: "Topic", lastReviewedAt: NOW + i, intervalDays: days, dueAt: NOW + i + days * DAY });
  });
  env.time(NOW + 10); core.review.record(answered, false);
  var missed = plain(core.store.get("review", {})[answered.id]);
  assert.deepStrictEqual(missed, { seen: 7, miss: 1, ok: 6, box: 0, last: NOW + 10,
    src: "Topic", lastReviewedAt: NOW + 10, intervalDays: 0, dueAt: NOW + 10 + 6e5, lapses: 1 });
  env.time(missed.dueAt - 1); assert.strictEqual(core.review.count(), 0);
  env.time(missed.dueAt); assert.deepStrictEqual(ids(core, [answered], 10), ["answered"]);
  core.review.record(answered, false);
  assert.strictEqual(core.store.get("review", {})[answered.id].lapses, 2, "real misses still increment lapses once");
  console.log("aced-core.test.js: C04 existing recording/cadence/counters and ten-minute miss delay passed");

  function collision(name, canonical, legacy, expected) {
    var disk = Object.create(null), a = environment("migration-a", disk), b = environment("migration-b", disk);
    var q = question("stable-" + name), alias = a.core.legacyQKey(q);
    var unrelated = record({ dueAt: NOW + 9000, intervalDays: 3, lapses: 8 });
    var values = { unrelated: unrelated }; values[q.id] = canonical; values[alias] = legacy;
    a.core.store.set("review", values);
    b.core.store.set("review", { other: record({ dueAt: NOW + 7000 }) });
    var otherBytes = disk["aced:migration-b:review"];
    var result = a.core.review.migrateIds([q]), migrated = plain(a.core.store.get("review", {}));
    assert.strictEqual(result.migrated, 1, name);
    assert.deepStrictEqual(migrated[q.id], expected, name + ": complete collision result");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(migrated, alias), false, name + ": legacy alias deleted");
    assert.deepStrictEqual(migrated.unrelated, unrelated, name + ": unrelated record preserved");
    assert.strictEqual(disk["aced:migration-b:review"], otherBytes, name + ": other pack untouched");
    var migratedBytes = disk["aced:migration-a:review"];
    assert.strictEqual(a.core.review.migrateIds([q]).migrated, 0, name + ": repeated migration is idempotent");
    assert.strictEqual(disk["aced:migration-a:review"], migratedBytes, name + ": history not duplicated on second migration");
    return { core: a.core, q: q };
  }
  var canonical = record({ seen: 9, miss: 5, ok: 4, box: 9, last: 200, src: "Canonical",
    dueAt: NOW + 9000, intervalDays: 14, lastReviewedAt: 190, lapses: 2 });
  var legacy = record({ seen: 7, miss: 6, ok: 1, box: -2, last: 100, src: "Legacy",
    dueAt: NOW + 1000, intervalDays: 1, lastReviewedAt: 90, lapses: 6 });
  collision("canonical-newer", canonical, legacy, { seen: 9, miss: 6, ok: 4, box: 5, last: 200, src: "Canonical",
    dueAt: NOW + 9000, intervalDays: 14, lastReviewedAt: 190, lapses: 6 });
  collision("legacy-newer", Object.assign({}, canonical, { last: 100 }), Object.assign({}, legacy, { last: 300 }),
    { seen: 9, miss: 6, ok: 4, box: 0, last: 300, src: "Legacy",
      dueAt: NOW + 1000, intervalDays: 1, lastReviewedAt: 90, lapses: 6 });
  collision("canonical-tie", canonical, Object.assign({}, legacy, { last: 200 }),
    { seen: 9, miss: 6, ok: 4, box: 5, last: 200, src: "Canonical",
      dueAt: NOW + 9000, intervalDays: 14, lastReviewedAt: 190, lapses: 6 });
  var historical = record({ seen: 10, miss: 7, ok: 3, box: 1, last: 500, src: null });
  [undefined, 0].forEach(function (dueAt, i) {
    var winner = Object.assign({}, historical);
    if (dueAt !== undefined) winner.dueAt = dueAt;
    collision("legacy-fallback-" + i, winner, legacy, { seen: 10, miss: 7, ok: 3, box: 1, last: 500, src: "Legacy",
      dueAt: NOW + 1000, intervalDays: 1, lastReviewedAt: 90, lapses: 6 });
    collision("canonical-fallback-" + i, Object.assign({}, legacy, { src: "Canonical" }), winner,
      { seen: 10, miss: 7, ok: 3, box: 1, last: 500, src: "Canonical",
        dueAt: NOW + 1000, intervalDays: 1, lastReviewedAt: 90, lapses: 6 });
  });
  malformed.forEach(function (value, i) {
    var invalidWinner = Object.assign({}, historical, { dueAt: value, intervalDays: 4, lastReviewedAt: 499, lapses: -1 });
    var migrated = collision("invalid-winner-" + i, invalidWinner, legacy,
      { seen: 10, miss: 7, ok: 3, box: 1, last: 500, src: "Legacy",
        dueAt: value, intervalDays: 4, lastReviewedAt: 499, lapses: 6 });
    assert.strictEqual(migrated.core.review.count(), 0, "malformed winner must not fall back into immediately-due legacy eligibility");
    assert.deepStrictEqual(ids(migrated.core, [migrated.q], 10), []);
  });
  collision("partial-valid-winner", Object.assign({}, historical, { dueAt: NOW + 5000 }), legacy,
    { seen: 10, miss: 7, ok: 3, box: 1, last: 500, src: "Legacy", dueAt: NOW + 5000, lapses: 6 });
  collision("both-historical", Object.assign({}, historical, { lapses: "9" }), record({ last: 100, lapses: -1 }),
    { seen: 10, miss: 7, ok: 3, box: 1, last: 500, src: "Topic" });
  collision("no-invalid-bundle-fallback", historical, Object.assign({}, legacy, { intervalDays: "1", lapses: 0 }),
    { seen: 10, miss: 7, ok: 3, box: 1, last: 500, src: "Legacy", lapses: 0 });
  ["intervalDays", "lastReviewedAt"].forEach(function (key) {
    [null, -1, "1", false, {}, []].forEach(function (value, i) {
      var badBundle = Object.assign({}, legacy); badBundle[key] = value;
      collision("invalid-fallback-" + key + "-" + i, historical, badBundle,
        { seen: 10, miss: 7, ok: 3, box: 1, last: 500, src: "Legacy", lapses: 6 });
      var winningBundle = Object.assign({}, canonical); winningBundle[key] = value;
      var expected = { seen: 9, miss: 6, ok: 4, box: 5, last: 200, src: "Canonical",
        dueAt: NOW + 9000, intervalDays: 14, lastReviewedAt: 190, lapses: 6 };
      expected[key] = value;
      collision("invalid-winner-" + key + "-" + i, winningBundle, legacy, expected);
    });
  });
  collision("fallback-without-optional-fields", historical, record({ last: 100, dueAt: NOW + 8000 }),
    { seen: 10, miss: 7, ok: 3, box: 1, last: 500, src: "Topic", dueAt: NOW + 8000 });
  collision("zero-optional-fields", historical, Object.assign({}, legacy, { intervalDays: 0, lastReviewedAt: 0 }),
    { seen: 10, miss: 7, ok: 3, box: 1, last: 500, src: "Legacy",
      dueAt: NOW + 1000, intervalDays: 0, lastReviewedAt: 0, lapses: 6 });
  collision("invalid-canonical-tie", Object.assign({}, canonical, { dueAt: "0" }), Object.assign({}, legacy, { last: 200 }),
    { seen: 9, miss: 6, ok: 4, box: 5, last: 200, src: "Canonical",
      dueAt: "0", intervalDays: 14, lastReviewedAt: 190, lapses: 6 });
  collision("only-canonical-valid-lapses", Object.assign({}, canonical, { lapses: 8 }), Object.assign({}, legacy, { lapses: "99" }),
    { seen: 9, miss: 6, ok: 4, box: 5, last: 200, src: "Canonical",
      dueAt: NOW + 9000, intervalDays: 14, lastReviewedAt: 190, lapses: 8 });
  collision("zero-lapses", Object.assign({}, canonical, { lapses: 0 }), Object.assign({}, legacy, { lapses: -1 }),
    { seen: 9, miss: 6, ok: 4, box: 5, last: 200, src: "Canonical",
      dueAt: NOW + 9000, intervalDays: 14, lastReviewedAt: 190, lapses: 0 });
  // A plain alias move keeps all original fields; only collisions merge histories.
  var simple = environment("simple-migration"), simpleQ = question("stable-simple"), simpleValues = {};
  simpleValues[simple.core.legacyQKey(simpleQ)] = canonical;
  simple.core.store.set("review", simpleValues);
  simple.core.review.migrateIds([simpleQ]);
  assert.deepStrictEqual(plain(simple.core.store.get("review", {})[simpleQ.id]), canonical);
  console.log("aced-core.test.js: C05 migration ordering/ties/coherent fallback/invalid schedules/lapses/pack isolation/idempotency passed");
})();

// ---- Cross-pack sync containment (audit G1) ----
// A signed-in pull must ask the server for THIS page's pack and must never apply another
// pack's state into this pack's local namespace. Runs a fresh core instance with ?pack=cpa-far.
(function crossPackSyncTests() {
  var path = require.resolve("./aced-core.js");
  var prevCore = window.ACEDCore;
  delete require.cache[path];
  global.location = { search: "?pack=cpa-far", hash: "", pathname: "/study.html" };
  require("./aced-core.js");
  var P = window.ACEDCore;
  window.ACEDCore = prevCore;
  delete global.location;
  delete require.cache[path];

  var calls = [], reply = null;
  global.fetch = function (url, init) {
    calls.push({ url: String(url), init: init || {} });
    return Promise.resolve({ json: function () { return Promise.resolve(reply); } });
  };
  P.backend.configure({ endpoint: "https://api.example.test", token: "t" });
  P.store.set("mastery", { "F1.M1": 7 });

  function done(name) { console.log("aced-core.test.js: " + name); }
  Promise.resolve()
    .then(function () {
      reply = { v: 1, pack: "cpa-far", updatedAt: 0, data: {} };
      return P.sync.pull().then(function () {
        var u = calls[calls.length - 1].url;
        assert.ok(/\/state\?pack=cpa-far$/.test(u), "pull must request this page's pack");
        done("pull requests ?pack= for the current pack");
      });
    })
    .then(function () {
      return P.sync.push().then(function () {
        var c = calls[calls.length - 1];
        assert.ok(/\/sync\?pack=cpa-far$/.test(c.url), "push must name this page's pack");
        assert.strictEqual(JSON.parse(c.init.body).pack, "cpa-far");
        done("push names the current pack");
      });
    })
    .then(function () {
      reply = { v: 1, pack: "world-capitals", updatedAt: 9000, data: { mastery: { "Europe": 99 } } };
      return P.sync.pull().then(function (r) {
        assert.strictEqual(r.applied, false, "another pack's state must not be applied");
        assert.strictEqual(r.reason, "pack-mismatch");
        assert.deepStrictEqual(P.store.get("mastery", null), { "F1.M1": 7 }, "local progress preserved");
        done("pull rejects another pack's state and preserves local progress");
      });
    })
    .then(function () {
      reply = { v: 1, updatedAt: 9001, data: { mastery: { "Europe": 99 } } };
      return P.sync.pull().then(function (r) {
        assert.strictEqual(r.applied, false, "state without a pack id must not be applied");
        assert.deepStrictEqual(P.store.get("mastery", null), { "F1.M1": 7 });
        done("pull rejects state that does not name a pack");
      });
    })
    .then(function () {
      var fresh = Date.now() + 60000;   // newer than the lastSyncApplied recorded by the first pull
      reply = { v: 1, pack: "cpa-far", updatedAt: fresh, data: { mastery: { "F1.M1": 9 }, lastSyncApplied: 0, unknownKey: 1 } };
      return P.sync.pull().then(function (r) {
        assert.strictEqual(r.applied, true, "same-pack state still applies");
        assert.deepStrictEqual(P.store.get("mastery", null), { "F1.M1": 9 });
        assert.strictEqual(P.store.get("lastSyncApplied", 0), fresh, "bookkeeping keys are not overwritten by remote data");
        assert.strictEqual(P.store.get("unknownKey", null), null, "only synced keys are written");
        done("same-pack pull still applies, limited to synced keys");
      });
    })
    .catch(function (e) { console.error("FAIL: " + (e && e.message)); process.exit(1); });
})();
