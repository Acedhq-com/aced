/* Private pg-js transport boundary. No socket on factory construction.
   Supports the inspected Node20/pg8.22/parser2.14/pool3.14 contract only. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const tls = require("node:tls");
const { DbTlsConfigError } = require("./db-tls");
const standardIdentity = tls.checkServerIdentity;
const peerCertificate = tls.TLSSocket.prototype.getPeerCertificate;
const MARKER = "[db-tls] schema=1 event=application_connection_verified driver=pg-js encrypted=true authorized=true reject_unauthorized=true identity_checked=true scope=one_connection";
const refused = code => new DbTlsConfigError(code || "database_tls_not_verified");

function createPgPool(policy) {
  if (process.release.name !== "node" || process.versions.node.split(".")[0] !== "20" ||
      process.env.NODE_PG_FORCE_NATIVE ||
      (typeof navigator === "object" && navigator && navigator.userAgent === "Cloudflare-Workers")) {
    throw refused("unsupported_driver_runtime");
  }
  // The pinned driver's other Worker detector must also be refused BEFORE it
  // selects an optional/custom socket implementation.
  if (typeof Response === "function") {
    try {
      const response = new Response(null, { cf: { thing: true } });
      if (response.cf && response.cf.thing) throw refused("unsupported_driver_runtime");
    } catch (_) { throw refused("unsupported_driver_runtime"); }
  }
  let pgRoot;
  try {
    const pgMetadata = require.resolve("pg/package.json");
    pgRoot = path.dirname(pgMetadata);
    const library = path.dirname(require.resolve("pg"));
    if (library !== path.join(pgRoot, "lib") ||
        require.resolve("pg/lib/connection-parameters") !== path.join(library, "connection-parameters.js")) throw refused();
    for (const [filename, name, expected] of [
      [pgMetadata, "pg", "8.22.0"],
      [path.join(path.dirname(require.resolve("pg-connection-string", { paths: [library] })), "package.json"), "pg-connection-string", "2.14.0"],
      [path.join(path.dirname(require.resolve("pg-pool", { paths: [library] })), "package.json"), "pg-pool", "3.14.0"]
    ]) {
      const metadata = JSON.parse(fs.readFileSync(filename, "utf8"));
      if (metadata.name !== name || metadata.version !== expected) throw refused();
    }
  } catch (_) { throw refused("unsupported_driver_runtime"); }
  // Admission already stripped every security-bearing URL control. The actual
  // installed parser resolves all ordinary fields; no copied parser/second URL.
  const Parameters = require("pg/lib/connection-parameters");
  let parameters;
  try {
    parameters = new Parameters({ connectionString: policy.connectionString, ssl: policy.ssl, sslnegotiation: "postgres" });
  } catch (_) { throw refused("invalid_database_url"); }
  let host = parameters.host;
  if (typeof host === "string" && host.startsWith("[") && host.endsWith("]") && net.isIP(host.slice(1, -1)) === 6) host = host.slice(1, -1);
  const port = parameters.port;
  if (!host || typeof host !== "string" || host.startsWith("/") || host.includes("\0") ||
      !Number.isInteger(port) || port < 1 || port > 65535 || parameters.isDomainSocket) throw refused("invalid_database_target");
  const strict = !!policy.ssl && policy.ssl.rejectUnauthorized === true;
  const identity = (_inferred, certificate) => {
    try { return standardIdentity(host, certificate) ? refused() : undefined; }
    catch (_) { return refused(); }
  };
  const ssl = policy.ssl === false ? false : Object.freeze(strict ?
    { rejectUnauthorized: true, checkServerIdentity: identity } : { rejectUnauthorized: false });
  const pg = require("pg");
  const states = new WeakMap();
  let marked = false;

  function effective(client, state) {
    const p = client.connectionParameters, con = state.connection;
    return state.inputValid && client.connection === con && con instanceof pg.Connection &&
      client.host === host && client.port === port && p.host === host && p.port === port &&
      p.ssl === ssl && client.ssl === ssl && con.ssl === ssl &&
      p.sslnegotiation === "postgres" && client.sslNegotiation === "postgres" && con.sslNegotiation === "postgres" &&
      (!strict || (ssl.rejectUnauthorized === true && ssl.checkServerIdentity === identity));
  }
  function verified(client, state) {
    if (!effective(client, state)) throw refused();
    const socket = state.connection.stream;
    if (!(socket instanceof tls.TLSSocket) || socket !== state.socket || socket.destroyed || socket.connecting ||
        socket.encrypted !== true || socket.authorized !== true || socket.authorizationError != null ||
        socket._secureEstablished !== true || socket.secureConnecting !== false ||
        socket._rejectUnauthorized !== true || !socket._tlsOptions || socket._tlsOptions.rejectUnauthorized !== true) throw refused();
    let certificate;
    try {
      certificate = peerCertificate.call(socket, true);
      if (!certificate || !Buffer.isBuffer(certificate.raw) || certificate.raw.length === 0 ||
          standardIdentity(host, certificate)) throw refused();
    } catch (_) { throw refused(); }
    return socket;
  }
  function clean(state) {
    if (state.socket) {
      state.socket.removeListener("secureConnect", state.secure);
      state.socket.removeListener("error", state.error);
      state.socket.removeListener("close", state.close);
    }
    state.args = null;
  }
  function destroy(state) {
    if (state.destroyed) return;
    state.destroyed = true;
    const stream = state.connection.stream;
    if (stream instanceof net.Socket && !stream.destroyed) stream.destroy();
  }

  class VerifiedClient extends pg.Client {
    constructor(config) {
      // Unsupported overrides cannot execute a custom stream constructor.
      const inputValid = config.ssl === ssl && config.host === host && config.port === port &&
        !config.connection && !config.stream && !config.connectionString && config.sslnegotiation === "postgres";
      super({ ...config, password: config.password, ssl, host, port, connection: undefined, stream: undefined, sslnegotiation: "postgres" });
      const connection = this.connection;
      const state = { connection, inputValid, socket: null, requested: false, sent: false, failed: false, settled: false, started: false, destroyed: false, args: null };
      states.set(this, state);
      this.once("end", () => { state.failed = true; clean(state); state.socket = null; });
      if (!strict) return;
      const startup = connection.startup;
      const fail = () => {
        if (state.failed) return;
        state.failed = true;
        clean(state);
        // Existing driver connection/error pipeline owns callback settlement.
        connection.emit("error", refused());
        destroy(state);
      };
      state.error = fail;
      state.close = fail;
      state.secure = () => {
        if (state.failed || state.sent) return;
        try {
          verified(this, state);
          const args = state.args;
          state.sent = true; // Set BEFORE forwarding: reentrant events cannot replay.
          clean(state);
          startup.apply(connection, args);
        } catch (_) { fail(); }
      };
      connection.startup = (...args) => {
        if (state.requested || state.failed) return;
        state.requested = true;
        state.args = args;
        state.socket = connection.stream;
        if (!(state.socket instanceof tls.TLSSocket) || !effective(this, state)) return fail();
        state.socket.once("secureConnect", state.secure);
        state.socket.once("error", state.error);
        state.socket.once("close", state.close);
        if (state.socket._secureEstablished && !state.socket.secureConnecting) state.secure();
      };
    }
    _connect(callback) {
      const state = states.get(this);
      if (state.started) return super._connect(callback);
      state.started = true;
      const finish = (error, client) => {
        if (state.settled) return;
        state.settled = true;
        if (error) {
          const result = strict && !state.sent ? refused() : error;
          state.failed = true;
          clean(state);
          this._connectionError = true;
          clearTimeout(this.connectionTimeoutHandle);
          destroy(state);
          return callback(result);
        }
        callback(null, client);
      };
      if (!effective(this, state) || !(state.connection.stream instanceof net.Socket)) {
        this._connecting = true;
        return queueMicrotask(() => finish(refused()));
      }
      try { return super._connect(finish); }
      catch (_) { queueMicrotask(() => finish(refused())); }
    }
  }

  const onConnect = async client => {
    // pg invokes its connect callback before completing ReadyForQuery bookkeeping.
    // The actual awaited hook must observe that bookkeeping, not an event wrapper.
    await Promise.resolve();
    const state = states.get(client);
    if (!state || state.failed || !effective(client, state)) throw refused();
    if (strict) {
      verified(client, state);
      if (!state.sent || !client._connected || client.readyForQuery !== true) throw refused();
      if (policy.production && !marked) {
        marked = true;
        try { console.log(MARKER); } catch (_) { /* Verified connection remains true; never retry output. */ }
      }
    }
  };
  const options = { ...parameters, host, port, ssl, sslnegotiation: "postgres", Client: VerifiedClient, onConnect };
  Object.defineProperty(options, "password", { value: parameters.password, enumerable: false });
  const pool = new pg.Pool(options);
  for (const key of ["host", "port", "ssl", "sslnegotiation", "Client", "onConnect"]) {
    Object.defineProperty(pool.options, key, { value: options[key], writable: false, configurable: false, enumerable: true });
  }
  Object.defineProperty(pool, "Client", { value: VerifiedClient, writable: false, configurable: false });
  return pool;
}

module.exports = { createPgPool };
