/* server/auth-flow.js — magic-link sign-in, session checks and privacy-safe auth logging.
   ============================================================================
   Pure request logic with injected dependencies (database, session signer, mailer,
   logger), so it is unit-tested without Express or any npm package:
     node server/auth-flow.test.js

   Sign-in flow (Phase A hardening):
     1. POST /auth/request {email, state}
        Stores only SHA-256 digests of the one-time token and the browser state.
        The emailed link points at the static app: APP_URL/#signin=<token>. A
        fragment is never sent to any server, so fetching or previewing the link
        (mail scanners, link unfurlers) reaches only static files and cannot touch
        the API, consume the token or obtain a session.
     2. The app, in the browser that holds a pending state, asks the user to
        confirm. Only that click sends POST /auth/redeem {token, states}.
     3. /auth/redeem checks the token digest, expiry and that one of the browser's
        pending states matches the stored state digest BEFORE consuming. The
        consume is an atomic delete, so a token is redeemable exactly once.
   Every refusal returns the same body ({error:"link_unusable"}, HTTP 400), so a
   caller learns nothing about whether an email, account, token or session exists.

   Logging: only allowlisted route ids and outcome codes, a timestamp and a
   per-request random id are written. Emails, tokens, digests, states, links,
   sessions and error messages are never logged.
   ============================================================================ */
"use strict";
const crypto = require("crypto");
const { cleanAuthState } = require("./sync-auth-guards");

const MAGIC_TTL_MS = 15 * 60 * 1000;
const MAGIC_TOKEN_RE = /^[a-f0-9]{48}$/;          // 24 random bytes, hex
const MAX_PENDING_STATES = 5;                       // matches the client's pending-state cap
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const LOG_ROUTES = new Set([
  "auth_request", "auth_redeem", "auth_verify_legacy", "auth_signout", "auth_signout_all", "auth_session", "server"
]);
const LOG_OUTCOMES = new Set([
  "link_issued", "email_sent", "email_send_failed", "invalid_email", "invalid_state", "store_error",
  "malformed", "missing_state", "not_found", "expired", "state_mismatch", "replayed", "redeemed",
  "legacy_link", "signed_out", "signed_out_legacy", "revoked_all",
  "no_token", "bad_token", "session_invalid", "session_expired", "no_account", "session_revoked",
  "unhandled_error"
]);
const LINK_UNUSABLE = Object.freeze({ error: "link_unusable" });

function digest(value) { return crypto.createHash("sha256").update(String(value), "utf8").digest("hex"); }

