/* server/db-tls.js — Postgres transport-security policy. Pure; no I/O, no dependencies.
   Run its tests with: node server/db-tls.test.js

   Production (NODE_ENV=production) ALWAYS verifies the server certificate against
   Node's trust store (plus any CA supplied through Node's standard
   NODE_EXTRA_CA_CERTS environment variable). Startup fails closed, before any
   connection, if the configuration asks for less:
     - PGSSL=off or PGSSL=no-verify, or any unknown PGSSL value;
     - a DATABASE_URL whose sslmode disables TLS or skips verification
       (disable, allow, prefer, no-verify). The pg driver lets URL parameters
       override the ssl option, so these must be refused here.

   Local development is explicit and separate:
     PGSSL unset / "verify"  -> verify certificates (same as production)
     PGSSL=no-verify         -> TLS without certificate verification (warns; never in production)
     PGSSL=off               -> no TLS, for a local Postgres only (warns; never in production)

   Errors never include the connection string, host, user or password. */
"use strict";

const INSECURE_SSLMODES = new Set(["disable", "allow", "prefer", "no-verify"]);
const KNOWN_PGSSL = new Set(["", "verify", "no-verify", "off"]);

class DbTlsConfigError extends Error {
  constructor(code) {
    super("Insecure database TLS configuration refused (" + code + "). See server/.env.example (PGSSL).");
    this.name = "DbTlsConfigError";
    this.code = code;
  }
}

// sslmode from the URL query, lower-cased; "" when absent or unparsable.
function urlSslMode(databaseUrl) {
  try { return String(new URL(String(databaseUrl || "")).searchParams.get("sslmode") || "").trim().toLowerCase(); }
  catch (e) { return ""; }
}

// -> { ssl, warning }   ssl is the value for pg's Pool({ ssl }); warning is a fixed string or null.
// Throws DbTlsConfigError when the configuration is not allowed.
function pgSslConfig(env) {
  env = env || {};
  const production = env.NODE_ENV === "production";
  const mode = String(env.PGSSL == null ? "" : env.PGSSL).trim().toLowerCase();
  const urlMode = urlSslMode(env.DATABASE_URL);

  if (!KNOWN_PGSSL.has(mode)) throw new DbTlsConfigError("unknown_pgssl_value");
  if (production) {
    if (mode === "off") throw new DbTlsConfigError("pgssl_off_in_production");
    if (mode === "no-verify") throw new DbTlsConfigError("pgssl_no_verify_in_production");
    if (INSECURE_SSLMODES.has(urlMode)) throw new DbTlsConfigError("url_sslmode_insecure_in_production");
    return { ssl: { rejectUnauthorized: true }, warning: null };
  }
  if (mode === "off") return { ssl: false, warning: "[db] PGSSL=off: database TLS disabled (local development only)." };
  if (mode === "no-verify") return { ssl: { rejectUnauthorized: false }, warning: "[db] PGSSL=no-verify: database certificate NOT verified (local development only)." };
  if (INSECURE_SSLMODES.has(urlMode)) return { ssl: { rejectUnauthorized: true }, warning: "[db] DATABASE_URL sslmode weakens TLS; allowed outside production only." };
  return { ssl: { rejectUnauthorized: true }, warning: null };
}

module.exports = { pgSslConfig, DbTlsConfigError, urlSslMode, INSECURE_SSLMODES };
