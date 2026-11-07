/* server/server.js — ACED reference backend (accounts · sync · Stripe entitlements)
   ============================================================================
   Implements docs/BACKEND_SPEC.md. Pairs with the client contract in aced-core.js
   (ACEDCore.backend / ACEDCore.sync) and the glue in aced-account.js.

   Storage is durable and pluggable via server/db.js:
     DATABASE_URL set   -> Postgres (Neon/Supabase/Render — free tiers exist)
     DATABASE_URL unset -> SQLite at DB_PATH (mount a persistent disk in prod!)
   Email (magic links) is pluggable via server/email.js (Resend, else console).

   Quick start:
     cd server && cp .env.example .env   # fill in values
     npm install
     npm start                            # http://localhost:8787

   Endpoints:
     POST /auth/request   {email,state}           -> emails APP_URL/#signin=<token> (localhost dev: also returns it)
     POST /auth/redeem    {token,states}          -> after the user confirms in the requesting browser: { session }
     GET  /auth/verify                            -> legacy links only: 410, touches nothing (scanner-safe)
     POST /auth/signout                           -> revoke THIS session                (Bearer)
     GET  /state?pack=<id>                        -> merged state for the authed user+pack   (Bearer)
     POST /sync?pack=<id> <snapshot>              -> merge + persist (pack required)          (Bearer)
     GET  /entitlements                           -> { packs:[...] }                          (Bearer)
     POST /billing/checkout {pack}                -> { url } Stripe Checkout                   (Bearer)
     POST /billing/webhook                        -> Stripe -> grant entitlement (raw body)
     GET  /leaderboard?pack=world-capitals        -> public opt-in stats
     POST /notify         {email}                 -> store a launch-list subscriber
     POST /leaderboard/optin {handle}             -> show on the public board       (Bearer)
     POST /leaderboard/optout                     -> hide from the public board     (Bearer)
     POST /auth/signout-all                       -> revoke ALL sessions for user   (Bearer)
   ============================================================================ */
"use strict";
require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { rateLimit } = require("express-rate-limit");
const { mergeState } = require("./merge");
const { leaderboardMetrics } = require("./leaderboard");
const { syncPackId } = require("./sync-auth-guards");
const { createAuthFlow, checkSession, makeAuthLogger, devLinksAllowed, newRequestId } = require("./auth-flow");
const db = require("./db");
const { sendMagicLink, providerName } = require("./email");

const PORT = process.env.PORT || 8787;
const APP_URL = process.env.APP_URL || "http://localhost:5500";          // where index.html is served
const API_URL = process.env.API_URL || ("http://localhost:" + PORT);
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const DEV = process.env.NODE_ENV !== "production";
// Session lifetime is unchanged by the Phase A hardening (see docs/security/auth-session-transport.md).
const SESSION_TTL = "60d";
const authLog = makeAuthLogger();

