/* server/db.js — durable storage for ACED, with two interchangeable backends.
   ============================================================================
   WHY THIS EXISTS: the original server wrote SQLite to a relative path on the
   host's disk. On Render/Fly/most PaaS that disk is EPHEMERAL — every deploy and
   every idle spin-down WIPES it, silently erasing every account's synced
   progress. This module makes storage durable two ways, and you pick by env:

     DATABASE_URL set   ->  Postgres   (Neon / Supabase / Render PG — free tiers exist)
     DATABASE_URL unset ->  SQLite at DB_PATH (default ./aced.db; on Render mount a
                            persistent disk and set DB_PATH=/data/aced.db)

   Both expose the SAME async repository API, so server.js doesn't care which is
   live. Timestamps are epoch-ms integers; the synced blob is stored as TEXT in
   both backends (no jsonb semantics to diverge). Schemas are identical in shape.

   TEST STATUS: the SQLite path is exercised by a local smoke test. The Postgres
   path uses standard SQL (ON CONFLICT upserts that both engines support) but
   should get one live smoke-test against your real DATABASE_URL before you flip
   accounts on in production.
   ============================================================================ */
"use strict";

const { pgSslConfig } = require("./db-tls");

const USE_PG = !!process.env.DATABASE_URL;

/* magic.token holds the SHA-256 hex digest of the one-time sign-in token, never the raw
   token (see auth-flow.js); magic.state_hash holds the digest of the requesting browser's
   state. Rows written before this change hold raw tokens and no state_hash: they can't
   be matched by digest, so they are never redeemable and are purged by the hourly gc.
   revoked_sessions lists session ids revoked by POST /auth/signout until they expire. */

