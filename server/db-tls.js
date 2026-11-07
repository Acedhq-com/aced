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
const { isIP } = require("node:net");
const { domainToASCII } = require("node:url");
const TLS_KEYS = new Set(["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert", "sslnegotiation", "uselibpqcompat"]);

// Syntactic TCP admission only. No lookup or file access.
function tcpHost(host) {
  if (typeof host !== "string" || !host) return false;
  if (host.startsWith("[") && host.endsWith("]")) return isIP(host.slice(1, -1)) === 6;
  if (isIP(host)) return true;
  const ascii = domainToASCII(host);
  return !!ascii && ascii.length <= 253 &&
    ascii.replace(/\.$/, "").split(".").every(s => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(s));
}

function tcpPort(port) {
  return /^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;
}

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
  if (!KNOWN_PGSSL.has(mode)) throw new DbTlsConfigError("unknown_pgssl_value");
  if (production) {
    if (mode === "off") throw new DbTlsConfigError("pgssl_off_in_production");
    if (mode === "no-verify") throw new DbTlsConfigError("pgssl_no_verify_in_production");
  }
  if (env.NODE_PG_FORCE_NATIVE) throw new DbTlsConfigError("unsupported_driver_runtime");
  if (env.PGSSLNEGOTIATION != null && String(env.PGSSLNEGOTIATION).trim().toLowerCase() !== "postgres") {
    throw new DbTlsConfigError("unsupported_tls_configuration");
  }
  let url;
  try {
    if (typeof env.DATABASE_URL !== "string" || !env.DATABASE_URL || /%(?![a-f0-9]{2})/i.test(env.DATABASE_URL)) throw new Error();
    url = new URL(env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hash) throw new Error();
    decodeURIComponent(url.username); decodeURIComponent(url.password); decodeURI(url.pathname);
  } catch (_) { throw new DbTlsConfigError("invalid_database_url"); }
  const controls = new Map();
  for (const [key, value] of url.searchParams) {
    const lower = key.toLowerCase();
    if (lower.startsWith("ssl") || TLS_KEYS.has(lower) || ["host", "port", "service"].includes(lower)) {
      if (key !== lower) throw new DbTlsConfigError("unsupported_tls_configuration");
      if (controls.has(key)) throw new DbTlsConfigError("ambiguous_tls_configuration");
      controls.set(key, value);
      if ((!TLS_KEYS.has(key) && !["host", "port"].includes(key)) || ["sslcert", "sslkey", "sslrootcert"].includes(key)) {
        throw new DbTlsConfigError("unsupported_tls_configuration");
      }
    }
  }
  let host;
  try { host = controls.has("host") ? controls.get("host") : decodeURIComponent(url.hostname); }
  catch (_) { throw new DbTlsConfigError("invalid_database_target"); }
  const port = controls.has("port") ? controls.get("port") : url.port || "5432";
  if (!tcpHost(host) || !tcpPort(port)) throw new DbTlsConfigError("invalid_database_target");
  let weak = false;
  if (controls.has("sslmode")) {
    const requested = controls.get("sslmode").trim().toLowerCase();
    if (INSECURE_SSLMODES.has(requested)) {
      if (production) throw new DbTlsConfigError("url_sslmode_insecure_in_production");
      weak = true;
    } else if (!["require", "verify-ca", "verify-full"].includes(requested)) {
      throw new DbTlsConfigError("unsupported_tls_configuration");
    }
  }
  if (controls.has("ssl")) {
    const requested = controls.get("ssl").trim().toLowerCase();
    if (!["true", "1"].includes(requested)) {
      if (production || !["false", "0", "no-verify"].includes(requested)) throw new DbTlsConfigError("unsupported_tls_configuration");
      weak = true;
    }
  }
  if (controls.has("uselibpqcompat") && controls.get("uselibpqcompat") !== "false") {
    throw new DbTlsConfigError("unsupported_tls_configuration");
  }
  if (controls.has("sslnegotiation") && controls.get("sslnegotiation").trim().toLowerCase() !== "postgres") {
    throw new DbTlsConfigError("unsupported_tls_configuration");
  }
  for (const key of TLS_KEYS) url.searchParams.delete(key);
  const admitted = { connectionString: url.toString(), production };
  if (mode === "off") return { ...admitted, ssl: false, warning: "[db] PGSSL=off: database TLS disabled (local development only)." };
  if (mode === "no-verify") return { ...admitted, ssl: { rejectUnauthorized: false }, warning: "[db] PGSSL=no-verify: database certificate NOT verified (local development only)." };
  return { ...admitted, ssl: { rejectUnauthorized: true }, warning: weak ? "[db] DATABASE_URL sslmode weakens TLS; allowed outside production only." : null };
}

module.exports = { pgSslConfig, DbTlsConfigError, urlSslMode, INSECURE_SSLMODES };