// Linear email validation (no backtracking regex — avoids ReDoS). Length-capped,
// exactly one '@', non-empty local part, a dotted domain, no whitespace.
function isValidEmail(s) {
  if (typeof s !== "string" || s.length > 254) return false;
  if (/\s/.test(s)) return false;
  const at = s.indexOf("@");
  if (at <= 0 || at !== s.lastIndexOf("@")) return false;
  const domain = s.slice(at + 1);
  if (!domain || domain.length > 253) return false;
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

// Fail closed: a forgeable signing key in prod = trivial account takeover + free
// entitlements. The render.yaml blueprint generates this for you; this guard
// protects every other deploy path (incl. the documented `cp .env.example`).
if (!DEV && (!process.env.JWT_SECRET ||
    process.env.JWT_SECRET === "dev-secret-change-me" ||
    process.env.JWT_SECRET.length < 32)) {
  console.error("FATAL: set a strong JWT_SECRET (32+ chars) before running in production.");
  process.exit(1);
}

const stripe = process.env.STRIPE_SECRET_KEY ? require("stripe")(process.env.STRIPE_SECRET_KEY) : null;
// No paid content is offered by the universal study-pack app.
const PRICES = {};

const uid = () => crypto.randomBytes(9).toString("hex");

const authFlow = createAuthFlow({
  db,
  log: authLog,
  isValidEmail,
  sendMagicLink,
  appUrl: APP_URL,
  devLinks: devLinksAllowed(process.env),
  newUserId: uid,
  signSession: (claims) => jwt.sign(claims, JWT_SECRET, { algorithm: "HS256", expiresIn: SESSION_TTL })
});

/* ---------- app ---------- */
const app = express();

// Render (and most PaaS) put exactly ONE proxy hop in front of us. This MUST be a
// specific hop count, not `true` — in express-rate-limit v8, `trust proxy: true`
// throws a validation error and then silently lets every request through, so the
// rate limiting below would be a no-op. `1` makes req.ip the real client IP.
app.set("trust proxy", 1);

// Stripe webhook needs the RAW body for signature verification — mount before express.json.
app.post("/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(501).end();
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET); }
  catch (e) { console.error("[stripe] webhook signature verification failed:", e.message); return res.status(400).send("bad signature"); }
  // Grant on completion for instant methods, and on async success for delayed ones
  // (ACH/SEPA). Only grant once the money is actually captured: "paid" = cleared,
  // "no_payment_required" = a legit 100%-off / free grant. A delayed method reports
  // "unpaid" at completion and clears later via async_payment_succeeded, so we skip
  // it now rather than grant on a payment that may never settle. Grants are
  // idempotent (INSERT OR IGNORE), so a redelivered webhook can't double-grant.
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const s = event.data.object;
    const userId = s.metadata && s.metadata.user_id, packId = s.metadata && s.metadata.pack_id;
    const ps = s.payment_status;
    const settled = ps === "paid" || ps === "no_payment_required";
    if (userId && packId && settled) {
      try { await db.entitlements.grant(userId, packId, Date.now()); }
      catch (e) { console.error("[webhook] grant failed:", e.message); return res.status(500).end(); }
    }
  }
  res.json({ received: true });
});

// Random per-request correlation id: the only request identifier auth logs carry.
app.use((req, res, next) => { req.rid = newRequestId(); res.setHeader("X-Request-Id", req.rid); next(); });
app.use(express.json({ limit: "2mb" }));
// permissive CORS for the static site (lock APP_URL down in prod)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", APP_URL);
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
// Baseline security headers for the JSON API: block MIME sniffing and framing, keep
// referrers off the API, and never let a proxy/browser cache authenticated responses.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});

async function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!tok) return res.status(401).json({ error: "no token" });
  let payload;
  try { payload = jwt.verify(tok, JWT_SECRET, { algorithms: ["HS256"] }); }
  catch (e) { authLog("auth_session", "bad_token", req.rid); return res.status(401).json({ error: "bad token" }); }
  try {
    const u = await db.users.get(payload.sub);
    // Session revocation: bumping users.token_version (POST /auth/signout-all)
    // invalidates every previously-issued JWT. Tokens minted before this feature
    // carry no `tv`, which reads as 0 and matches a fresh account — so old sessions
    // keep working until a deliberate bump. POST /auth/signout revokes one session id.
    const revoked = typeof payload.sid === "string" && payload.sid ? await db.sessions.isRevoked(payload.sid) : false;
    const why = checkSession(payload, u, revoked, Date.now());
    if (why) {
      authLog("auth_session", why, req.rid);
      const error = why === "no_account" ? "no account" : why === "session_revoked" ? "session revoked" : "bad token";
      return res.status(401).json({ error });
    }
    req.user = payload; req.userRow = u;   // stash so downstream routes skip a re-query
    next();
  } catch (e) { next(e); }                 // DB error -> error middleware (clean 500)
}
function packId(req) { return String(req.query.pack || (req.body && req.body.pack) || "world-capitals").replace(/[^a-z0-9._-]/gi, ""); }

// Known starter topic counts for the optional legacy metrics endpoint.
// The current frontend keeps its answer-based learning records locally.
const PACK_MODULE_COUNTS = { "world-capitals": 4, "spanish-1k": 4 };

// Express 4 does NOT catch rejected promises from async route handlers — an
// unguarded await that rejects leaves the request hanging with no response. wrap()
// forwards any rejection to the error middleware below, so a transient DB error
// returns a clean 500 instead of a hung connection.
function wrap(fn){ return function(req,res,next){ Promise.resolve(fn(req,res,next)).catch(next); }; }

/* ---------- rate limiting ---------- */
// In-memory store: correct for a single instance (the free-tier setup). If you
// ever scale to >1 instance, swap in rate-limit-redis so buckets are shared.

