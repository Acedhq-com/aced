/* aced-account-session.test.js — Phase A client tests: scanner-safe sign-in confirmation,
   sign-out revocation and account-switch isolation. Zero-dependency.
   Run: node aced-account-session.test.js   (exit 0 = all pass)
   Assertions never echo compared values: fixtures must not appear in test output. */
"use strict";
var nodeAssert = require("assert");
var assert = {
  strictEqual: function (a, b, msg) { if (a !== b) throw new Error(msg || "value mismatch"); },
  deepStrictEqual: function (a, b, msg) { try { nodeAssert.deepStrictEqual(a, b); } catch (e) { throw new Error(msg || "structure mismatch"); } },
  ok: function (v, msg) { if (!v) throw new Error(msg || "assertion failed"); }
};
var modPath = require.resolve("./aced-account.js");

// Synthetic fixtures. Session fixtures are three-part strings whose middle part decodes to
// {"sub": ...} so the account-switch guard can read the account; they are not real tokens.
function b64u(s) { return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function sess(sub, n) { return ["fixture", b64u(JSON.stringify({ sub: sub, n: n || 1 })), "sig"].join("."); }
var SESSION_A = sess("acct-a"), SESSION_B = sess("acct-b"), SESSION_A2 = sess("acct-a", 2);
var CODE = "0123456789abcdef0123456789abcdef0123456789abcdef";     // 48 hex, fixture only
var STATE = "realrealrealrealrealreal00";
var EMAIL = "someone@example.test";
var API = "https://api.example.test";
function pending(s, ttl) { return JSON.stringify([{ s: s, exp: Date.now() + (ttl == null ? 60000 : ttl) }]); }

function fakeDocument() {
  function el(tag) {
    var n = { tagName: String(tag).toUpperCase(), children: [], attrs: {}, style: {}, textContent: "", parentNode: null, id: "" };
    n.setAttribute = function (k, v) { n.attrs[k] = String(v); };
    n.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(n.attrs, k) ? n.attrs[k] : null; };
    n.appendChild = function (c) { c.parentNode = n; n.children.push(c); return c; };
    n.insertBefore = function (c, ref) { c.parentNode = n; var i = n.children.indexOf(ref); if (i < 0) n.children.push(c); else n.children.splice(i, 0, c); return c; };
    n.removeChild = function (c) { var i = n.children.indexOf(c); if (i >= 0) n.children.splice(i, 1); c.parentNode = null; return c; };
    Object.defineProperty(n, "firstChild", { get: function () { return n.children[0] || null; } });
    return n;
  }
  function find(n, pred) { if (pred(n)) return n; for (var i = 0; i < n.children.length; i++) { var r = find(n.children[i], pred); if (r) return r; } return null; }
  var doc = {
    body: el("body"),
    createElement: el,
    getElementById: function (id) { return find(doc.body, function (x) { return x.id === id; }); },
    addEventListener: function () {},
    _find: function (pred) { return find(doc.body, pred); },
    _text: function (n) { var s = n.textContent || ""; n.children.forEach(function (c) { s += " " + doc._text(c); }); return s; }
  };
  return doc;
}

/* One page load. `server` answers fetch calls by path; every call is recorded. Console output
   is captured for the whole test (including async work), not just the synchronous load. */
var logs = [];
function env(hash, mem, opts) {
  opts = opts || {};
  mem = mem || {};
  var replaced = [], coreCalls = [], fetches = [];
  var storage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; }
  };
  var be = { endpoint: null };
  var core = {
    backend: { configure: function (c) { be.endpoint = c && c.endpoint; coreCalls.push(c && c.endpoint ? "configure" : "reset"); }, isEnabled: function () { return !!be.endpoint; } },
    sync: {
      isEnabled: function () { return !!be.endpoint; },
      push: function () { coreCalls.push("push"); return Promise.resolve({}); },
      pull: function () { coreCalls.push("pull"); return Promise.resolve({ applied: false }); }
    }
  };
  var server = opts.server || {};
  global.fetch = function (url, init) {
    var p = String(url).replace(API, "");
    var rec = { path: p, method: (init && init.method) || "GET", headers: (init && init.headers) || {}, body: init && init.body ? JSON.parse(init.body) : null };
    fetches.push(rec);
    var h = server[p];
    if (!h) return Promise.resolve({ status: 404, json: function () { return Promise.resolve({}); } });
    if (h === "network-error") return Promise.reject(new Error("offline"));
    var out = typeof h === "function" ? h(rec) : h;
    return Promise.resolve({ status: out.status, json: function () { return Promise.resolve(out.body || {}); } });
  };
  global.window = { localStorage: storage, ACED_API_URL: API, crypto: require("crypto").webcrypto, ACEDCore: core };
  global.ACEDCore = core;
  global.location = { hash: hash || "", search: opts.search || "", pathname: "/", href: "https://app.example.test/" + (hash || "") };
  global.history = { replaceState: function (a, b, url) { replaced.push(url); global.location.hash = ""; } };
  global.document = fakeDocument();
  delete require.cache[modPath];
  require("./aced-account.js");
  return { mem: mem, replaced: replaced, coreCalls: coreCalls, fetches: fetches, doc: global.document, A: global.window.ACEDAccount };
}
function byId(e, id) { return e.doc._find(function (n) { return n.id === id; }); }
function settle() { return new Promise(function (r) { setTimeout(r, 0); }); }
function okRedeem(session) { return { status: 200, body: { ok: true, session: session } }; }
var REFUSED = { status: 400, body: { error: "link_unusable" } };

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

