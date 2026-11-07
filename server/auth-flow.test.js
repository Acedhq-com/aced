/* server/auth-flow.test.js — Phase A sign-in, token storage, session and logging tests.
   Zero-dependency (no Express, no database driver). Run: node server/auth-flow.test.js
   Assertions never print compared values, so token fixtures never reach test output. */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  createAuthFlow, checkSession, makeAuthLogger, signInLinkUrl, devLinksAllowed, digest, sameDigest, cleanStates
} = require("./auth-flow");

let pass = 0, fail = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function ok(v, msg) { if (!v) throw new Error(msg || "assertion failed"); }
function same(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(msg || "value mismatch"); }

const APP = "https://app.example.test";
const EMAIL = "learner@example.test";
function newState() { return crypto.randomBytes(24).toString("base64url"); }

/* In-memory database with the same contract as server/db.js (magic + users + sessions).
   consume() is atomic: the first caller removes and receives the row. */
function fakeDb() {
  const magic = new Map(), users = new Map(), revoked = new Map();
  return {
    _magic: magic, _users: users, _revoked: revoked,
    magic: {
      create: async (token, email, expires, state_hash) => { magic.set(token, { email, expires, state_hash }); },
      find: async (token) => (magic.has(token) ? Object.assign({}, magic.get(token)) : null),
      consume: async (token) => { const r = magic.get(token); if (!r) return null; magic.delete(token); return Object.assign({}, r); },
      remove: async (token) => { magic.delete(token); },
      gc: async (cutoff) => { for (const [k, v] of magic) if (v.expires < cutoff) magic.delete(k); }
    },
    users: {
      findByEmail: async (email) => { for (const u of users.values()) if (u.email === email) return Object.assign({}, u); return null; },
      get: async (id) => (users.has(id) ? Object.assign({}, users.get(id)) : null),
      create: async (id, email, ts) => { users.set(id, { id, email, created_at: ts, token_version: 0 }); },
      bumpVersion: async (id) => { const u = users.get(id); if (u) u.token_version = Number(u.token_version || 0) + 1; }
    },
    sessions: {
      revoke: async (sid, expires) => { if (!revoked.has(sid)) revoked.set(sid, expires); },
      isRevoked: async (sid) => revoked.has(sid),
      gc: async (cutoff) => { for (const [k, v] of revoked) if (v < cutoff) revoked.delete(k); }
    }
  };
}

/* A flow wired to the fake database, a captured mailer and captured log lines.
   signSession returns an opaque three-part string and records the claims it was given. */