// Constant-time comparison of two hex digests of equal length.
function sameDigest(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || !a.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function newRequestId() { return crypto.randomUUID(); }

// Structured operational log line. Anything outside the allowlists is replaced, so a
// caller can never smuggle an email, token or URL into the log through these fields.
function makeAuthLogger(sink) {
  const write = typeof sink === "function" ? sink : function (line) { console.log(line); };
  return function authLog(route, outcome, requestId) {
    write(JSON.stringify({
      ts: new Date().toISOString(),
      rid: typeof requestId === "string" && REQUEST_ID_RE.test(requestId) ? requestId : "-",
      route: LOG_ROUTES.has(route) ? route : "other",
      outcome: LOG_OUTCOMES.has(outcome) ? outcome : "other"
    }));
  };
}

// The emailed link: static app + fragment. Never an API URL with the token in a query.
function signInLinkUrl(appUrl, token) { return String(appUrl).replace(/\/+$/, "") + "/#signin=" + token; }

// The link is returned in the API response only for a local, non-production server, so a
// production deploy that forgets NODE_ENV still never hands a credential to the caller.
function devLinksAllowed(env) {
  env = env || {};
  if (env.NODE_ENV === "production") return false;
  let host;
  try { host = new URL(env.APP_URL || "http://localhost:5500").hostname; } catch (e) { return false; }
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function cleanStates(v) {
  if (!Array.isArray(v) || !v.length || v.length > MAX_PENDING_STATES) return null;
  const out = [];
  for (const s of v) { const c = cleanAuthState(s); if (!c) return null; out.push(c); }
  return out;
}

// -> null when the verified JWT payload may be used, else an outcome code.
// jwt.verify already enforces exp; this repeats the check so a token minted without an
// expiry, or a clock-skewed verifier, still fails closed.
function checkSession(payload, userRow, revoked, nowMs) {
  if (!payload || typeof payload !== "object" || typeof payload.sub !== "string" || !payload.sub) return "session_invalid";
  if (typeof payload.exp !== "number" || !isFinite(payload.exp)) return "session_invalid";
  if (payload.exp * 1000 <= nowMs) return "session_expired";
  if (!userRow) return "no_account";
  // token_version: POST /auth/signout-all bumps it and kills every older session.
  if (Number(userRow.token_version || 0) !== Number(payload.tv || 0)) return "session_revoked";
  if (revoked) return "session_revoked";
  return null;
}

function createAuthFlow(deps) {
  const db = deps.db;
  const log = deps.log;
  const now = deps.now || Date.now;
  const isValidEmail = deps.isValidEmail;
  const signSession = deps.signSession;               // (claims) -> compact JWT string
  const sendMagicLink = deps.sendMagicLink;           // (to, link) -> Promise
  const appUrl = deps.appUrl;
  const devLinks = !!deps.devLinks;
  const newUserId = deps.newUserId || function () { return crypto.randomBytes(9).toString("hex"); };
  const newSessionId = deps.newSessionId || function () { return crypto.randomBytes(16).toString("hex"); };

  function refuse(rid, outcome) { log("auth_redeem", outcome, rid); return { status: 400, body: LINK_UNUSABLE }; }

  return {
    async request(body, rid) {
      body = body && typeof body === "object" ? body : {};
      const email = String(body.email || "").trim().toLowerCase();
      if (!isValidEmail(email)) { log("auth_request", "invalid_email", rid); return { status: 400, body: { error: "invalid email" } }; }
      const state = cleanAuthState(body.state);
      if (!state) { log("auth_request", "invalid_state", rid); return { status: 400, body: { error: "invalid state" } }; }
      const token = crypto.randomBytes(24).toString("hex");
      try { await db.magic.create(digest(token), email, now() + MAGIC_TTL_MS, digest(state)); }
      catch (e) { log("auth_request", "store_error", rid); return { status: 500, body: { error: "server error" } }; }
      const link = signInLinkUrl(appUrl, token);
      // Never block the response on delivery; failures are logged as an outcome code only.
      Promise.resolve()
        .then(function () { return sendMagicLink(email, link); })
        .then(function () { log("auth_request", "email_sent", rid); }, function () { log("auth_request", "email_send_failed", rid); });
      log("auth_request", "link_issued", rid);
      return { status: 200, body: devLinks ? { ok: true, devLink: link } : { ok: true } };
    },

    async redeem(body, rid) {
      body = body && typeof body === "object" ? body : {};
      const token = typeof body.token === "string" ? body.token : "";
      if (!MAGIC_TOKEN_RE.test(token)) return refuse(rid, "malformed");
      const states = cleanStates(body.states);
      if (!states) return refuse(rid, "missing_state");
      const key = digest(token);
      let row;
      try { row = await db.magic.find(key); }
      catch (e) { log("auth_redeem", "store_error", rid); return { status: 500, body: { error: "server error" } }; }
      if (!row) return refuse(rid, "not_found");
      if (!(Number(row.expires) > now())) return refuse(rid, "expired");
      // Compare every pending state (no early exit) before consuming anything: a link
      // opened in the wrong browser must not burn the token for the right one.
      let match = false;
      for (const s of states) { if (sameDigest(digest(s), row.state_hash)) match = true; }
      if (!match) return refuse(rid, "state_mismatch");
      let consumed;
      try { consumed = await db.magic.consume(key); }
      catch (e) { log("auth_redeem", "store_error", rid); return { status: 500, body: { error: "server error" } }; }
      if (!consumed) return refuse(rid, "replayed");                       // lost a concurrent redeem
      if (!(Number(consumed.expires) > now())) return refuse(rid, "expired");
      let user = await db.users.findByEmail(consumed.email);
      if (!user) {
        const id = newUserId();
        await db.users.create(id, consumed.email, now());
        user = { id: id, email: consumed.email, token_version: 0 };
      }
      const session = signSession({ sub: user.id, email: user.email, tv: Number(user.token_version || 0), sid: newSessionId() });
      log("auth_redeem", "redeemed", rid);
      return { status: 200, body: { ok: true, session: session } };
    },

    // Old emailed links (GET /auth/verify?token=...) are no longer honoured. Answer without
    // touching the database, so a scanner request cannot consume or redeem anything.
    legacyVerify(rid) {
      log("auth_verify_legacy", "legacy_link", rid);
      return { status: 410, text: "This sign-in link can no longer be used. Go back to ACED and request a new sign-in link." };
    },

    // Revoke the presented session only. Sessions minted before session ids existed
    // cannot be revoked individually; the client still drops them locally, and
    // POST /auth/signout-all revokes them.
    async signout(payload, rid) {
      if (payload && typeof payload.sid === "string" && payload.sid && typeof payload.exp === "number") {
        await db.sessions.revoke(payload.sid, payload.exp * 1000);
        log("auth_signout", "signed_out", rid);
        return { status: 200, body: { ok: true, revoked: true } };
      }
      log("auth_signout", "signed_out_legacy", rid);
      return { status: 200, body: { ok: true, revoked: false } };
    }
  };
}

module.exports = {
  createAuthFlow, checkSession, makeAuthLogger, signInLinkUrl, devLinksAllowed, digest, sameDigest,
  newRequestId, cleanStates, MAGIC_TTL_MS, MAGIC_TOKEN_RE, LOG_ROUTES, LOG_OUTCOMES
};