/* ---------- scanner / preview / prefetch ---------- */
test("loading the emailed link authenticates nothing until the user confirms", function () {
  var e = env("#signin=" + CODE, { aced_auth_state: pending(STATE) }, { server: { "/auth/redeem": okRedeem(SESSION_A) } });
  assert.deepStrictEqual(e.replaced, ["/"], "fragment scrubbed immediately");
  assert.strictEqual(global.location.hash, "", "no auth material left in the URL");
  assert.ok(e.A.signInPending(), "waiting for an intentional action");
  assert.strictEqual(e.mem.aced_session, undefined, "no session from a page load");
  var box = byId(e, "aced-signin-confirm");
  assert.ok(box && box.getAttribute("role") === "dialog", "confirmation dialog shown");
  return settle().then(function () {
    assert.deepStrictEqual(e.fetches, [], "no network request without the click");
    assert.deepStrictEqual(e.coreCalls, [], "no sync while confirmation is pending");
  });
});

test("an automated fetch without this browser's pending state is refused locally (no request)", function () {
  var e = env("#signin=" + CODE, {}, { server: { "/auth/redeem": okRedeem(SESSION_A) } });
  assert.ok(!e.A.signInPending());
  assert.ok(e.A.signInNotice(), "neutral notice");
  assert.ok(byId(e, "aced-signin-notice"));
  assert.strictEqual(byId(e, "aced-signin-confirm"), null, "no confirm prompt");
  return e.A.confirmSignIn().then(function (r) {
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(e.fetches, [], "nothing sent");
    assert.strictEqual(e.mem.aced_session, undefined);
  });
});

test("expired pending state is treated as missing", function () {
  var e = env("#signin=" + CODE, { aced_auth_state: pending(STATE, -1) });
  assert.ok(e.A.signInNotice());
  assert.ok(!e.A.signInPending());
});

test("malformed sign-in code is refused locally", function () {
  ["#signin=", "#signin=xyz", "#signin=" + CODE.toUpperCase(), "#signin=" + CODE + "00"].forEach(function (h) {
    var e = env(h, { aced_auth_state: pending(STATE) });
    assert.ok(e.A.signInNotice(), "refused");
    assert.deepStrictEqual(e.replaced, ["/"], "scrubbed");
  });
});

/* ---------- intentional same-browser action ---------- */
test("confirming sends the code and pending states (never a session) and signs in once", function () {
  var e = env("#signin=" + CODE, { aced_auth_state: pending(STATE), aced_session: SESSION_A2 }, { server: { "/auth/redeem": okRedeem(SESSION_A) } });
  return e.A.confirmSignIn().then(function (r) {
    assert.strictEqual(r.ok, true);
    assert.strictEqual(e.fetches.length, 1);
    var f = e.fetches[0];
    assert.strictEqual(f.path, "/auth/redeem"); assert.strictEqual(f.method, "POST");
    assert.deepStrictEqual(f.body, { token: CODE, states: [STATE] }, "code + this browser's states only");
    assert.strictEqual(f.headers.Authorization, undefined, "existing session never sent with redeem");
    assert.strictEqual(e.mem.aced_session, SESSION_A, "session stored");
    assert.strictEqual(e.mem.aced_auth_state, undefined, "pending states cleared");
    assert.strictEqual(byId(e, "aced-signin-confirm"), null, "dialog removed");
    assert.strictEqual(e.A.signInNotice(), null);
    return e.A.ready();
  }).then(function () {
    assert.deepStrictEqual(e.coreCalls, ["configure", "push", "pull"], "sync starts after a confirmed sign-in");
    return e.A.confirmSignIn();
  }).then(function (again) {
    assert.strictEqual(again.ok, false, "second confirm does nothing");
    assert.strictEqual(e.fetches.length, 1);
  });
});