function harness(opts) {
  opts = opts || {};
  const db = fakeDb(), logs = [], mails = [], claims = [];
  let clock = opts.now || 1700000000000;
  const flow = createAuthFlow({
    db,
    log: makeAuthLogger(function (line) { logs.push(line); }),
    now: function () { return clock; },
    isValidEmail: function (s) { return typeof s === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); },
    signSession: function (c) { claims.push(c); return "hdr." + crypto.randomBytes(12).toString("base64url") + ".sig"; },
    sendMagicLink: opts.sendMagicLink || (async function (to, link) { mails.push({ to, link }); }),
    appUrl: APP,
    devLinks: !!opts.devLinks
  });
  return { flow, db, logs, mails, claims, advance: function (ms) { clock += ms; }, now: function () { return clock; } };
}
function settle() { return new Promise(function (r) { setTimeout(r, 0); }); }
function tokenFrom(link) { const m = /#signin=([a-f0-9]{48})$/.exec(link); return m ? m[1] : null; }

async function requestLink(h, state) {
  const out = await h.flow.request({ email: EMAIL, state }, crypto.randomUUID());
  await settle();
  return { out, token: tokenFrom(h.mails[h.mails.length - 1].link) };
}
function secretsAbsent(haystack, secrets, label) {
  secrets.filter(Boolean).forEach(function (s, i) { ok(haystack.indexOf(s) < 0, label + ": sensitive value #" + i + " must be absent"); });
}

/* ---------- link-scanner resistance ---------- */
test("the emailed link points at the static app fragment, never at an API URL", async function () {
  const h = harness();
  const { out, token } = await requestLink(h, newState());
  same(out.status, 200);
  ok(token, "link carries a 48-hex one-time token in #signin=");
  const link = h.mails[0].link;
  ok(link.indexOf(APP + "/#signin=") === 0, "link is APP_URL/#signin=");
  ok(link.indexOf("?") < 0, "no query string: nothing reaches a server when the link is fetched");
  ok(link.indexOf("state=") < 0, "the browser state is never put in the link");
});

test("a scanner GET of a legacy /auth/verify URL touches nothing and the token stays redeemable", async function () {
  const h = harness();
  const state = newState();
  const { token } = await requestLink(h, state);
  const before = JSON.stringify([...h.db._magic.entries()]);
  const got = h.flow.legacyVerify(crypto.randomUUID());
  same(got.status, 410, "legacy GET answers 410");
  ok(!/session|token=/i.test(got.text), "no credential in the response");
  same(JSON.stringify([...h.db._magic.entries()]), before, "nothing consumed or changed");
  same(h.claims.length, 0, "no session minted by a GET");
  const r = await h.flow.redeem({ token, states: [state] }, crypto.randomUUID());
  same(r.status, 200, "the user's intentional redeem still works afterwards");
});

/* ---------- redeem: intentional same-browser action ---------- */
test("valid token + matching browser state redeems once and mints a session with a session id", async function () {
  const h = harness();
  const state = newState();
  const { token } = await requestLink(h, state);
  const r = await h.flow.redeem({ token, states: [newState(), state] }, crypto.randomUUID());
  same(r.status, 200);
  ok(typeof r.body.session === "string" && r.body.session.split(".").length === 3, "session returned");
  same(h.claims.length, 1);
  ok(typeof h.claims[0].sid === "string" && h.claims[0].sid.length >= 32, "session carries a random sid for revocation");
  same(h.claims[0].tv, 0);
  same(h.db._magic.size, 0, "token row consumed");
});

test("missing browser state fails closed and does not consume the token", async function () {
  const h = harness();
  const state = newState();
  const { token } = await requestLink(h, state);
  for (const states of [undefined, [], "x", [123], [state, state, state, state, state, state]]) {
    const r = await h.flow.redeem({ token, states }, crypto.randomUUID());
    same(r.status, 400); same(r.body, { error: "link_unusable" });
  }
  same(h.db._magic.size, 1, "token still pending");
  same((await h.flow.redeem({ token, states: [state] })).status, 200, "correct browser can still use it");
});

test("mismatched browser state fails closed and does not consume the token", async function () {
  const h = harness();
  const state = newState();
  const { token } = await requestLink(h, state);
  const r = await h.flow.redeem({ token, states: [newState(), newState()] }, crypto.randomUUID());
  same(r.status, 400); same(r.body, { error: "link_unusable" });
  same(h.db._magic.size, 1, "a wrong-browser attempt must not burn the link");
  same(h.claims.length, 0, "no session minted");
});

test("malformed and invalid tokens fail closed", async function () {
  const h = harness();
  const state = newState();
  await requestLink(h, state);
  for (const token of [undefined, "", "abc", "Z".repeat(48), "a".repeat(47), "a".repeat(49), { t: 1 }, crypto.randomBytes(24).toString("hex")]) {
    const r = await h.flow.redeem({ token, states: [state] }, crypto.randomUUID());
    same(r.status, 400); same(r.body, { error: "link_unusable" });
  }
  same(h.claims.length, 0);
});

test("expired token fails closed", async function () {
  const h = harness();
  const state = newState();
  const { token } = await requestLink(h, state);
  h.advance(15 * 60 * 1000 + 1);
  const r = await h.flow.redeem({ token, states: [state] }, crypto.randomUUID());
  same(r.status, 400); same(r.body, { error: "link_unusable" });
  same(h.claims.length, 0);
});

test("replayed token fails closed, including two concurrent redeems", async function () {
  const h = harness();
  const state = newState();
  const { token } = await requestLink(h, state);
  const both = await Promise.all([
    h.flow.redeem({ token, states: [state] }, crypto.randomUUID()),
    h.flow.redeem({ token, states: [state] }, crypto.randomUUID())
  ]);
  same(both.filter(function (r) { return r.status === 200; }).length, 1, "exactly one concurrent redeem wins");
  const again = await h.flow.redeem({ token, states: [state] }, crypto.randomUUID());
  same(again.status, 400); same(again.body, { error: "link_unusable" });
  same(h.claims.length, 1, "only one session ever minted");
});

test("every refusal is indistinguishable (non-enumerating)", async function () {
  const h = harness();
  const state = newState();
  const a = await requestLink(h, state);
  const b = await requestLink(h, state);
  h.advance(1);
  const used = await h.flow.redeem({ token: b.token, states: [state] });
  same(used.status, 200);
  const cases = [
    await h.flow.redeem({ token: "nope", states: [state] }),
    await h.flow.redeem({ token: crypto.randomBytes(24).toString("hex"), states: [state] }),
    await h.flow.redeem({ token: a.token, states: [newState()] }),
    await h.flow.redeem({ token: a.token }),
    await h.flow.redeem({ token: b.token, states: [state] })
  ];
  cases.forEach(function (r, i) { same([r.status, r.body], [400, { error: "link_unusable" }], "refusal " + i + " looks the same"); });
});

/* ---------- token storage ---------- */
test("the raw one-time token and raw state are absent from persistence", async function () {
  const h = harness();
  const state = newState();
  const { token } = await requestLink(h, state);
  const persisted = JSON.stringify([...h.db._magic.entries()]);
  secretsAbsent(persisted, [token, state], "persistence");
  ok(h.db._magic.has(digest(token)), "row keyed by SHA-256 digest of the token");
  ok(h.db._magic.get(digest(token)).state_hash === digest(state), "state stored as digest");
  ok(!/^[a-f0-9]{64}$/.test(token), "fixture sanity: raw token is not itself a digest");
});

test("digests compare in constant time and reject length or type mismatches", function () {
  const d = digest("x");
  ok(sameDigest(d, digest("x")));
  ok(!sameDigest(d, digest("y")));
  ok(!sameDigest(d, d.slice(1)));
  ok(!sameDigest(d, null));
  ok(!sameDigest("", ""));
});

/* ---------- logging ---------- */
test("logs never contain the email, raw token, state, link, session or digests", async function () {
  const failing = harness({ sendMagicLink: async function () { throw new Error("provider said: " + EMAIL); } });
  const h = harness({ devLinks: true });
  const state = newState();
  const { out, token } = await requestLink(h, state);
  const r = await h.flow.redeem({ token, states: [state] }, crypto.randomUUID());
  await h.flow.redeem({ token, states: [state] }, crypto.randomUUID());
  await h.flow.request({ email: "not-an-email", state }, crypto.randomUUID());
  await failing.flow.request({ email: EMAIL, state }, crypto.randomUUID());
  await settle();
  const all = h.logs.concat(failing.logs).join("\n");
  ok(h.logs.length >= 4 && failing.logs.length >= 2, "outcomes were logged");
  secretsAbsent(all, [EMAIL, token, state, h.mails[0].link, out.body.devLink, r.body.session, digest(token), digest(state), "#signin=", "@"], "logs");
  ok(/email_send_failed/.test(all), "delivery failure logged as an outcome code only");
});

test("log lines contain only ts, rid, route and allowlisted outcome", function () {
  const lines = [];
  const log = makeAuthLogger(function (l) { lines.push(l); });
  const rid = crypto.randomUUID();
  log("auth_redeem", "redeemed", rid);
  log("auth_redeem", EMAIL, rid);                     // not allowlisted -> replaced
  log("https://app.example.test/#signin=" + "a".repeat(48), "redeemed", "Bearer x.y.z");
  const parsed = lines.map(function (l) { return JSON.parse(l); });
  parsed.forEach(function (o) { same(Object.keys(o).sort(), ["outcome", "rid", "route", "ts"]); });
  same(parsed[0].rid, rid); same(parsed[0].outcome, "redeemed");
  same(parsed[1].outcome, "other");
  same(parsed[2].route, "other"); same(parsed[2].rid, "-");
  secretsAbsent(lines.join("\n"), [EMAIL, "signin=", "Bearer"], "logger");
});

test("server.js and email.js log no sensitive identifiers (static check)", function () {
  const banned = /\b(email|to|link|token|tok|session|state|text|body|subject|payload|err|e)\b/;
  ["server.js", "email.js", "db.js"].forEach(function (f) {
    const src = fs.readFileSync(path.join(__dirname, f), "utf8");
    src.split("\n").forEach(function (line, i) {
      if (!/console\.(log|info|warn|error|debug)\s*\(/.test(line)) return;
      if (/\[stripe\]|\[webhook\]/.test(line)) return;      // billing routes are out of Phase A scope
      const code = line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""')
        .replace(/\be\.(code|name)\b|\be\s*&&/g, "");       // error codes/names are allowed
      ok(!banned.test(code.slice(code.indexOf("console."))), f + ":" + (i + 1) + " logs a sensitive identifier");
    });
  });
  const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  ok(!/magic link issued for/.test(server), "email-address log line removed");
  ok(!/\[unhandled\]", \(err/.test(server), "raw error messages no longer logged");
});

/* ---------- dev link exposure ---------- */
test("dev links are returned only for a local, non-production APP_URL", async function () {
  ok(devLinksAllowed({ APP_URL: "http://localhost:5500" }));
  ok(devLinksAllowed({ APP_URL: "http://127.0.0.1:8080" }));
  ok(devLinksAllowed({}));
  ok(!devLinksAllowed({ NODE_ENV: "production", APP_URL: "http://localhost:5500" }));
  ok(!devLinksAllowed({ APP_URL: "https://acedhq.com" }), "deployed host without NODE_ENV still never leaks the link");
  ok(!devLinksAllowed({ APP_URL: "not a url" }));
  const h = harness({ devLinks: false });
  const { out } = await requestLink(h, newState());
  same(Object.keys(out.body), ["ok"], "no devLink in the response");
});

test("request validates email and state before storing anything", async function () {
  const h = harness();
  same((await h.flow.request({ email: "bad", state: newState() })).status, 400);
  same((await h.flow.request({ email: EMAIL })).status, 400);
  same((await h.flow.request({ email: EMAIL, state: "short" })).status, 400);
  same((await h.flow.request(null)).status, 400);
  same(h.db._magic.size, 0); same(h.mails.length, 0);
});

/* ---------- sessions ---------- */
test("checkSession: valid, expired, missing exp, revoked, version-bumped, no account", function () {
  const now = 1700000000000, exp = now / 1000 + 3600, user = { id: "u1", token_version: 0 };
  same(checkSession({ sub: "u1", tv: 0, exp }, user, false, now), null);
  same(checkSession({ sub: "u1", tv: 0, exp: now / 1000 - 1 }, user, false, now), "session_expired");
  same(checkSession({ sub: "u1", tv: 0 }, user, false, now), "session_invalid");
  same(checkSession({ sub: "u1", tv: 0, exp: "9999999999" }, user, false, now), "session_invalid");
  same(checkSession({ tv: 0, exp }, user, false, now), "session_invalid");
  same(checkSession(null, user, false, now), "session_invalid");
  same(checkSession({ sub: "u1", tv: 0, exp }, user, true, now), "session_revoked");
  same(checkSession({ sub: "u1", tv: 0, exp }, { id: "u1", token_version: 1 }, false, now), "session_revoked");
  same(checkSession({ sub: "u1", exp }, user, false, now), null, "legacy token without tv still valid until a bump");
  same(checkSession({ sub: "u1", tv: 0, exp }, null, false, now), "no_account");
});

test("sign-out revokes exactly the presented session; replay after sign-out fails", async function () {
  const h = harness();
  const state = newState();
  const { token } = await requestLink(h, state);
  await h.flow.redeem({ token, states: [state] });
  const c = h.claims[0];
  const payload = { sub: c.sub, tv: c.tv, sid: c.sid, exp: Math.floor(h.now() / 1000) + 3600 };
  const user = await h.db.users.get(c.sub);
  same(checkSession(payload, user, await h.db.sessions.isRevoked(payload.sid), h.now()), null, "valid before sign-out");
  const out = await h.flow.signout(payload, crypto.randomUUID());
  same(out.body, { ok: true, revoked: true });
  same(checkSession(payload, user, await h.db.sessions.isRevoked(payload.sid), h.now()), "session_revoked", "replay after sign-out refused");
  const other = Object.assign({}, payload, { sid: crypto.randomBytes(16).toString("hex") });
  same(checkSession(other, user, await h.db.sessions.isRevoked(other.sid), h.now()), null, "other devices unaffected");
  same((await h.flow.signout({ sub: c.sub, exp: payload.exp })).body, { ok: true, revoked: false }, "legacy token: honest about not revoking");
  await h.db.sessions.gc(payload.exp * 1000 + 1);
  same(h.db._revoked.size, 0, "revocations are purged once the token would have expired");
});

test("cleanStates enforces shape and the 5-state cap", function () {
  const s = newState();
  same(cleanStates([s]), [s]);
  same(cleanStates([s, s, s, s, s]).length, 5);
  same(cleanStates([s, s, s, s, s, s]), null);
  same(cleanStates([s, "bad"]), null);
  same(cleanStates(s), null);
  same(signInLinkUrl("https://a.test/", "ab"), "https://a.test/#signin=ab");
});

(async function run() {
  for (const t of tests) {
    try { await t.fn(); pass++; }
    catch (err) { fail++; console.log("FAIL: " + t.name + "\n  " + (err && err.message)); }
  }
  console.log("\nauth-flow.test.js: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
