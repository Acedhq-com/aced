/* server/db-tls.test.js — Postgres TLS policy tests. Zero-dependency.
   Run: node server/db-tls.test.js   (exit 0 = all pass)
   Connection strings below are synthetic (reserved .test domain, no password). */
"use strict";
const fs = require("fs");
const path = require("path");
const { pgSslConfig, DbTlsConfigError } = require("./db-tls");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log("FAIL: " + name + "\n  " + (e && e.message)); }
}
function ok(v, msg) { if (!v) throw new Error(msg || "assertion failed"); }
function refused(env, code) {
  try { pgSslConfig(env); } catch (e) {
    ok(e instanceof DbTlsConfigError, "fails with DbTlsConfigError");
    ok(e.code === code, "expected refusal code " + code);
    ok(e.message.indexOf("dbuser") < 0 && e.message.indexOf("db.example.test") < 0,
      "error message must not echo the connection string");
    return;
  }
  throw new Error("insecure configuration was accepted");
}
const URL_PLAIN = "postgres://dbuser@db.example.test:5432/aced";   // synthetic; no password
const PROD = { NODE_ENV: "production", DATABASE_URL: URL_PLAIN };

// --- production: secure configurations succeed and always verify ---
t("production default verifies certificates", function () {
  const r = pgSslConfig(PROD);
  ok(r.ssl && r.ssl.rejectUnauthorized === true); ok(r.warning === null);
});
t("production PGSSL=verify verifies certificates", function () {
  ok(pgSslConfig(Object.assign({ PGSSL: "verify" }, PROD)).ssl.rejectUnauthorized === true);
});
["require", "verify-ca", "verify-full", "REQUIRE"].forEach(function (m) {
  t("production URL sslmode=" + m + " is accepted with verification", function () {
    ok(pgSslConfig({ NODE_ENV: "production", DATABASE_URL: URL_PLAIN + "?sslmode=" + m }).ssl.rejectUnauthorized === true);
  });
});

// --- production: insecure configurations fail closed ---
t("production PGSSL=off is refused", function () { refused(Object.assign({ PGSSL: "off" }, PROD), "pgssl_off_in_production"); });
t("production PGSSL=no-verify is refused", function () { refused(Object.assign({ PGSSL: "no-verify" }, PROD), "pgssl_no_verify_in_production"); });
t("production PGSSL=OFF (case/space) is refused", function () { refused(Object.assign({ PGSSL: " OFF " }, PROD), "pgssl_off_in_production"); });
["disable", "allow", "prefer", "no-verify"].forEach(function (m) {
  t("production URL sslmode=" + m + " is refused", function () {
    refused({ NODE_ENV: "production", DATABASE_URL: URL_PLAIN + "?sslmode=" + m }, "url_sslmode_insecure_in_production");
  });
});
t("unknown PGSSL value is refused everywhere", function () {
  refused(Object.assign({ PGSSL: "false" }, PROD), "unknown_pgssl_value");
  refused({ PGSSL: "0", DATABASE_URL: URL_PLAIN }, "unknown_pgssl_value");
});

// --- local development: explicit and separate ---
t("development default verifies certificates", function () {
  const r = pgSslConfig({ DATABASE_URL: URL_PLAIN });
  ok(r.ssl.rejectUnauthorized === true && r.warning === null);
});
t("development PGSSL=off disables TLS with a warning", function () {
  const r = pgSslConfig({ PGSSL: "off", DATABASE_URL: URL_PLAIN });
  ok(r.ssl === false && /local development only/.test(r.warning));
});
t("development PGSSL=no-verify skips verification with a warning", function () {
  const r = pgSslConfig({ PGSSL: "no-verify", DATABASE_URL: URL_PLAIN });
  ok(r.ssl.rejectUnauthorized === false && /NOT verified/.test(r.warning));
});
t("warnings never contain the connection string", function () {
  ["off", "no-verify"].forEach(function (m) {
    const w = pgSslConfig({ PGSSL: m, DATABASE_URL: URL_PLAIN }).warning;
    ok(w.indexOf("dbuser") < 0 && w.indexOf("db.example.test") < 0);
  });
});

// --- db.js wiring: the policy is applied and the old blanket bypass is gone ---
t("db.js applies pgSslConfig before loading the driver and has no unconditional bypass", function () {
  const src = fs.readFileSync(path.join(__dirname, "db.js"), "utf8");
  ok(/const tls = pgSslConfig\(process\.env\);/.test(src), "db.js computes the policy");
  ok(/ssl: tls\.ssl/.test(src), "db.js passes the policy to the pool");
  ok(src.indexOf("pgSslConfig(process.env)") < src.indexOf('require("pg")'), "policy runs before the driver loads");
  ok(!/rejectUnauthorized:\s*false/.test(src), "no rejectUnauthorized:false in db.js");
});

console.log("\ndb-tls.test.js: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