test("the confirm button triggers the same redeem", function () {
  var e = env("#signin=" + CODE, { aced_auth_state: pending(STATE) }, { server: { "/auth/redeem": okRedeem(SESSION_A) } });
  var btn = e.doc._find(function (n) { return n.tagName === "BUTTON" && n.textContent === "Sign in"; });
  assert.ok(btn && typeof btn.onclick === "function");
  btn.onclick();
  return settle().then(settle).then(function () {
    assert.strictEqual(e.fetches.length, 1);
    assert.strictEqual(e.mem.aced_session, SESSION_A);
  });
});

test("cancel sends nothing and resumes the existing session's sync", function () {
  var e = env("#signin=" + CODE, { aced_auth_state: pending(STATE), aced_session: SESSION_A }, { server: { "/auth/redeem": okRedeem(SESSION_B) } });
  var btn = e.doc._find(function (n) { return n.tagName === "BUTTON" && n.textContent === "Cancel"; });
  btn.onclick();
  return e.A.ready().then(function () {
    assert.deepStrictEqual(e.fetches, [], "no redeem");
    assert.strictEqual(e.mem.aced_session, SESSION_A);
    assert.deepStrictEqual(e.coreCalls, ["configure", "push", "pull"]);
  });
});

/* ---------- server refusals (invalid, expired, replayed, mismatched) ---------- */
test("server refusal keeps the existing session, uploads nothing and shows the neutral notice", function () {
  var e = env("#signin=" + CODE, { aced_auth_state: pending(STATE), aced_session: SESSION_A }, { server: { "/auth/redeem": REFUSED } });
  return e.A.confirmSignIn().then(function (r) {
    assert.strictEqual(r.ok, false);
    assert.strictEqual(e.mem.aced_session, SESSION_A, "existing valid session preserved");
    assert.ok(e.mem.aced_auth_state, "pending state kept for the right link");
    assert.ok(e.A.signInNotice() && byId(e, "aced-signin-notice"));
    return settle();
  }).then(function () {
    assert.deepStrictEqual(e.coreCalls, [], "no progress upload after a rejected sign-in");
  });
});

test("network failure and malformed server responses fail closed", function () {
  var cases = [
    "network-error",
    { status: 200, body: { ok: true } },
    { status: 200, body: { ok: true, session: "not a jwt" } },
    { status: 500, body: {} }
  ];
  return cases.reduce(function (p, answer) {
    return p.then(function () {
      var e = env("#signin=" + CODE, { aced_auth_state: pending(STATE) }, { server: { "/auth/redeem": answer } });
      return e.A.confirmSignIn().then(function (r) {
        assert.strictEqual(r.ok, false);
        assert.strictEqual(e.mem.aced_session, undefined);
        assert.ok(e.A.signInNotice());
        return settle().then(function () { assert.deepStrictEqual(e.coreCalls, []); });
      });
    });
  }, Promise.resolve());
});

test("the confirm prompt and refusal text contain no code, state, session or email", function () {
  var e = env("#signin=" + CODE, { aced_auth_state: pending(STATE) }, { server: { "/auth/redeem": REFUSED } });
  var shown = e.doc._text(byId(e, "aced-signin-confirm"));
  return e.A.confirmSignIn().then(function () {
    shown += " " + e.doc._text(byId(e, "aced-signin-notice"));
    [CODE, STATE, SESSION_A, EMAIL, "@"].forEach(function (s, i) { assert.ok(shown.indexOf(s) < 0, "UI text must not include sensitive value #" + i); });
    assert.strictEqual(e.doc._find(function (x) { return Object.prototype.hasOwnProperty.call(x, "innerHTML"); }), null, "no innerHTML");
  });
});

/* ---------- logout ---------- */
test("signOut removes the local session, stops sync and revokes the token server-side", function () {
  var e = env("", { aced_session: SESSION_A }, { server: { "/auth/signout": { status: 200, body: { ok: true, revoked: true } } } });
  return e.A.ready().then(function () {
    e.coreCalls.length = 0;
    return e.A.signOut();
  }).then(function (r) {
    assert.strictEqual(e.mem.aced_session, undefined, "local session removed");
    assert.ok(!e.A.isSignedIn());
    assert.strictEqual(e.A.token(), null);
    assert.deepStrictEqual(e.coreCalls, ["reset"], "backend endpoint cleared: no further sync");
    assert.strictEqual(e.fetches[e.fetches.length - 1].path, "/auth/signout");
    assert.strictEqual(e.fetches[e.fetches.length - 1].headers.Authorization, "Bearer " + SESSION_A, "revokes the session being dropped");
    assert.strictEqual(r.revoked, true);
  });
});

test("signOut still clears locally when the server is unreachable", function () {
  var e = env("", { aced_session: SESSION_A }, { server: { "/auth/signout": "network-error" } });
  return e.A.signOut().then(function (r) {
    assert.strictEqual(e.mem.aced_session, undefined);
    assert.strictEqual(r.ok, true); assert.strictEqual(r.revoked, false);
  });
});