// Broad backstop on the whole API, per IP. Generous enough that normal sync
// traffic never notices; skips /health so Render's health checks aren't throttled.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  standardHeaders: true, legacyHeaders: false,
  skip: (req) => req.path === "/health",
  message: { error: "rate_limited" }
});
// Tighter cap on the auth surface, per IP — stops one machine hammering sign-in.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "too_many_auth_attempts" }
});
// Per *email*, not per IP — the email-bomb defense. At most 5 magic links per hour
// to any single address, regardless of source. Key is normalized to match how
// /auth/request lowercases+trims, so casing/whitespace can't dodge the limit.
const magicLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String((req.body && req.body.email) || "").trim().toLowerCase(),
  message: { error: "too_many_link_requests" }
});

// Lead-capture cap: the marketing "notify me" form posts here; keep it modest per IP.
const notifyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "rate_limited" } });

app.use(apiLimiter);

/* ---------- accounts (magic-link) ---------- */
// Request, redeem and logging rules live in auth-flow.js (unit-tested without Express).
// Sign-in never completes on a GET: the emailed link opens the static app, and only an
// explicit confirmation in the requesting browser POSTs /auth/redeem.
app.post("/auth/request", authLimiter, magicLinkLimiter, wrap(async (req, res) => {
  const out = await authFlow.request(req.body, req.rid);
  res.status(out.status).json(out.body);
}));

app.post("/auth/redeem", authLimiter, wrap(async (req, res) => {
  const out = await authFlow.redeem(req.body, req.rid);
  res.status(out.status).json(out.body);
}));

// Links emailed before this change pointed here. They are not redeemable any more (tokens
// are now stored as digests), and a GET must never consume or mint anything.
app.get("/auth/verify", authLimiter, (req, res) => {
  const out = authFlow.legacyVerify(req.rid);
  res.status(out.status).type("text/plain").send(out.text);
});

// Revoke THIS session (normal sign-out). The session id is listed as revoked until the
// token would have expired anyway, so a copied token stops working immediately.
app.post("/auth/signout", auth, wrap(async (req, res) => {
  const out = await authFlow.signout(req.user, req.rid);
  res.status(out.status).json(out.body);
}));

// Revoke every active session for the caller (lost/shared device). Bumps the
// stored token_version so all outstanding JWTs fail the check in auth().
app.post("/auth/signout-all", auth, wrap(async (req, res) => {
  await db.users.bumpVersion(req.user.sub);
  authLog("auth_signout_all", "revoked_all", req.rid);
  res.json({ ok: true });
}));

/* ---------- sync ---------- */
// Sync routes REQUIRE an explicit pack (no world-capitals fallback): see sync-auth-guards.js.
app.get("/state", auth, wrap(async (req, res) => {
  const sp = syncPackId(req);
  if (sp.error) return res.status(400).json({ error: sp.error });
  const pid = sp.pack;
  const row = await db.state.get(req.user.sub, pid);
  if (!row) return res.json({ v: 1, pack: pid, updatedAt: 0, data: {} });
  res.json({ v: 1, pack: pid, updatedAt: Number(row.updated_at), data: JSON.parse(row.json) });
}));

app.post("/sync", auth, wrap(async (req, res) => {
  const sp = syncPackId(req);
  if (sp.error) return res.status(400).json({ error: sp.error });
  const pid = sp.pack;
  const incoming = req.body || {};
  const row = await db.state.get(req.user.sub, pid);
  const stored = row ? { updatedAt: Number(row.updated_at), data: JSON.parse(row.json) } : null;
  const merged = mergeState(stored, incoming);
  const now = Date.now();
  await db.state.upsert(req.user.sub, pid, now, JSON.stringify(merged));
  // opportunistically refresh the public leaderboard row from the merged state,
  // with server-side sanity caps (the snapshot is client-controlled — see leaderboard.js).
  try {
    const u = req.userRow || await db.users.get(req.user.sub);
    const mx = leaderboardMetrics(merged, u && Number(u.created_at), now, PACK_MODULE_COUNTS[pid]);
    // handle is null unless the user opted in (POST /leaderboard/optin); null rows
    // are filtered out of the public board, so syncing never exposes anyone.
    await db.leaderboard.upsert(req.user.sub, pid, (u && u.handle) || null, mx.bestStreak, mx.readiness, mx.mockBest, now);
  } catch (e) { /* leaderboard is best-effort */ }
  res.json({ ok: true, serverUpdatedAt: now });
}));

/* ---------- entitlements + billing ---------- */
app.get("/entitlements", auth, wrap(async (req, res) => {
  const packs = await db.entitlements.listPacks(req.user.sub);
  res.json({ packs });
}));