/* ---------------- SQLite backend (default; great for local dev) ------------- */
function makeSqlite() {
  let Database;
  try { Database = require("better-sqlite3"); }
  catch (e) {
    throw new Error(
      "SQLite backend requested but 'better-sqlite3' is not installed. " +
      "Set DATABASE_URL to use Postgres (recommended for hosting), or run " +
      "`npm install better-sqlite3` for local SQLite. Original error: " + e.message
    );
  }
  const path = process.env.DB_PATH || "aced.db";
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users        (id TEXT PRIMARY KEY, email TEXT UNIQUE, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS magic        (token TEXT PRIMARY KEY, email TEXT, expires INTEGER);
    CREATE TABLE IF NOT EXISTS state        (user_id TEXT, pack_id TEXT, updated_at INTEGER, json TEXT, PRIMARY KEY(user_id,pack_id));
    CREATE TABLE IF NOT EXISTS entitlements (user_id TEXT, pack_id TEXT, granted_at INTEGER, PRIMARY KEY(user_id,pack_id));
    CREATE TABLE IF NOT EXISTS leaderboard  (user_id TEXT, pack_id TEXT, handle TEXT, best_streak INTEGER, readiness INTEGER, mock_best INTEGER, updated_at INTEGER, PRIMARY KEY(user_id,pack_id));
    CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, source TEXT, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS revoked_sessions (sid TEXT PRIMARY KEY, expires INTEGER);
  `);
  // better-sqlite3 is synchronous; wrap results in resolved promises so the API
  // matches the async Postgres backend exactly.
  // Migrations for pre-existing DBs. SQLite lacks ADD COLUMN IF NOT EXISTS, so we
  // introspect first. token_version powers session revocation; handle powers the
  // opt-in public leaderboard (null handle = invisible).
  {
    const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!cols.includes("token_version")) db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0");
    if (!cols.includes("handle")) db.exec("ALTER TABLE users ADD COLUMN handle TEXT");
    const scols = db.prepare("PRAGMA table_info(subscribers)").all().map(c => c.name);
    if (!scols.includes("source")) db.exec("ALTER TABLE subscribers ADD COLUMN source TEXT");
    const mcols = db.prepare("PRAGMA table_info(magic)").all().map(c => c.name);
    if (!mcols.includes("state_hash")) db.exec("ALTER TABLE magic ADD COLUMN state_hash TEXT");
  }
  const P = (v) => Promise.resolve(v);
  return {
    kind: "sqlite (" + path + ")",
    async init() { return; },
    users: {
      findByEmail: (email) => P(db.prepare("SELECT id,email,created_at,token_version,handle FROM users WHERE email=?").get(email) || null),
      get: (id) => P(db.prepare("SELECT id,email,created_at,token_version,handle FROM users WHERE id=?").get(id) || null),
      create: (id, email, ts) => P(db.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,?)").run(id, email, ts)),
      bumpVersion: (id) => P(db.prepare("UPDATE users SET token_version = COALESCE(token_version,0) + 1 WHERE id=?").run(id)),
      setHandle: (id, handle) => P(db.prepare("UPDATE users SET handle=? WHERE id=?").run(handle, id))
    },
    magic: {
      create: (tokenHash, email, expires, stateHash) => P(db.prepare("INSERT INTO magic(token,email,expires,state_hash) VALUES(?,?,?,?)").run(tokenHash, email, expires, stateHash)),
      find: (tokenHash) => P(db.prepare("SELECT email,expires,state_hash FROM magic WHERE token=?").get(tokenHash) || null),
      // Atomic single use: exactly one caller gets the row back.
      consume: (tokenHash) => P(db.prepare("DELETE FROM magic WHERE token=? RETURNING email,expires,state_hash").get(tokenHash) || null),
      remove: (tokenHash) => P(db.prepare("DELETE FROM magic WHERE token=?").run(tokenHash)),
      gc: (cutoff) => P(db.prepare("DELETE FROM magic WHERE expires < ?").run(cutoff))
    },
    sessions: {
      revoke: (sid, expires) => P(db.prepare("INSERT OR IGNORE INTO revoked_sessions(sid,expires) VALUES(?,?)").run(sid, expires)),
      isRevoked: (sid) => P(!!db.prepare("SELECT 1 AS r FROM revoked_sessions WHERE sid=?").get(sid)),
      gc: (cutoff) => P(db.prepare("DELETE FROM revoked_sessions WHERE expires < ?").run(cutoff))
    },
    state: {
      get: (userId, packId) => P(db.prepare("SELECT json, updated_at FROM state WHERE user_id=? AND pack_id=?").get(userId, packId) || null),
      upsert: (userId, packId, ts, json) => P(db.prepare(
        "INSERT INTO state(user_id,pack_id,updated_at,json) VALUES(?,?,?,?) " +
        "ON CONFLICT(user_id,pack_id) DO UPDATE SET updated_at=excluded.updated_at, json=excluded.json"
      ).run(userId, packId, ts, json))
    },
    entitlements: {
      grant: (userId, packId, ts) => P(db.prepare("INSERT OR IGNORE INTO entitlements(user_id,pack_id,granted_at) VALUES(?,?,?)").run(userId, packId, ts)),
      listPacks: (userId) => P(db.prepare("SELECT pack_id FROM entitlements WHERE user_id=?").all(userId).map(r => r.pack_id))
    },
    leaderboard: {
      upsert: (userId, packId, handle, bestStreak, readiness, mockBest, ts) => P(db.prepare(
        "INSERT INTO leaderboard(user_id,pack_id,handle,best_streak,readiness,mock_best,updated_at) VALUES(?,?,?,?,?,?,?) " +
        "ON CONFLICT(user_id,pack_id) DO UPDATE SET handle=excluded.handle, best_streak=excluded.best_streak, readiness=excluded.readiness, mock_best=excluded.mock_best, updated_at=excluded.updated_at"
      ).run(userId, packId, handle, bestStreak, readiness, mockBest, ts)),
      setHandleForUser: (userId, handle) => P(db.prepare("UPDATE leaderboard SET handle=? WHERE user_id=?").run(handle, userId)),
      top: (packId, limit) => P(db.prepare(
        "SELECT handle, best_streak, readiness, mock_best FROM leaderboard WHERE pack_id=? AND handle IS NOT NULL ORDER BY best_streak DESC, readiness DESC LIMIT ?"
      ).all(packId, limit))
    },
    subscribers: {
      add: (email, source, ts) => P(db.prepare("INSERT OR IGNORE INTO subscribers(email,source,created_at) VALUES(?,?,?)").run(email, source, ts))
    }
  };
}

/* ---------------- Postgres backend (durable, free tiers available) ---------- */
function makePg() {
  // Transport policy (server/db-tls.js): production always verifies the server certificate
  // and refuses to start on an insecure setting; weaker modes are explicit, dev-only opt-ins.
  // Checked BEFORE the driver is loaded, so a refused configuration never opens a connection.
  const tls = pgSslConfig(process.env);
  if (tls.warning) console.warn(tls.warning);
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: tls.ssl
  });
  const q = (text, params) => pool.query(text, params);
  return {
    kind: "postgres",
    async init() {
      await q(`
        CREATE TABLE IF NOT EXISTS users        (id TEXT PRIMARY KEY, email TEXT UNIQUE, created_at BIGINT);
        CREATE TABLE IF NOT EXISTS magic        (token TEXT PRIMARY KEY, email TEXT, expires BIGINT);
        CREATE TABLE IF NOT EXISTS state        (user_id TEXT, pack_id TEXT, updated_at BIGINT, json TEXT, PRIMARY KEY(user_id,pack_id));
        CREATE TABLE IF NOT EXISTS entitlements (user_id TEXT, pack_id TEXT, granted_at BIGINT, PRIMARY KEY(user_id,pack_id));
        CREATE TABLE IF NOT EXISTS leaderboard  (user_id TEXT, pack_id TEXT, handle TEXT, best_streak INTEGER, readiness INTEGER, mock_best INTEGER, updated_at BIGINT, PRIMARY KEY(user_id,pack_id));
        CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, source TEXT, created_at BIGINT);
        CREATE TABLE IF NOT EXISTS revoked_sessions (sid TEXT PRIMARY KEY, expires BIGINT);
      `);
      // additive migrations for existing deployments (idempotent)
      await q("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0");
      await q("ALTER TABLE users ADD COLUMN IF NOT EXISTS handle TEXT");
      await q("ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS source TEXT");
      await q("ALTER TABLE magic ADD COLUMN IF NOT EXISTS state_hash TEXT");
    },
    users: {
      findByEmail: async (email) => (await q("SELECT id,email,created_at,token_version,handle FROM users WHERE email=$1", [email])).rows[0] || null,
      get: async (id) => (await q("SELECT id,email,created_at,token_version,handle FROM users WHERE id=$1", [id])).rows[0] || null,
      create: (id, email, ts) => q("INSERT INTO users(id,email,created_at) VALUES($1,$2,$3)", [id, email, ts]),
      bumpVersion: (id) => q("UPDATE users SET token_version = COALESCE(token_version,0) + 1 WHERE id=$1", [id]),
      setHandle: (id, handle) => q("UPDATE users SET handle=$1 WHERE id=$2", [handle, id])
    },
    magic: {
      create: (tokenHash, email, expires, stateHash) => q("INSERT INTO magic(token,email,expires,state_hash) VALUES($1,$2,$3,$4)", [tokenHash, email, expires, stateHash]),
      find: async (tokenHash) => (await q("SELECT email,expires,state_hash FROM magic WHERE token=$1", [tokenHash])).rows[0] || null,
      // Atomic single use: exactly one caller gets the row back.
      consume: async (tokenHash) => (await q("DELETE FROM magic WHERE token=$1 RETURNING email,expires,state_hash", [tokenHash])).rows[0] || null,
      remove: (tokenHash) => q("DELETE FROM magic WHERE token=$1", [tokenHash]),
      gc: (cutoff) => q("DELETE FROM magic WHERE expires < $1", [cutoff])
    },
    sessions: {
      revoke: (sid, expires) => q("INSERT INTO revoked_sessions(sid,expires) VALUES($1,$2) ON CONFLICT(sid) DO NOTHING", [sid, expires]),
      isRevoked: async (sid) => (await q("SELECT 1 AS r FROM revoked_sessions WHERE sid=$1", [sid])).rows.length > 0,
      gc: (cutoff) => q("DELETE FROM revoked_sessions WHERE expires < $1", [cutoff])
    },
    state: {
      get: async (userId, packId) => {
        const r = (await q("SELECT json, updated_at FROM state WHERE user_id=$1 AND pack_id=$2", [userId, packId])).rows[0];
        return r ? { json: r.json, updated_at: Number(r.updated_at) } : null;
      },
      upsert: (userId, packId, ts, json) => q(
        "INSERT INTO state(user_id,pack_id,updated_at,json) VALUES($1,$2,$3,$4) " +
        "ON CONFLICT(user_id,pack_id) DO UPDATE SET updated_at=EXCLUDED.updated_at, json=EXCLUDED.json",
        [userId, packId, ts, json]
      )
    },
    entitlements: {
      grant: (userId, packId, ts) => q("INSERT INTO entitlements(user_id,pack_id,granted_at) VALUES($1,$2,$3) ON CONFLICT(user_id,pack_id) DO NOTHING", [userId, packId, ts]),
      listPacks: async (userId) => (await q("SELECT pack_id FROM entitlements WHERE user_id=$1", [userId])).rows.map(r => r.pack_id)
    },
    leaderboard: {
      upsert: (userId, packId, handle, bestStreak, readiness, mockBest, ts) => q(
        "INSERT INTO leaderboard(user_id,pack_id,handle,best_streak,readiness,mock_best,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) " +
        "ON CONFLICT(user_id,pack_id) DO UPDATE SET handle=EXCLUDED.handle, best_streak=EXCLUDED.best_streak, readiness=EXCLUDED.readiness, mock_best=EXCLUDED.mock_best, updated_at=EXCLUDED.updated_at",
        [userId, packId, handle, bestStreak, readiness, mockBest, ts]
      ),
      setHandleForUser: (userId, handle) => q("UPDATE leaderboard SET handle=$1 WHERE user_id=$2", [handle, userId]),
      top: async (packId, limit) => (await q(
        "SELECT handle, best_streak, readiness, mock_best FROM leaderboard WHERE pack_id=$1 AND handle IS NOT NULL ORDER BY best_streak DESC, readiness DESC LIMIT $2",
        [packId, limit]
      )).rows
    },
    subscribers: {
      add: (email, source, ts) => q("INSERT INTO subscribers(email,source,created_at) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING", [email, source, ts])
    }
  };
}

const db = USE_PG ? makePg() : makeSqlite();
module.exports = db;