test("a revoked or expired session (401) is dropped and falls back to local play", function () {
  var e = env("", { aced_session: SESSION_A }, { server: { "/entitlements": { status: 401, body: { error: "session revoked" } } } });
  return e.A.entitlements().then(function (list) {
    assert.deepStrictEqual(list, []);
    assert.strictEqual(e.mem.aced_session, undefined, "unusable session removed");
  });
});

test("signOutEverywhere also stops sync", function () {
  var e = env("", { aced_session: SESSION_A }, { server: { "/auth/signout-all": { status: 200, body: { ok: true } } } });
  return e.A.ready().then(function () { e.coreCalls.length = 0; return e.A.signOutEverywhere(); }).then(function () {
    assert.strictEqual(e.mem.aced_session, undefined);
    assert.deepStrictEqual(e.coreCalls, ["reset"]);
  });
});

/* ---------- account switching ---------- */
test("first signed-in account adopts this browser's progress and syncs", function () {
  var e = env("", { aced_session: SESSION_A });
  return e.A.ready().then(function () {
    assert.strictEqual(e.mem.aced_sync_owner, "acct-a");
    assert.deepStrictEqual(e.coreCalls, ["configure", "push", "pull"]);
    assert.strictEqual(e.A.syncHeld(), false);
  });
});

test("same account signing in again keeps syncing", function () {
  var e = env("", { aced_session: SESSION_A2, aced_sync_owner: "acct-a" });
  return e.A.ready().then(function () { assert.deepStrictEqual(e.coreCalls, ["configure", "push", "pull"]); });
});

test("a different account never receives or overwrites another account's local progress", function () {
  var mem = { aced_session: SESSION_B, aced_sync_owner: "acct-a", "aced:world-capitals:review": "{\"q\":1}" };
  var e = env("", mem);
  return e.A.ready().then(settle).then(function () {
    assert.deepStrictEqual(e.coreCalls, [], "no configure, no push, no pull");
    assert.ok(e.A.syncHeld(), "sync held");
    assert.strictEqual(e.mem["aced:world-capitals:review"], "{\"q\":1}", "local history untouched");
    assert.strictEqual(e.mem.aced_sync_owner, "acct-a", "ownership unchanged");
    assert.ok(e.A.isSignedIn(), "the user is still signed in");
  });
});

test("switching accounts through a confirmed link does not replay the previous account's state", function () {
  var e = env("#signin=" + CODE, { aced_auth_state: pending(STATE), aced_session: SESSION_A, aced_sync_owner: "acct-a" },
    { server: { "/auth/redeem": okRedeem(SESSION_B) } });
  return e.A.confirmSignIn().then(function (r) {
    assert.strictEqual(r.ok, true);
    return e.A.ready();
  }).then(settle).then(function () {
    assert.strictEqual(e.mem.aced_session, SESSION_B);
    assert.deepStrictEqual(e.coreCalls, [], "account A's local progress is not pushed into account B");
    assert.ok(e.A.syncHeld());
  });
});

test("sign-out then a different account: still held (owner survives sign-out)", function () {
  var e = env("", { aced_session: SESSION_A });
  return e.A.ready().then(function () { return e.A.signOut(); }).then(function () {
    var mem = e.mem; mem.aced_session = SESSION_B;
    var next = env("", mem);
    return next.A.ready().then(function () {
      assert.deepStrictEqual(next.coreCalls, []);
      assert.ok(next.A.syncHeld());
    });
  });
});

/* ---------- anonymous play and privacy ---------- */
test("anonymous page load: no network, no sync, no notices", function () {
  var e = env("", {});
  return settle().then(function () {
    assert.deepStrictEqual(e.fetches, []);
    assert.deepStrictEqual(e.coreCalls, []);
    assert.strictEqual(e.A.signInNotice(), null);
    assert.ok(!e.A.signInPending());
    assert.ok(!e.A.isSignedIn());
  });
});

test("nothing is logged during any of the flows above", function () {
  assert.deepStrictEqual(logs, [], "no console output from aced-account.js");
});

(async function run() {
  var saved = {};
  ["log", "info", "warn", "error", "debug"].forEach(function (k) { saved[k] = console[k]; console[k] = function () { logs.push(Array.prototype.join.call(arguments, " ")); }; });
  var results = [];
  for (var i = 0; i < tests.length; i++) {
    try { await tests[i].fn(); results.push(null); }
    catch (err) { results.push(tests[i].name + "\n  " + (err && err.message)); }
    await settle();
  }
  Object.keys(saved).forEach(function (k) { console[k] = saved[k]; });
  var pass = 0, fail = 0;
  results.forEach(function (r) { if (r) { fail++; console.log("FAIL: " + r); } else pass++; });
  console.log("\naced-account-session.test.js: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