app.post("/billing/checkout", auth, async (req, res) => {
  if (!stripe) return res.status(501).json({ error: "billing not configured" });
  const pid = packId(req); const price = PRICES[pid];
  if (!price) return res.status(400).json({ error: "no price for pack " + pid });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",                                   // one-time per-section unlock
      line_items: [{ price, quantity: 1 }],
      allow_promotion_codes: true,                       // show coupon field (owner comp + launch discounts)
      customer_email: req.user.email,
      success_url: APP_URL + "/study.html?paid=1&pack=" + pid,
      cancel_url: APP_URL + "/?canceled=1",
      metadata: { user_id: req.user.sub, pack_id: pid }
    });
    res.json({ url: session.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- leaderboard (opt-in public stats only) ---------- */
app.get("/leaderboard", wrap(async (req, res) => {
  const pid = String(req.query.pack || "world-capitals").replace(/[^a-z0-9._-]/gi, "");
  const rows = await db.leaderboard.top(pid, 50);
  res.json(rows.map(r => ({ handle: r.handle, bestStreak: r.best_streak, readiness: r.readiness, mockBest: r.mock_best })));
}));

// Public-handle opt in/out. A user is INVISIBLE on the board until they set a
// handle here. Sanitize to a safe display charset and cap length; 2-char floor
// stops empty/emoji-only handles from squatting the top rows.
function cleanHandle(h) { return String(h || "").trim().replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 24); }
app.post("/leaderboard/optin", auth, wrap(async (req, res) => {
  const handle = cleanHandle(req.body && req.body.handle);
  if (handle.length < 2) return res.status(400).json({ error: "handle must be 2-24 characters (letters, digits, space, _ or -)" });
  await db.users.setHandle(req.user.sub, handle);
  await db.leaderboard.setHandleForUser(req.user.sub, handle);   // reflect on existing rows now
  res.json({ ok: true, handle });
}));
app.post("/leaderboard/optout", auth, wrap(async (req, res) => {
  await db.users.setHandle(req.user.sub, null);
  await db.leaderboard.setHandleForUser(req.user.sub, null);
  res.json({ ok: true });
}));

// Launch-list capture from the marketing site. Validated + rate-limited + idempotent.
app.post("/notify", notifyLimiter, wrap(async (req, res) => {
  const email = String((req.body && req.body.email) || "").trim().toLowerCase();
  if (!isValidEmail(email)) return res.status(400).json({ error: "invalid email" });
  const source = (String((req.body && req.body.source) || "home").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40)) || "home";
  await db.subscribers.add(email, source, Date.now());
  res.json({ ok: true });
}));

app.get("/health", (req, res) => res.json({ ok: true, stripe: !!stripe, db: db.kind, email: providerName }));

// Final error handler: any rejection forwarded by wrap() (or next(err)) lands here
// and returns a clean 500 instead of leaking a stack trace or hanging the request.
// Only an outcome code and the request id are logged: error messages can echo request
// bodies (e.g. a JSON parse error quoting an email address) or database values.
app.use((err, req, res, next) => {
  authLog("server", "unhandled_error", req && req.rid);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "server error" });
});

/* ---------- boot ---------- */
db.init().then(() => {
  if (!DEV && providerName === "console") {
    console.warn("[WARN] NODE_ENV=production but no email provider is configured (RESEND_API_KEY unset).");
    console.warn("[WARN] Magic links will NOT be delivered — set RESEND_API_KEY or sign-in will silently fail.");
  }
  // Purge expired magic-link tokens and expired session revocations hourly so the
  // tables cannot grow without bound.
  setInterval(() => {
    try { db.magic.gc(Date.now()).catch(() => {}); } catch (e) {}
    try { db.sessions.gc(Date.now()).catch(() => {}); } catch (e) {}
  }, 60 * 60 * 1000).unref();
  app.listen(PORT, () => console.log(
    "ACED API on " + API_URL +
    "  · db: " + db.kind +
    "  · email: " + providerName +
    (stripe ? "" : "  · Stripe disabled (set STRIPE_SECRET_KEY)")
  ));
// Code only (e.g. ENOTFOUND, 28P01, SELF_SIGNED_CERT_IN_CHAIN): driver messages can carry
// host and user names from the connection string.
}).catch(e => { console.error("FATAL: db init failed:", String((e && (e.code || e.name)) || "error")); process.exit(1); });
