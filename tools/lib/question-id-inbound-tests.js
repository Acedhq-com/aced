"use strict";
// Actual runtime/merger tests only. All storage and requests are synthetic;
// bounded failures deliberately suppress compared fixture values and errors.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { env, helpers: { check, eq, plain, own, T } } = require("./question-id-integrity-tests");
const ROOT = process.env.ACED_QID_SOURCE_ROOT || path.resolve(__dirname, "../..");
const KEY = "aced:fixture:review", ID = "toString", DUE = T + 600000;
let named = 0, cells = 0;
async function test(name, fn) {
  try { await fn(); named++; }
  catch (error) {
    const location = String(error && error.stack).match(/question-id-inbound-tests\.js:(\d+):\d+/);
    throw new Error("question-ID inbound regression failed: " + name +
      (location ? " at test line " + location[1] : ""));
  }
}
const snapshot = e => ({
  disk: [...e.disk].sort(([a], [b]) => a.localeCompare(b)),
  writes: e.calls.writes.length,
  logs: plain(e.calls.logs),
  views: plain({ count: e.core.review.count(), queue: e.core.review.queue([{ id: ID }], 99),
    schedule: e.core.review.schedule({ id: ID }), weak: e.core.review.isWeak({ id: ID }) }),
  prototype: e.prototypeDescriptors()
});
function held(e, before, out, reason = "review-state-held") {
  eq(plain(out), { applied: false, reason });
  eq(snapshot(e), before); cells++;
}
function fixture(local, opts = {}) {
  const initial = {
    "aced:other:review": '{"retained":1}', "aced:fixture:mastery": '{"local":2}',
    "aced:fixture:learning_v1": '{"attempts":4,"answers":{}}',
    "aced:fixture:muted": "false"
  };
  if (local !== undefined) initial[KEY] = opts.raw ? local : JSON.stringify(local);
  if (!opts.noWatermark) initial["aced:fixture:lastSyncApplied"] = "17";
  const e = env(initial, opts);
  e.core.backend.configure({ endpoint: "https://fixture.invalid" });
  e.time(DUE);
  return e;
}
function response(review, extra = {}) {
  return { v: 1, pack: "fixture", updatedAt: T + 900000,
    data: { mastery: { remote: 9 }, learning_v1: { attempts: 99 },
      muted: true, review, ...extra } };
}
async function pull(e, reply) {
  e.core.backend.pull = () => Promise.resolve(reply);
  return e.core.sync.pull();
}
function successes(e) { return e.core.analytics.recent().filter(x => x.e === "sync_pull"); }
function accepted(e, out, expected, count = 4) {
  eq(plain(out), { applied: true, keys: count });
  eq(JSON.parse(e.raw("review")), expected);
  eq(plain(e.core.store.get("mastery", null)), { remote: 9 });
  eq(e.core.store.get("lastSyncApplied", null), T + 900000);
  eq(e.disk.get("aced:other:review"), '{"retained":1}');
  eq(successes(e).length, 1);
  eq(plain(successes(e)[0].p), { keys: count });
  for (const log of e.calls.logs) {
    check(log[0] === "[aced]" && ["install", "day_active", "sync_pull"].includes(log[1]));
    if (log[1] === "sync_pull") eq(plain(log[2]), { keys: count });
  }
  eq(e.calls.network, 0); cells++;
}
function serverRealm() {
  const s = vm.createContext({});
  vm.runInContext("globalThis.module={exports:{}}", s);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "server/merge.js"), "utf8"), s,
    { filename: "server/merge.js" });
  return s;
}
async function pipelineSuite() {
  const protectedValues = [null, { last: {}, seen: 2, miss: 1, ok: 1, box: 0, dueAt: T - 1000 },
    { last: [], seen: 2 }, { seen: [] }, { seen: {} }];
  for (const mode of ["root", "item", "protected", "rejected", "positive", "partial", "union"]) {
    await test("T18/PH-23/24/28/33 actual push merge pull " + mode, async () => {
      const variants = mode === "protected" ? protectedValues.slice(1) : [null];
      for (const protectedValue of variants) {
        const e = fixture(undefined), s = serverRealm();
        e.time(T);
        const rec = e.core.review.record({ id: ID }, false);
        eq(plain(rec), { outcome: "recorded", persistence: "durable", reason: "complete" });
        e.time(DUE);
        const original = JSON.parse(e.raw("review")), record = original[ID];
        eq(record, { seen: 1, miss: 1, ok: 0, box: 0, last: T, src: null,
          lastReviewedAt: T, intervalDays: 0, dueAt: DUE, lapses: 1 });
        eq(e.core.review.count(), 1); eq(e.core.review.queue([{ id: ID }]).length, 1);
        let remoteReview;
        if (mode === "root") remoteReview = null;
        else if (mode === "rejected") remoteReview = {};
        else if (mode === "positive") remoteReview = { [ID]: { ...record, last: T + 1, seen: 2 } };
        else if (mode === "partial") remoteReview = { [ID]: { last: T + 1, seen: null } };
        else if (mode === "union") remoteReview = JSON.parse('{"__proto__":{"last":3},"hasOwnProperty":null}');
        else remoteReview = { [ID]: protectedValue };
        s.__wire = JSON.stringify({ v: 1, pack: "fixture", updatedAt: T + 900000,
          data: { review: remoteReview } });
        vm.runInContext("globalThis.__state=JSON.parse(__wire)", s);
        e.c.__post = body => {
          s.__wire = body;
          return vm.runInContext(`(() => {
            const incoming=JSON.parse(__wire);
            __state={v:1,pack:"fixture",updatedAt:${T + 900000},
              data:module.exports.mergeState(__state,incoming)};
            __state.data.mastery={remote:9};
            __state.data.learning_v1={attempts:99};
            __state.data.muted=true;
            return JSON.stringify({synced:true});
          })()`, s);
        };
        e.c.__get = () => vm.runInContext("JSON.stringify(__state)", s);
        e.c.__reject = mode === "rejected";
        e.evaluate(`globalThis.__requests=[];
          fetch=async function(url,init){
            const method=init && init.method || "GET";
            __requests.push(method);
            if(method==="POST" && __reject) throw Error("synthetic refusal");
            const text=method==="POST" ? __post(init.body) : __get();
            return {json:function(){return Promise.resolve(JSON.parse(text));}};
          }`);
        let before, pushed;
        const out = await e.core.sync.push().then(r => {
          pushed = r; before = snapshot(e); return e.core.sync.pull();
        });
        eq(Array.from(e.c.__requests), ["POST", "GET"]);
        if (["root", "item", "protected", "rejected"].includes(mode)) {
          held(e, before, out);
          eq(JSON.parse(e.raw("review")), original);
          const stored = JSON.parse(e.c.__get()).data.review;
          if (mode === "root") eq(stored, null);
          if (mode === "item" || mode === "protected") eq(stored[ID], protectedValue);
          if (mode === "rejected") eq(plain(pushed), { synced: false, error: true });
        } else {
          check(out.applied === true);
          const stored = JSON.parse(e.c.__get()).data.review;
          eq(JSON.parse(e.raw("review")), stored);
          if (mode === "union") check(own(stored, "__proto__") && own(stored, "hasOwnProperty") && own(stored, ID));
          eq(successes(e).length, 1); cells++;
        }
        const reload = env(Object.fromEntries(e.disk)); reload.time(DUE);
        eq(plain(reload.core.store.get("review", null)), JSON.parse(e.raw("review")));
        eq(reload.core.review.count(), e.core.review.count());
        eq(Array.from(reload.core.review.queue([{ id: ID }]), q => q.id),
          Array.from(e.core.review.queue([{ id: ID }]), q => q.id));
        eq(e.prototypeSignature(), e.prototypeBefore);
        eq(e.prototypeDescriptors(), e.descriptorsBefore);
      }
    });
  }
}
async function matrixSuite() {
  const opaque = [null, false, 0, "opaque", [1, { nested: true }]];
  await test("T17/PH-25/26 root matrix and original raw preservation", async () => {
    for (const local of [{}, { [ID]: { dueAt: 1 } }, ...opaque]) {
      for (const incoming of [{}, { [ID]: { last: 2 } }, ...opaque]) {
        const e = fixture(local), before = snapshot(e);
        const equal = JSON.stringify(local) === JSON.stringify(incoming);
        const maps = local && incoming && !Array.isArray(local) && !Array.isArray(incoming)
          && typeof local === "object" && typeof incoming === "object";
        const omission = maps && own(local, ID) && !own(incoming, ID);
        const out = await pull(e, response(incoming));
        if ((!maps && !equal) || omission) held(e, before, out);
        else accepted(e, out, incoming);
      }
    }
    const e = fixture("synthetic corrupt bytes", { raw: true }), before = snapshot(e);
    held(e, before, await pull(e, response({ [ID]: {} })));
    const noWatermark = fixture({ [ID]: { dueAt: 1 } }, { noWatermark: true });
    const untouched = snapshot(noWatermark);
    held(noWatermark, untouched, await pull(noWatermark, response(null)));
    check(!noWatermark.disk.has("aced:fixture:lastSyncApplied"));
  });
  await test("T17 item matrix compatible partial and protected comparisons", async () => {
    const compatible = [{}, { last: null }, { last: false, seen: "Infinity" }, { seen: 3.5, miss: null },
      { last: -1, seen: true, box: [] }, { dueAt: 1 }];
    const protectedItems = [...opaque, { last: {} }, { last: [] }, { seen: {} }, { seen: [] }];
    for (const a of [...compatible, ...protectedItems]) for (const b of [...compatible, ...protectedItems]) {
      const e = fixture({ [ID]: a }), before = snapshot(e), out = await pull(e, response({ [ID]: b }));
      const pass = (compatible.includes(a) && compatible.includes(b)) || JSON.stringify(a) === JSON.stringify(b);
      if (pass) accepted(e, out, { [ID]: b }); else held(e, before, out);
    }
    for (const incoming of [{}, Object.create({ [ID]: { last: 999 } })]) {
      const e = fixture({ [ID]: { dueAt: 1 } }), before = snapshot(e);
      held(e, before, await pull(e, response(incoming)));
    }
  });
  await test("T17/PH-27 no-op structural equality byte preservation", async () => {
    for (const raw of [" \nnull ", ' [1,{"b":2,"a":1},0] ', '{"toString":{"last":{},"seen":[{"a":1,"b":2}]}}']) {
      const e = fixture(raw, { raw: true });
      const incoming = raw.includes("seen") ? { [ID]: { seen: [{ b: 2, a: 1 }], last: {} } }
        : raw.includes("[1") ? [1, { a: 1, b: 2 }, -0] : null;
      const writes = e.calls.writes.filter(k => k === KEY).length;
      accepted(e, await pull(e, response(incoming)), JSON.parse(raw));
      eq(e.raw("review"), raw); eq(e.calls.writes.filter(k => k === KEY).length, writes);
    }
  });
  await test("T17/PH-30/32 actual absence and equal protected new sole literal keys", async () => {
    for (const incoming of [null, false, 0, "encoded-looking opaque", [], {}, { [ID]: {} }]) {
      const e = fixture(undefined); accepted(e, await pull(e, response(incoming)), incoming);
    }
    for (const id of ["__proto__", "constructor", "prototype", "toJSON", ID, "hasOwnProperty"]) {
      const incoming = JSON.parse(JSON.stringify({ target: null, [id]: [1] }));
      const e = fixture({ target: null }); accepted(e, await pull(e, response(incoming)), incoming);
      check(own(JSON.parse(e.raw("review")), id));
    }
    const e = fixture({ [ID]: { seen: 5, miss: 2, ok: 3, dueAt: 1 } });
    accepted(e, await pull(e, response({ [ID]: { last: T, seen: null } })), { [ID]: { last: T, seen: null } });
  });
  await test("T17/PH-29 missing inherited nonenumerable review skips local read", async () => {
    for (const raw of ["synthetic corrupt bytes", "null"]) for (const kind of ["missing", "inherited", "hidden"]) {
      const e = fixture(raw, { raw: true });
      let hooks = 0, data = { mastery: { remote: 9 } };
      if (kind === "inherited") data = Object.create(Object.defineProperty({}, "review", { get() { hooks++; return {}; } }));
      if (kind === "inherited") data.mastery = { remote: 9 };
      if (kind === "hidden") Object.defineProperty(data, "review", { get() { hooks++; return {}; } });
      const reads = e.calls.reads.filter(k => k === KEY).length;
      const out = await pull(e, { v: 1, pack: "fixture", updatedAt: T + 900000, data });
      eq(plain(out), { applied: true, keys: 1 }); eq(e.raw("review"), raw);
      eq(e.calls.reads.filter(k => k === KEY).length, reads); eq(hooks, 0); cells++;
    }
  });
  await test("T17 unsupported descriptor and JSON preflight exact precedence", async () => {
    const bads = ["NaN", "Infinity", "undefined", "function(){}", "1n", "Symbol('x')", "new Date()",
      "new Map()", "[,1]", "Object.assign([1],{extra:2})", "(()=>{let o={};o.o=o;return o})()",
      "Object.defineProperty({},'x',{enumerable:true,get(){__hooks++;return 1}})"];
    for (const expression of bads) {
      const e = fixture({ [ID]: { dueAt: 1 } }), before = snapshot(e);
      e.evaluate("globalThis.__hooks=0");
      const incoming = e.evaluate("({unrelated:" + expression + "})");
      held(e, before, await pull(e, response(incoming)), "review-serialization-failed");
      eq(e.c.__hooks, 0);
    }
    const e = fixture("synthetic corrupt bytes", { raw: true }), before = snapshot(e);
    let hooks = 0;
    const r = response(null);
    Object.defineProperty(r.data, "review", { enumerable: true, get() { hooks++; return {}; } });
    held(e, before, await pull(e, r), "review-serialization-failed"); eq(hooks, 0);
    // Raw parsing is faulted only for the exact scoped bytes to model an
    // unsupported in-memory original. Production still executes its real parser.
    for (const expression of bads) {
      const a = fixture({ [ID]: { dueAt: 1 } });
      const b = snapshot(a), raw = a.raw("review");
      a.c.__raw = raw;
      a.evaluate("globalThis.__hooks=0;globalThis.__parse=JSON.parse;globalThis.__original=({toString:{dueAt:1},unrelated:" + expression + "});JSON.parse=function(s){return s===__raw?__original:__parse(s)}");
      try {
        held(a, b, await pull(a, response({ [ID]: {} })), "review-serialization-failed");
        eq(a.c.__hooks, 0);
      } finally { a.evaluate("JSON.parse=__parse"); }
    }
  });
  await test("T17 known memory predecessors versus unknown availability", async () => {
    const unknown = fixture(undefined, { denied: true }), before = snapshot(unknown);
    held(unknown, before, await pull(unknown, response({})), "review-storage-unavailable");
    for (const raw of ['{"toString":{"dueAt":1}}', "null", "synthetic corrupt bytes"]) {
      const e = fixture(raw, { raw: true }); e.core.store.get("review", null); e.deny();
      const b = snapshot(e); held(e, b, await pull(e, response(raw[0] === "{" ? null : { [ID]: {} })));
    }
    const e = fixture({ [ID]: {} }); e.core.store.get("review", null); e.denyWrites();
    const diskBefore = [...e.disk], out = await pull(e, response({ [ID]: { last: 3 } }));
    eq(plain(out), { applied: true, keys: 4 });
    eq(plain(e.core.store.get("review", null)), { [ID]: { last: 3 } });
    eq([...e.disk], diskBefore); check(!e.core.store.isPersistent()); cells++;
    const memory = fixture(undefined, { denied: true });
    memory.core.review.record({ id: ID }, false);
    const m = snapshot(memory);
    held(memory, m, await pull(memory, response(null)));
    const absent = fixture(undefined);
    absent.core.store.get("review", null); absent.deny();
    const durable = [...absent.disk];
    eq(plain(await pull(absent, response(null))), { applied: true, keys: 4 });
    eq(absent.core.store.get("review", "missing"), null); eq([...absent.disk], durable); cells++;
    const equal = fixture(" null ", { raw: true });
    equal.core.store.get("review", null); equal.deny();
    const oldDisk = [...equal.disk];
    eq(plain(await pull(equal, response(null))), { applied: true, keys: 4 });
    eq([...equal.disk], oldDisk); cells++;
  });
  await test("T17/PH-31 preparation and no accepted commit before other writes", async () => {
    const e = fixture({ [ID]: {} }), before = snapshot(e);
    e.evaluate("globalThis.__stringify=JSON.stringify;JSON.stringify=function(){throw Error('synthetic failure')}");
    try { held(e, before, await pull(e, response({ [ID]: { last: 1 } })), "review-serialization-failed"); }
    finally { e.evaluate("JSON.stringify=__stringify"); }
    // Expose only the actual closure's existing memory object in this test
    // instance, then freeze it: no production hook, copied writer or bypass.
    const frozen = fixture({ [ID]: {} }, { coreTransform(source) {
      const anchor = "  var mem = {}, lsOk = false;";
      check(source.split(anchor).length === 2);
      return source.replace(anchor, anchor + "\n  globalThis.__testReviewMemory=mem;");
    } });
    frozen.core.store.get("review", null);
    frozen.evaluate("Object.freeze(__testReviewMemory)"); frozen.denyWrites();
    const f = snapshot(frozen);
    held(frozen, f, await pull(frozen, response({ [ID]: { last: 1 } })), "review-storage-unavailable");
  });
  await test("T17 pending GET uses fresh local predecessor", async () => {
    const e = fixture(undefined);
    e.core.backend.pull = () => e.evaluate("new Promise(resolve=>{globalThis.__resolvePull=resolve})");
    const pending = e.core.sync.pull();
    e.core.review.record({ id: ID }, false);
    const before = snapshot(e);
    e.c.__reply = response({});
    e.evaluate("__resolvePull(__reply)");
    held(e, before, await pending);
  });
  await test("T17 existing gates precede review and preserve selected key count", async () => {
    for (const [reply, reason] of [[null, "empty"], [{ data: 1 }, "empty"],
      [{ data: { review: null }, pack: "other" }, "pack-mismatch"],
      [{ data: { review: null } }, "pack-mismatch"],
      [{ data: { review: null }, pack: "fixture", updatedAt: 17 }, "stale"]]) {
      const e = fixture("synthetic corrupt bytes", { raw: true }), before = snapshot(e);
      held(e, before, await pull(e, reply), reason);
    }
    const e = fixture("synthetic corrupt bytes", { raw: true });
    e.core.backend.configure(null);
    const before = snapshot(e); held(e, before, await e.core.sync.pull(), "no-endpoint");
    const a = fixture(undefined);
    const out = await pull(a, { pack: "fixture", updatedAt: T + 900000,
      data: { mastery: { remote: 9 }, lastSyncApplied: 0, unknown: 1 } });
    eq(plain(out), { applied: true, keys: 1 }); eq(a.core.store.get("unknown", null), null); cells++;
  });
  await test("T17 protected comparison is not a recording or due hold", async () => {
    for (const field of ["last", "seen"]) for (const protectedValue of [{}, []]) {
      const e = fixture({ [ID]: { seen: 2, miss: 1, ok: 1, box: 0, dueAt: 1, [field]: protectedValue } });
      eq(e.core.review.count(), 1);
      const before = snapshot(e);
      held(e, before, await pull(e, response({ [ID]: { last: 9 } })));
      const out = e.core.review.record({ id: ID }, false);
      check(out.outcome === "partial" || out.outcome === "recorded");
      eq(JSON.parse(e.raw("review"))[ID].last, DUE); cells++;
    }
  });
}
async function hooksSuite() {
  await test("T07 scoped array and server output serialization never executes inherited hooks", async () => {
    const e = fixture({ [ID]: { dueAt: 1, extension: [1, { a: 2 }] } });
    e.c.__learning = JSON.stringify({ attempts: 2, correct: 1, selfRated: 0,
      answers: { target: { strength: 2 } }, extension: [1] });
    e.disk.set("aced:fixture:learning_v1", e.c.__learning);
    e.evaluate("globalThis.__hooks=0;Object.defineProperty(Array.prototype,'toJSON',{configurable:true,value:function(){__hooks++;throw Error('must not run')}})");
    try {
      eq(e.core.review.record({ id: ID }, false).outcome, "partial");
      eq(e.record().outcome, "partial");
      check(e.lib.saveLearning("fixture", e.evaluate("({extension:[2]})")));
      eq(e.c.__hooks, 0);
    } finally { e.evaluate("delete Array.prototype.toJSON"); }
    eq(e.prototypeSignature(), e.prototypeBefore);
    const s = serverRealm();
    vm.runInContext(`globalThis.__hooks=0;
      Object.defineProperty(Object.prototype,"toJSON",{configurable:true,value:function(){__hooks++;throw Error("must not run")}});
      Object.defineProperty(Array.prototype,"toJSON",{configurable:true,value:function(){__hooks++;throw Error("must not run")}});
      try {
        globalThis.__result=module.exports.mergeReview({target:{extension:[1]}},{});
        globalThis.__serialized=JSON.stringify(__result);
      } finally { delete Object.prototype.toJSON;delete Array.prototype.toJSON; }`, s);
    eq(s.__hooks, 0); eq(JSON.parse(s.__serialized), { target: { extension: [1] } }); cells++;
  });
}
module.exports = async function run(only) {
  named = 0; cells = 0;
  if (!only || only === "pipeline") await pipelineSuite();
  if (!only || only === "matrix") await matrixSuite();
  if (!only || only === "hooks") await hooksSuite();
  console.log("question-ID inbound: " + named + " named cases / " + cells + " matrix decisions passed (not an assertion total)");
};
