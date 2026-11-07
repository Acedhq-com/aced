"use strict";
// Synthetic API regressions. Never print compared fixture values on failure.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict");
const ROOT = process.env.ACED_QID_SOURCE_ROOT || path.resolve(__dirname, "../..");
const T = 1800000000000;
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
let cases = 0;
let activeEnvironments = [];
function check(value) { if (!value) throw new Error("integrity assertion failed"); }
function eq(a, b) { try { assert.deepStrictEqual(a, b); } catch (_) { throw new Error("integrity structure mismatch"); } }
function plain(v) { return JSON.parse(JSON.stringify(v)); }
function test(name, fn) {
  activeEnvironments = [];
  try {
    fn();
    for (const e of activeEnvironments) {
      eq(e.prototypeSignature(), e.prototypeBefore);
      eq(e.prototypeDescriptors(), e.descriptorsBefore);
    }
    cases++;
  } catch (_) { throw new Error("question-ID regression failed: " + name); }
}
function env(initial = {}, opts = {}) {
  const disk = new Map(Object.entries(initial));
  let denied = !!opts.denied, writeDenied = false, now = T;
  const calls = { logs: [], network: 0, writes: [], reads: [] };
  const c = { URLSearchParams, URL, TextEncoder, TextDecoder,
    location: { search: "?pack=fixture", href: "https://fixture.invalid/" },
    console: Object.fromEntries(["log", "debug", "warn", "error"].map(k => [k, (...a) => calls.logs.push(a)])),
    fetch() { calls.network++; throw new Error("forbidden"); },
    setTimeout() { return 0; }, clearTimeout() {},
    localStorage: {
      getItem(k) { calls.reads.push(k); if (denied) throw new Error("denied"); return disk.has(k) ? disk.get(k) : null; },
      setItem(k, v) { if (denied || writeDenied) throw new Error("denied"); disk.set(k, String(v)); calls.writes.push(k); },
      removeItem(k) { if (denied) throw new Error("denied"); disk.delete(k); },
      key(i) { return [...disk.keys()][i]; }, get length() { return disk.size; }
    }
  };
  c.window = c; vm.createContext(c);
  const prototypeSignature = vm.runInContext(`(function(stringify){return function(){return stringify(Object.getOwnPropertyNames(Object.prototype).map(k=>{
    const d=Object.getOwnPropertyDescriptor(Object.prototype,k);
    return [k,d.enumerable,d.configurable,d.writable,typeof d.value,d.value && typeof d.value==="function" ? Object.getOwnPropertyNames(d.value) : null];
  }));};})(JSON.stringify)`, c);
  const prototypeBefore = prototypeSignature();
  const prototypeDescriptors = () => vm.runInContext("({object:Object.getOwnPropertyDescriptors(Object.prototype),array:Object.getOwnPropertyDescriptors(Array.prototype)})", c);
  const descriptorsBefore = prototypeDescriptors();
  activeEnvironments.push({ prototypeBefore, prototypeSignature, prototypeDescriptors, descriptorsBefore });
  vm.runInContext("globalThis.__now=" + T + "; Date.now=function(){return __now;};", c);
  for (const f of ["aced-core.js", "aced-library.js", "aced-bridge.js"]) {
    let source = fs.readFileSync(path.join(ROOT, f), "utf8");
    if (f === "aced-core.js" && opts.coreTransform) source = opts.coreTransform(source);
    vm.runInContext(source, c, { filename: f });
  }
  const evaluate = s => vm.runInContext(s, c);
  return { c, disk, calls, evaluate, prototypeSignature, prototypeBefore, prototypeDescriptors, descriptorsBefore, core: c.ACEDCore, lib: c.ACEDLibrary, bridge: c.ACEDBridge,
    deny() { denied = true; }, denyWrites() { writeDenied = true; },
    time(t) { now = t; c.__now = now; },
    raw(k) { return disk.get("aced:fixture:" + k); },
    record(ok = true, id = "target") { return c.ACEDBridge.recorder(c.ACEDLibrary, "fixture")({ id }, ok); }
  };
}
function result(outcome = "recorded", persistence = "durable", reason = "complete") { return { outcome, persistence, reason }; }
function coreSuite() {
  test("T01/T02/T03 literal first writes", () => {
    for (const id of ["ordinary", "toString", "hasOwnProperty", "valueOf", "toJSON", "constructor", "prototype", "__proto__"]) {
      for (const ok of [true, false]) {
        const e = env(), q = { id, source: "Fixture" };
        const before = e.evaluate("Object.getOwnPropertyNames(Object.prototype).map(k=>[k,Object.getOwnPropertyDescriptor(Object.prototype,k).value])");
        e.core.review.record(q, ok);
        const r = JSON.parse(e.raw("review"));
        check(own(r, id) && Object.getOwnPropertyDescriptor(r, id).enumerable);
        eq([r[id].seen, r[id].ok, r[id].miss, r[id].box], [1, ok ? 1 : 0, ok ? 0 : 1, ok ? 1 : 0]);
        const reload = env(Object.fromEntries(e.disk));
        eq(plain(reload.core.review.schedule(q)), plain(e.core.review.schedule(q)));
        e.time(T + 864e5); reload.time(T + 864e5);
        eq(e.core.review.count(), 1); eq(reload.core.review.count(), 1);
        eq(e.evaluate("Object.getOwnPropertyNames(Object.prototype).map(k=>[k,Object.getOwnPropertyDescriptor(Object.prototype,k).value])"), before);
      }
    }
  });
}
function corePartialSuite() {
  const base = { seen: 5, miss: 2, ok: 3, box: 2, last: T - 5000 };
  const partial = result("partial", "durable", "historical-fields-unknown");
  const schedule = { last: T, box: 0, lastReviewedAt: T, intervalDays: 0, dueAt: T + 600000 };
  function scenario(name, before, correct, after, disposition = partial) {
    test(name, () => {
      const other = '{"retained":1}', initial = {
        "aced:fixture:review": JSON.stringify({ target: before, unrelated: { dueAt: T + 9999 } }),
        "aced:other:review": other
      };
      const e = env(initial), out = e.core.review.record({ id: "target" }, correct);
      eq(plain(out), disposition);
      const saved = JSON.parse(e.raw("review")); eq(saved.target, after);
      eq(saved.unrelated, { dueAt: T + 9999 }); eq(e.disk.get("aced:other:review"), other);
      const bytes = e.raw("review"), reload = env(Object.fromEntries(e.disk));
      eq(plain(reload.core.store.get("review", {})), saved);
      for (const f of [e, reload]) {
        f.core.review.queue([{ id: "target" }], 2000); f.core.review.count();
        f.core.review.schedule({ id: "target" }); f.core.review.isWeak({ id: "target" });
        eq(f.raw("review"), bytes); check(f.calls.network === 0);
      }
      if (name === "PH-05") {
        eq(e.core.review.count(), 1);
        eq(e.core.review.queue([{ id: "target" }], 10).length, 1);
      }
    });
  }
  scenario("PH-04", { seen: 5, miss: null, ok: 2, box: 1, last: T - 5000, dueAt: T - 1000, intervalDays: 1, lastReviewedAt: T - 5000 },
    true, { seen: 6, miss: null, ok: 3, box: 2, last: T, dueAt: T + 259200000, intervalDays: 3, lastReviewedAt: T });
  scenario("PH-05", { seen: 5, miss: 2, ok: 3, last: T - 5000, dueAt: T - 1000, intervalDays: 7, lastReviewedAt: T - 5000, lapses: 2 },
    true, { seen: 6, miss: 2, ok: 4, last: T, dueAt: T - 1000, intervalDays: 7, lastReviewedAt: T - 5000, lapses: 2 });
  scenario("PH-06", {}, true, { last: T });
  scenario("PH-07", { seen: null, ok: "3", box: null, dueAt: T - 1000, intervalDays: 7, lastReviewedAt: T - 5000 },
    false, { seen: null, ok: "3", ...schedule });
  scenario("PH-08", base, false, { ...base, seen: 6, miss: 3, ...schedule, lapses: 1 }, result());
  for (const bad of [null, "2", -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    for (const k of ["seen", "ok", "miss"]) {
      const before = { ...base, [k]: bad };
      const after = { ...before, last: T, box: 3, lastReviewedAt: T, intervalDays: 7, dueAt: T + 604800000 };
      if (k !== "seen") after.seen++;
      if (k !== "ok") after.ok++;
      scenario("T06 counter-domain " + k + " " + typeof bad + String(bad).length, before, true, after);
    }
  }
  scenario("T06 safe-increment ceiling", { ...base, seen: Number.MAX_SAFE_INTEGER }, false,
    { ...base, seen: Number.MAX_SAFE_INTEGER, miss: 3, ...schedule, lapses: 1 });
  scenario("T06 fractional recording box held", { ...base, box: 1.5 }, true,
    { ...base, seen: 6, ok: 4, box: 1.5, last: T });
  scenario("T06 malformed lapse retained", { ...base, lapses: null }, false,
    { ...base, seen: 6, miss: 3, ...schedule, lapses: null });
  test("T04 ownership getters and independent partial due rank", () => {
    const e = env();
    const r = e.evaluate(`(() => {
      const inherited={ghost:{seen:1,miss:1,ok:0,box:0,dueAt:1}};
      const r=Object.create(inherited);
      Object.defineProperty(r,"accessor",{enumerable:true,get(){throw Error("must not execute");}});
      r.hasOwnProperty={dueAt:1};r.partial1={dueAt:1};r.partial2={dueAt:1};
      r.finite={miss:1,ok:0,box:0,dueAt:1};
      r.fields=Object.create({miss:2,ok:0,box:0,dueAt:1});
      return r;
    })()`);
    const get = e.core.store.get;
    e.core.store.get = (k, fb) => k === "review" ? r : get(k, fb);
    eq(e.core.review.count(), 4); eq(e.core.review.schedule({ id: "ghost" }), null);
    check(!e.core.review.isWeak({ id: "fields" }));
    eq(Array.from(e.core.review.queue(["partial1", "finite", "partial2", "ghost"].map(id => ({ id })), 10), q => q.id), ["finite", "partial1", "partial2"]);
    const bank = Array.from({ length: 2000 }, (_, i) => ({ id: i === 0 ? "finite" : "absent-" + i }));
    eq(e.core.review.queue(bank, 2000).length, 1);
  });
  test("PH-12/T07 non-JSON preflight matrix and due preservation", () => {
    const expressions = ["NaN", "Infinity", "-Infinity", "undefined", "function(){}", "1n", "Symbol('x')",
      "new Date()", "new Map()", "[,1]", "Object.assign([1],{extra:2})", "Object.defineProperty([1],'extra',{value:2})", "(()=>{let a={};a.a=a;return a;})()",
      "Object.defineProperty({},'bad',{enumerable:true,get(){throw Error('must not execute')}})",
      "Object.defineProperty({},'bad',{get(){throw Error('must not execute')}})"];
    for (const expression of expressions) {
      const e = env({ "aced:fixture:review": '{"retained":{}}' });
      const raw = e.raw("review");
      const injected = e.evaluate(`({target:{seen:NaN,miss:1,ok:1,box:0,last:1,dueAt:1},unrelated:${expression}})`);
      const get = e.core.store.get;
      e.core.store.get = (k, fb) => k === "review" ? injected : get(k, fb);
      eq(plain(e.core.review.record({ id: "target" }, true)), result("held", "none", "serialization-failed"));
      eq(e.raw("review"), raw); check(Number.isNaN(injected.target.seen)); eq(injected.target.last, 1);
      eq(e.core.review.count(), 1); eq(e.core.review.queue([{ id: "target" }]).length, 1);
    }
  });
  test("T07 opaque/corrupt core boundaries", () => {
    for (const raw of ["null", "[]", "3", '"x"', "{broken", '{"target":null}', '{"target":[]}']) {
      const e = env({ "aced:fixture:review": raw });
      eq(plain(e.core.review.record({ id: "target" }, true)), result("held", "none", "historical-state-held"));
      eq(e.raw("review"), raw);
    }
  });
  test("T07 predecessor continuity and inaccessible ephemeral session", () => {
    for (const mode of ["read", "write", "initial"]) {
      const e = env({ "aced:fixture:review": JSON.stringify({ target: base }) }, { denied: mode === "initial" });
      if (mode !== "initial") { e.core.review.count(); if (mode === "read") e.deny(); else e.denyWrites(); }
      eq(plain(e.core.review.record({ id: "target" }, true)), result("recorded", "memory", "storage-unavailable"));
      eq(e.core.store.get("review", {}).target.seen, mode === "initial" ? 1 : 6);
      e.core.review.record({ id: "target" }, false);
      eq(e.core.store.get("review", {}).target.seen, mode === "initial" ? 2 : 7);
      eq(JSON.parse(e.raw("review")).target.seen, 5); check(!e.core.store.isPersistent());
    }
  });
  test("PH-13/T08 held collisions and intact partial moves", () => {
    const complete = { ...base, dueAt: T - 1000 };
    const invalids = [{ miss: 1, ok: 2, box: 1, last: T - 5000, dueAt: T - 1000 },
      { ...complete, extension: 1 }];
    for (const k of ["seen", "miss", "ok", "last", "box", "src"]) {
      for (const bad of [null, "2", -1, {}, []]) {
        if (k === "box" && bad === -1 || k === "src" && (bad === null || typeof bad === "string")) continue;
        invalids.push({ ...complete, [k]: bad });
      }
    }
    for (const canonical of invalids) {
      const e = env(), q = { id: "target", source: "Fixture", q: "Synthetic" }, alias = e.core.legacyQKey(q);
      e.core.store.set("review", { target: canonical, [alias]: complete });
      const bytes = e.raw("review");
      eq(plain(e.core.review.migrateIds([q])), { migrated: 0, skipped: 1, reason: "historical-state-held" });
      eq(e.raw("review"), bytes); eq(e.core.review.migrateIds([q]).migrated, 0);
      if (canonical === invalids[0]) {
        eq(e.core.review.count(), 2); eq(e.core.review.queue([q], 10).length, 1);
      }
    }
    const e = env(), q = { id: "__proto__", source: "Fixture", q: "Synthetic" }, alias = e.core.legacyQKey(q);
    e.core.store.set("review", { [alias]: { strength: 2, extension: null } });
    eq(e.core.review.migrateIds([q]).migrated, 1);
    eq(JSON.parse(e.raw("review"))[q.id], { strength: 2, extension: null });
    check(!own(JSON.parse(e.raw("review")), alias));
  });
  test("T07 malformed root reads and invalid derived time never write", () => {
    for (const raw of ['[{"dueAt":1,"miss":1,"ok":0,"box":0}]', "null", "3"]) {
      const e = env({ "aced:fixture:review": raw });
      eq(e.core.review.count(), 0); eq(e.core.review.queue([{ id: "0" }]).length, 0);
      eq(e.core.review.schedule({ id: "0" }), null); check(!e.core.review.isWeak({ id: "0" }));
      eq(e.raw("review"), raw);
    }
    const e = env({ "aced:fixture:review": '{"target":{}}' }), raw = e.raw("review");
    e.time(NaN);
    eq(plain(e.core.review.record({ id: "target" }, false)), result("held", "none", "serialization-failed"));
    eq(e.raw("review"), raw);
  });
  test("T08 atomic whole-payload failure and independent batch partial success", () => {
    const e = env(), a = { id: "first", source: "Fixture", q: "Synthetic A" }, b = { id: "second", source: "Fixture", q: "Synthetic B" };
    const aa = e.core.legacyQKey(a), bb = e.core.legacyQKey(b);
    e.core.store.set("review", { first: { ...base, extension: null }, [aa]: base, [bb]: { dueAt: 1 } });
    eq(plain(e.core.review.migrateIds([a, b])), { migrated: 1, skipped: 1, reason: "historical-state-held" });
    const saved = JSON.parse(e.raw("review")); check(own(saved, aa) && !own(saved, bb)); eq(saved.second, { dueAt: 1 });
    const bytes = e.raw("review"), get = e.core.store.get;
    const injected = { ...saved, [bb]: base, unsupported: NaN };
    e.core.store.get = (k, fb) => k === "review" ? injected : get(k, fb);
    eq(plain(e.core.review.migrateIds([b])), { migrated: 0, skipped: 1, reason: "serialization-failed" });
    check(own(injected, bb)); eq(e.raw("review"), bytes);
    eq(plain(e.core.review.migrateIds([b, { id: "absent", source: "Other", q: "Synthetic" }, null])),
      { migrated: 0, skipped: 2, reason: "serialization-failed" });
    e.core.store.get = get;
    const actual = env(), alias = actual.core.legacyQKey(a);
    actual.core.store.set("review", { [alias]: base });
    const originalBytes = actual.raw("review"), eventsBefore = plain(actual.core.analytics.recent());
    actual.evaluate("globalThis.__stringify=JSON.stringify;JSON.stringify=function(){throw Error('synthetic preparation failure')}");
    try {
      eq(plain(actual.core.review.migrateIds([a])), { migrated: 0, skipped: 1, reason: "serialization-failed" });
      eq(actual.raw("review"), originalBytes); eq(plain(actual.core.analytics.recent()), eventsBefore);
    } finally { actual.evaluate("JSON.stringify=__stringify;delete globalThis.__stringify"); }
  });
  test("T04 unrelated unsupported fields never suppress known due evidence", () => {
    const e = env(), injected = e.evaluate(`(() => {
      const r=Object.create(null), target={dueAt:1};
      Object.defineProperty(target,Symbol.toStringTag,{get(){throw Error("must not execute")}});
      r.target=target;return r;
    })()`);
    const get = e.core.store.get;
    e.core.store.get = (k, fb) => k === "review" ? injected : get(k, fb);
    eq(e.core.review.count(), 1); eq(e.core.review.queue([{ id: "target" }]).length, 1);
    eq(plain(e.core.review.record({ id: "target" }, false)), result("held", "none", "serialization-failed"));
    eq(e.core.review.count(), 1); check(!own(injected.target, "last"));
  });
  test("T08 exact collision counter/chronology domains and fractional box compatibility", () => {
    for (const k of ["seen", "miss", "ok", "last", "box"]) {
      for (const bad of ["absent", null, "1", ...(k === "box" ? [] : [-1]), ...(k === "last" || k === "box" ? [] : [0.5, Number.MAX_SAFE_INTEGER + 1])]) {
        const e = env(), q = { id: "target", source: "Fixture", q: "Synthetic" }, alias = e.core.legacyQKey(q);
        const record = { ...base, [k]: bad };
        if (bad === "absent") delete record[k];
        e.core.store.set("review", { target: record, [alias]: base });
        const bytes = e.raw("review");
        eq(e.core.review.migrateIds([q]).migrated, 0); eq(e.raw("review"), bytes);
      }
    }
    const e = env(), q = { id: "target", source: "Fixture", q: "Synthetic" }, alias = e.core.legacyQKey(q);
    e.core.store.set("review", { target: { ...base, box: 1.5, last: 5 }, [alias]: { ...base, last: 4 } });
    eq(e.core.review.migrateIds([q]).migrated, 1); eq(e.core.store.get("review", {}).target.box, 1.5);
  });
}
function librarySuite() {
  const partial = result("partial", "durable", "historical-fields-unknown");
  const current = { lastCorrect: true, lastAt: T, selfRated: false };
  const fresh = { attempts: 1, correct: 1, strength: 1, ...current };
  const aggregates = { attempts: 12, correct: 8, selfRated: 2 };
  const advanced = { attempts: 13, correct: 9, selfRated: 2 };
  function scenario(name, before, after, out = partial, ok = true, options = {}) {
    test(name, () => {
      const initial = { "aced:other:learning_v1": '{"sentinel":1}' };
      if (before !== undefined) initial["aced:fixture:learning_v1"] = JSON.stringify(before);
      const e = env(initial); if (options.memory) e.denyWrites();
      const view = plain(e.lib.learning("fixture")), durableBefore = e.raw("learning_v1");
      eq(plain(e.record(ok)), out);
      if (out.persistence === "none") {
        eq(e.raw("learning_v1"), durableBefore); eq(plain(e.lib.learning("fixture")), view);
      } else {
        const snapshot = e.lib.learningWriteContext("fixture").snapshot;
        eq(plain(snapshot), after);
        const reloadBytes = out.persistence === "memory" ? JSON.stringify(snapshot) : e.raw("learning_v1");
        const reload = env({ ...Object.fromEntries(e.disk), "aced:fixture:learning_v1": reloadBytes });
        eq(plain(reload.lib.learningWriteContext("fixture").snapshot), after);
        for (const f of [e, reload]) {
          const p = f.lib.progress("fixture", [{ id: "target" }]);
          check(Number.isFinite(p.pct) && p.pct >= 0 && p.pct <= 100);
          const item = after.answers && after.answers.target;
          eq(p.practiced, item && typeof item === "object" && !Array.isArray(item) ? 1 : 0);
          if (item && typeof item.strength === "number") eq(p.pct, item.strength * 50);
          eq(f.lib.progress("fixture", [{ id: "absent" }]).practiced, 0);
          eq(plain(f.lib.learningWriteContext("fixture").snapshot), after);
        }
        if (options.memory) {
          eq(e.raw("learning_v1"), durableBefore);
          eq(plain(env(Object.fromEntries(e.disk)).lib.learningWriteContext("fixture").snapshot), before);
        }
      }
      eq(e.disk.get("aced:other:learning_v1"), '{"sentinel":1}'); eq(e.calls.network, 0);
      if (name === "PH-10") eq(e.lib.progress("fixture", [{ id: "unrelated" }]).pct, 100);
      return e;
    });
  }
  const extra = { unrelated: { strength: 2 } };
  const root = item => ({ ...aggregates, answers: { target: item, ...extra } });
  const updated = item => ({ ...advanced, answers: { target: item, ...extra } });
  scenario("PH-01", root({ strength: 2 }), updated({ strength: 2, ...current }));
  const nullItem = { attempts: null, correct: null, strength: 1, lastCorrect: false, lastAt: T - 5000, selfRated: true };
  scenario("PH-02", root(nullItem), updated({ ...nullItem, strength: 2, ...current }));
  scenario("PH-03", { attempts: null, correct: 5, selfRated: 0, answers: { target: { attempts: 4, correct: 3, strength: 2 }, ...extra } },
    { attempts: null, correct: 5, selfRated: 0, answers: { target: { attempts: 5, correct: 3, strength: 0, ...current, lastCorrect: false }, ...extra } }, partial, false);
  scenario("PH-09A", root({ attempts: 4, correct: 3 }), updated({ attempts: 5, correct: 4, strength: 1, ...current }), result());
  scenario("PH-09B", root({ correct: 2 }), updated({ correct: 3, ...current }));
  scenario("PH-10", root(null), root(null), result("held", "none", "historical-state-held"));
  test("PH-11 corrupt bytes never save display zeros", () => {
    const raw = "{unparseable", e = env({ "aced:fixture:learning_v1": raw });
    eq(e.lib.learning("fixture").attempts, 0);
    eq(plain(e.record()), result("held", "none", "historical-state-held"));
    eq(e.raw("learning_v1"), raw);
  });
  scenario("PH-14", root(nullItem), updated({ ...nullItem, strength: 2, ...current }), result("partial", "memory", "historical-fields-unknown"), true, { memory: true });
  test("PH-15 two genuine calls only; reads/reload add no attempt", () => {
    const e = env({ "aced:fixture:learning_v1": JSON.stringify(root({ strength: 2 })) });
    e.record();
    const reloaded = env(Object.fromEntries(e.disk));
    reloaded.lib.progress("fixture", [{ id: "target" }]); reloaded.lib.learning("fixture");
    reloaded.time(T + 1); eq(plain(reloaded.record(false)), partial);
    eq(plain(reloaded.lib.learningWriteContext("fixture").snapshot), {
      attempts: 14, correct: 9, selfRated: 2, answers: { target: { strength: 0, ...current, lastCorrect: false, lastAt: T + 1 }, ...extra }
    });
  });
  scenario("PH-16", { correct: 2 }, { correct: 3, answers: { target: fresh } });
  scenario("PH-17", undefined, { attempts: 1, correct: 1, selfRated: 0, answers: { target: fresh } }, result());
  scenario("PH-18", {}, { answers: { target: fresh } });
  scenario("PH-19", { ...aggregates, answers: extra }, updated(fresh), result());
  scenario("PH-20", root({}), updated(current));
  test("PH-21/T16 unsupported raw capability zero legacy calls", () => {
    let legacyCalls = 0, commits = 0;
    const legacy = { learning() { legacyCalls++; return root({}); }, saveLearning() { legacyCalls++; } };
    const libraries = [legacy, Object.assign(Object.create({ learningWriteContext() { throw Error("must not call"); } }), legacy),
      { ...legacy, learningWriteContext: 1 },
      Object.defineProperty({ ...legacy }, "learningWriteContext", { get() { throw Error("must not call"); } }),
      { ...legacy, learningWriteContext() { throw Error("bounded"); } }];
    for (const bad of [null, {}, { classification: "present", source: "none", snapshot: {}, commit() { commits++; } },
      Object.create({ classification: "present", source: "durable", snapshot: {}, commit() { commits++; } }),
      { classification: "absent", source: "durable", snapshot: null, commit: 3 }])
      libraries.push({ ...legacy, learningWriteContext() { return bad; } });
    for (const l of libraries) eq(plain(env().bridge.recorder(l, "fixture")({ id: "target" }, true)), result("held", "none", "raw-state-unavailable"));
    eq(legacyCalls, 0); eq(commits, 0);
  });
  test("PH-22/T07 non-JSON original matrix retains practiced strength", () => {
    for (const expression of ["NaN", "Infinity", "undefined", "function(){}", "1n", "Symbol('x')", "new Date()", "new Map()",
      "[,1]", "Object.assign([1],{extra:2})", "Object.defineProperty([1],'extra',{value:2})", "(()=>{const a={};a.a=a;return a;})()",
      "Object.defineProperty({},'x',{enumerable:true,get(){throw Error('must not execute')}})",
      "Object.defineProperty({},'x',{get(){throw Error('must not execute')}})"]) {
      const e = env({ "aced:fixture:learning_v1": '{"injected":true}' });
      e.evaluate(`globalThis.__raw={attempts:12,correct:8,selfRated:2,answers:{target:{strength:2}},unrelated:${expression}};
        globalThis.__parse=JSON.parse;JSON.parse=function(s){return s==='{"injected":true}'?__raw:__parse(s);};`);
      const bytes = e.raw("learning_v1");
      eq(plain(e.record()), result("held", "none", "serialization-failed"));
      const p = e.lib.progress("fixture", [{ id: "target" }]);
      eq([p.practiced, p.pct], [1, 100]); eq(e.raw("learning_v1"), bytes);
      check(!own(e.c.__raw.answers.target, "attempts")); eq(e.c.__raw.attempts, 12);
    }
  });
  test("T02/T03 library literal own writes and reload", () => {
    for (const id of ["ordinary", "toString", "hasOwnProperty", "valueOf", "toJSON"]) {
      for (const ok of [true, false]) {
        const e = env(), out = e.record(ok, id), r = JSON.parse(e.raw("learning_v1"));
        eq(plain(out), result()); check(own(r.answers, id)); eq(r.answers[id].attempts, 1);
        eq(r.answers[id].correct, ok ? 1 : 0); eq(r.answers[id].strength, ok ? 1 : 0);
        eq(e.lib.progress("fixture", [{ id }]).practiced, 1);
        const reload = env(Object.fromEntries(e.disk)); eq(plain(reload.lib.learning("fixture")), plain(e.lib.learning("fixture")));
      }
    }
  });
  test("T06 strength domains and aggregate/item unknown fields", () => {
    for (const strength of [0, 0.5, 1, 2, null, "1", -1, 3, {}, []]) {
      const e = env({ "aced:fixture:learning_v1": JSON.stringify(root({ attempts: 4, correct: 3, strength })) });
      const valid = typeof strength === "number" && strength >= 0 && strength <= 2;
      eq(plain(e.record()), valid ? result() : partial);
      eq(plain(e.lib.learningWriteContext("fixture").snapshot.answers.target.strength), valid ? Math.min(2, strength + 1) : strength);
      e.record(false); eq(e.lib.learningWriteContext("fixture").snapshot.answers.target.strength, 0);
    }
    for (const bad of [null, "2", -1, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
      for (const level of ["root", "item"]) {
        const before = root({ attempts: 4, correct: 3, strength: 1 });
        (level === "root" ? before : before.answers.target).attempts = bad;
        const e = env({ "aced:fixture:learning_v1": JSON.stringify(before) });
        eq(plain(e.record()), partial);
        const saved = e.lib.learningWriteContext("fixture").snapshot;
        eq((level === "root" ? saved : saved.answers.target).attempts, bad);
      }
    }
  });
  test("T07 opaque roots/answers and detached rejected commit", () => {
    for (const before of [null, [], 1, "x", { answers: null }, { answers: [] }, { answers: { target: [] } }]) {
      const e = env({ "aced:fixture:learning_v1": JSON.stringify(before) }), bytes = e.raw("learning_v1");
      eq(plain(e.record()), result("held", "none", "historical-state-held")); eq(e.raw("learning_v1"), bytes);
    }
    const e = env(); let commits = 0;
    const original = root({ attempts: 4, correct: 3, strength: 1 }), before = plain(original);
    const l = { learningWriteContext() { return { classification: "present", source: "durable", snapshot: original,
      commit(candidate) { commits++; check(candidate !== original && candidate.answers !== original.answers); return { accepted: false, persistence: "none", reason: "storage-unavailable" }; } }; } };
    eq(plain(e.bridge.recorder(l, "fixture")({ id: "target" }, true)), result("held", "none", "storage-unavailable"));
    eq(original, before); eq(commits, 1);
  });
  test("T07 initial/read/write denied predecessor continuity", () => {
    for (const mode of ["initial", "read", "write"]) {
      const before = root({ attempts: 4, correct: 3, strength: 1 });
      const e = env({ "aced:fixture:learning_v1": JSON.stringify(before) }, { denied: mode === "initial" });
      if (mode !== "initial") { e.lib.learning("fixture"); if (mode === "read") e.deny(); else e.denyWrites(); }
      eq(plain(e.record()), result("recorded", "memory", "storage-unavailable"));
      e.record(false);
      eq(e.lib.learningWriteContext("fixture").snapshot.attempts, mode === "initial" ? 2 : 14);
      eq(JSON.parse(e.raw("learning_v1")), before); check(!e.lib.isPersistent());
    }
  });
  test("T01 identities/import reservations and numeric/trimmed/fallback core keys", () => {
    const e = env();
    for (const id of ["ordinary", "toString", "hasOwnProperty", "valueOf", "toJSON"]) {
      const p = e.lib.normalize({ id: "fixture", questions: [{ id, q: "Synthetic", answer: "Synthetic" }] });
      eq(p.questions[0].id, id); eq(e.bridge.toEngineQuestions(p)[0].id, id);
    }
    for (const id of ["__proto__", "constructor", "prototype"])
      check(e.lib.normalizeQuestion({ id, q: "Synthetic", answer: "Synthetic" }, 0).id !== id);
    eq(e.core.qKey({ id: 123 }), "123"); eq(e.core.qKey({ id: "  literal  " }), "literal");
    const q = { source: "Fixture", q: "Synthetic" };
    eq(e.core.qKey(q), e.core.legacyQKey(q));
    eq(plain(e.bridge.recorder({}, "fixture")(null, true)), result("no-question", "none", "no-question"));
  });
  test("T04 own/inherited data and safe primitive-only strength display", () => {
    const e = env({ "aced:fixture:learning_v1": '{"injected":true}' });
    e.evaluate(`globalThis.__raw={answers:Object.create({ghost:{strength:2}})};
      __raw.answers.target=Object.create({strength:2});
      Object.defineProperty(__raw.answers,"accessor",{enumerable:true,get(){throw Error("must not execute")}});
      globalThis.__parse=JSON.parse;JSON.parse=function(s){return s==='{"injected":true}'?__raw:__parse(s);};`);
    eq(e.lib.progress("fixture", [{ id: "ghost" }]).practiced, 0);
    eq(e.lib.progress("fixture", [{ id: "accessor" }]).practiced, 0);
    eq([e.lib.progress("fixture", [{ id: "target" }]).practiced, e.lib.progress("fixture", [{ id: "target" }]).pct], [1, 0]);
    for (const strength of ["2", true, null, "Infinity", {}, []]) {
      const f = env({ "aced:fixture:learning_v1": JSON.stringify({ answers: { target: { strength } } }) });
      const expected = strength === "2" ? 100 : strength === true ? 50 : 0;
      eq(f.lib.progress("fixture", [{ id: "target" }]).pct, expected);
    }
  });
  test("T10 targeted edit preserves opaque/corrupt components and unrelated values; explicit deletion unchanged", () => {
    for (const kind of ["valid", "null-item", "opaque-map", "opaque-root", "corrupt"]) {
      const e = env(), p = e.lib.save({ id: "fixture", name: "Synthetic", questions: [{ id: "toString", q: "Synthetic", answer: "Synthetic A" }] });
      const validItem = { strength: 2 }, learningKey = "aced:fixture:learning_v1", reviewKey = "aced:fixture:review";
      const a = kind === "null-item" ? null : validItem;
      const raw = kind === "corrupt" ? "{corrupt" : JSON.stringify(kind === "opaque-root" ? null :
        kind === "opaque-map" ? { answers: null } : { attempts: null, answers: { toString: a, other: { strength: 2 } } });
      const reviewRaw = kind === "corrupt" ? "{corrupt" : JSON.stringify(kind === "opaque-map" || kind === "opaque-root" ? null : { toString: a, other: { dueAt: 1 } });
      e.disk.set(learningKey, raw); e.disk.set(reviewKey, reviewRaw); e.disk.set("aced:fixture:extra", "{opaque");
      e.disk.set("aced:other:learning_v1", '{"sentinel":1}');
      p.questions[0].answer = "Synthetic B"; e.lib.save(p);
      if (kind === "valid") {
        const l = JSON.parse(e.disk.get(learningKey)), r = JSON.parse(e.disk.get(reviewKey));
        check(!own(l.answers, "toString") && !own(r, "toString"));
        eq(l.attempts, null); eq(l.answers.other.strength, 2); eq(r.other.dueAt, 1);
      } else { eq(e.disk.get(learningKey), raw); eq(e.disk.get(reviewKey), reviewRaw); }
      e.lib.remove("fixture");
      check(![...e.disk.keys()].some(k => k.startsWith("aced:fixture:")));
      eq(e.disk.get("aced:other:learning_v1"), '{"sentinel":1}');
    }
  });
  test("T13 bounded results/schema/events/no recording logs or network", () => {
    const e = env(), logCount = e.calls.logs.length;
    const r = e.record();
    eq(Object.keys(r).sort(), ["outcome", "persistence", "reason"]);
    eq(e.calls.logs.length, logCount); eq(e.calls.network, 0);
    const root = JSON.parse(e.raw("learning_v1"));
    eq(Object.keys(root).sort(), ["answers", "attempts", "correct", "selfRated"]);
    eq(Object.keys(root.answers.target).sort(), ["attempts", "correct", "lastAt", "lastCorrect", "selfRated", "strength"]);
    const c = env(), q = { id: "toString", source: "Fixture", q: "Synthetic" };
    c.core.store.set("review", { [c.core.legacyQKey(q)]: { dueAt: 1 } });
    c.core.review.migrateIds([q]);
    const events = plain(c.core.analytics.recent());
    const migration = events.filter(x => x.e === "review_ids_migrated");
    eq(migration.length, 1); eq(Object.keys(migration[0].p).sort(), ["migrated", "skipped"]);
  });
  test("T16 full raw contexts are fresh, detached, atomic, and single-use", () => {
    const e = env({ "aced:fixture:learning_v1": JSON.stringify(root({ strength: 2 })) });
    const context = e.lib.learningWriteContext("fixture"), bytes = e.raw("learning_v1");
    context.snapshot.attempts = 99;
    eq(e.lib.learningWriteContext("fixture").snapshot.attempts, 12); eq(e.raw("learning_v1"), bytes);
    const disposition = context.commit(context.snapshot);
    eq(plain(disposition), { accepted: true, persistence: "durable" });
    eq(plain(context.commit(context.snapshot)), { accepted: false, persistence: "none", reason: "storage-unavailable" });
    const before = e.raw("learning_v1"), next = e.lib.learningWriteContext("fixture");
    next.snapshot.attempts = NaN;
    eq(plain(next.commit(next.snapshot)), { accepted: false, persistence: "none", reason: "serialization-failed" });
    eq(e.raw("learning_v1"), before);
  });
}
function serverSuite() {
  const { mergeReview, mergeState } = require(path.join(ROOT, "server/merge.js"));
  test("T09 literal union one-sided and independent owned candidates", () => {
    eq(plain(mergeReview()), {});
    for (const id of ["ordinary", "__proto__", "constructor", "prototype", "toJSON", "toString", "valueOf", "hasOwnProperty"]) {
      const incoming = JSON.parse(JSON.stringify({ [id]: { last: 2, seen: 1 } }));
      for (const [a, b] of [[{}, incoming], [incoming, {}], [Object.create({ [id]: { last: 99 } }), incoming]]) {
        const out = mergeReview(a, b), reload = JSON.parse(JSON.stringify(out));
        check(own(out, id) && own(reload, id)); eq(plain(out[id]), { last: 2, seen: 1 });
      }
      const d = Object.create({ review: { [id]: { last: 999 } } });
      const out = mergeState({ data: d }, { data: { review: incoming } });
      eq(plain(out.review[id]), { last: 2, seen: 1 });
    }
  });
  test("T09 whole-record comparator compatibility", () => {
    const cases = [
      [{ last: 3, seen: 1, marker: "a" }, { last: 2, seen: 99 }, "a"],
      [{ last: 3, seen: 2, marker: "a" }, { last: 3, seen: 2, marker: "b" }, "a"],
      [{ last: "3", seen: "2" }, { last: true, seen: 99, marker: "b" }, undefined],
      [{ last: null, marker: "a" }, { seen: 1, marker: "b" }, "b"],
      [{ last: "Infinity", marker: "a" }, { last: 999, marker: "b" }, "a"],
      [{ last: {}, marker: "a" }, { last: 999, marker: "b" }, "a"],
      [{ seen: [], marker: "a" }, { last: 999, marker: "b" }, "a"]
    ];
    for (const [a, b, marker] of cases) {
      const aa = JSON.stringify(a), bb = JSON.stringify(b);
      eq(mergeReview({ target: a }, { target: b }).target.marker, marker);
      eq(JSON.stringify(a), aa); eq(JSON.stringify(b), bb);
    }
    const tiedA = { last: 5, seen: 2, box: 1 }, tiedB = { last: 5, seen: 2, box: 3 };
    eq(plain(mergeReview({ target: tiedA }, { target: tiedB }).target), tiedA);
    eq(plain(mergeReview({ target: tiedB }, { target: tiedA }).target), tiedB);
  });
  test("T09 opaque roots/conflicts exact preservation", () => {
    for (const opaque of [null, [], 3, "x", false]) {
      eq(plain(mergeReview(opaque, { target: {} })), opaque);
      eq(plain(mergeReview(undefined, opaque)), opaque);
      eq(plain(mergeReview({ target: {} }, opaque)), { target: {} });
      eq(plain(mergeReview({ target: opaque }, { target: { last: 99 } })), { target: opaque });
      eq(plain(mergeReview({}, { target: opaque })), { target: opaque });
    }
  });
  test("T09 unsupported inputs reject before candidate without hooks", () => {
    let hooks = 0;
    const bads = [NaN, Infinity, undefined, () => {}, 1n, Symbol("x"), new Date(), new Map(), [, 1],
      Object.assign([1], { extra: 2 }),
      Object.defineProperty({}, "x", { enumerable: true, get() { hooks++; return 1; } })];
    const cycle = {}; cycle.self = cycle; bads.push(cycle);
    for (const bad of bads) {
      let failed = false;
      try { mergeReview({ target: { last: 1 }, unrelated: bad }, {}); }
      catch (e) { failed = e.message === "serialization-failed"; }
      check(failed);
    }
    eq(hooks, 0);
  });
  test("T11 sequential devices union/LWW/snapshot replay no amplification", () => {
    const a = { updatedAt: 1, data: { review: { one: { last: 1, seen: 2, box: 0 } } } };
    const b = { updatedAt: 2, data: { review: { two: { last: 2, seen: 1, box: 1 } } } };
    for (const [first, second] of [[a, b], [b, a]]) {
      const data = mergeState(first, second), again = mergeState({ data }, second);
      eq(plain(data), plain(again)); eq(Object.keys(data.review).sort(), ["one", "two"]);
      eq(data.review.one.seen, 2); eq(data.review.two.seen, 1);
    }
  });
}
module.exports = function run(group) {
  cases = 0;
  if (group === "core") coreSuite();
  if (group === "core") corePartialSuite();
  if (group === "library") librarySuite();
  if (group === "server") serverSuite();
  console.log("question-ID " + group + ": " + cases + " named cases passed (no aggregate assertion claim)");
};
module.exports.env = env;
module.exports.helpers = { check, eq, plain, result, test, own, T };
