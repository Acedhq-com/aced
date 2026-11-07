/* Local-only effective-driver/native TLS controls. No driver or network on require.
   Standalone requires the explicitly prepared, inspected dependency fixture. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const crypto = require("node:crypto");
const net = require("node:net");
const tls = require("node:tls");
const dns = require("node:dns");
const cp = require("node:child_process");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

const SERVER = __dirname;
const MARKER = "[db-tls] schema=1 event=application_connection_verified driver=pg-js encrypted=true authorized=true reject_unauthorized=true identity_checked=true scope=one_connection";
const sha = b => crypto.createHash("sha256").update(b).digest("hex");

function fixtureInfo(directory) {
  assert(directory && path.isAbsolute(directory), "explicit fixture path required");
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  const inventory = JSON.parse(fs.readFileSync(path.join(directory, "loaded-source-inspection-inventory.json"), "utf8"));
  const inspected = new Map(inventory.files.map(f => [path.join(directory, f.path), f.sha256]));
  for (const [filename, hash] of inspected) assert.equal(sha(fs.readFileSync(filename)), hash, "inspected source changed");
  for (const [name, version] of [["pg", "8.22.0"], ["pg-connection-string", "2.14.0"], ["pg-pool", "3.14.0"]]) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "node_modules", name, "package.json"), "utf8")).version, version);
  }
  return { directory, inspected };
}

function isolatedEnv(fixture, additions = {}) {
  return {
    PATH: process.env.PATH,
    HOME: path.join(fixture.directory, "home"),
    XDG_CONFIG_HOME: path.join(fixture.directory, "config"),
    PGPASSFILE: path.join(fixture.directory, "home/pgpass"),
    PGSYSCONFDIR: path.join(fixture.directory, "config"),
    ...additions
  };
}

// Scoped observation of the REAL Pool, not a replacement driver/parser.
// Source overrides are read-only causal controls; no modified source is persisted.
async function withBackend(fixture, env, body, overrides = {}) {
  const oldEnv = process.env, oldLoad = Module._load, oldResolve = Module._resolveFilename;
  const oldJs = Module._extensions[".js"];
  const owned = ["db.js", "db-tls.js", "db-tls-transport.js"].map(p => path.join(SERVER, p));
  const previous = new Map(owned.map(p => [p, require.cache[p]]));
  const pools = [], loads = [], output = [];
  const oldLog = console.log, oldWarn = console.warn;
  process.env = isolatedEnv(fixture, env);
  console.log = (...args) => output.push(args);
  console.warn = (...args) => output.push(args);
  for (const p of owned) delete require.cache[p];
  Module._resolveFilename = function (request, parent, ...rest) {
    if ((request === "pg" || request.startsWith("pg/")) && parent && owned.includes(parent.filename)) {
      return oldResolve.call(this, request, { ...parent, paths: [path.join(fixture.directory, "node_modules")] }, ...rest);
    }
    return oldResolve.call(this, request, parent, ...rest);
  };
  Module._extensions[".js"] = function (mod, filename) {
    if (filename.startsWith(path.join(fixture.directory, "node_modules") + path.sep)) {
      assert(fixture.inspected.has(filename), "uninspected downloaded JS refused");
      assert.equal(sha(fs.readFileSync(filename)), fixture.inspected.get(filename), "downloaded JS identity changed");
    }
    if (Object.hasOwn(overrides, filename)) return mod._compile(overrides[filename], filename);
    return oldJs(mod, filename);
  };
  Module._load = function (request, parent, ...rest) {
    if (request === "pgpass" && parent && parent.filename.startsWith(fixture.directory + path.sep)) assert.fail("explicit synthetic credentials must not consult pgpass");
    if (request === "better-sqlite3" && parent && owned.includes(parent.filename) && overrides.sqlite) return overrides.sqlite;
    if (parent && owned.includes(parent.filename) && (request === "pg" || request.startsWith("pg/") || request === "./db-tls-transport")) loads.push(request);
    const value = oldLoad.call(this, request, parent, ...rest);
    if (request === "pg" && parent && owned.includes(parent.filename)) {
      return Object.assign(Object.create(value), {
        Pool: new Proxy(value.Pool, {
          construct(Target, args, NewTarget) {
            const pool = Reflect.construct(Target, args, NewTarget);
            pools.push(pool);
            return pool;
          }
        })
      });
    }
    return value;
  };
  try {
    return await body({ load: () => require(path.join(SERVER, "db.js")), pools, loads, output });
  } finally {
    try {
      for (const pool of pools) if (!pool.ending) {
        for (const client of [...pool._clients]) {
          if (client.release && !pool._idle.some(item => item.client === client)) client.release(true);
        }
        await pool.end();
        assert.equal(pool.totalCount, 0, "no owned physical clients remain");
        assert.equal(pool.waitingCount, 0, "no pending leases remain");
      }
    } finally {
      for (const p of owned) {
        delete require.cache[p];
        if (previous.get(p)) require.cache[p] = previous.get(p);
      }
      Module._load = oldLoad;
      Module._resolveFilename = oldResolve;
      Module._extensions[".js"] = oldJs;
      process.env = oldEnv;
      console.log = oldLog;
      console.warn = oldWarn;
    }
  }
}

async function runBaseline(fixture) {
  const cases = [
    ["ssl-zero", "ssl=0"],
    ["ssl-noverify", "ssl=no-verify"],
    ["duplicate-mode", "sslmode=verify-full&sslmode=no-verify"],
    ["duplicate-switch", "ssl=1&ssl=0"],
    ["libpq-compat", "uselibpqcompat=true&sslmode=require"]
  ];
  const results = [];
  for (const [name, query] of cases) {
    const result = await withBackend(fixture, {
      NODE_ENV: "production", DATABASE_URL: "postgres://fixture_user:fixture_password@127.0.0.1:9/fixture_database?" + query
    }, async ({ load, pools }) => {
      load();
      assert.equal(pools.length, 1, "actual application Pool constructed");
      const client = new pools[0].Client(pools[0].options);
      const ssl = client.connectionParameters.ssl;
      const effective = ssl === false ? "plaintext" : ssl && ssl.rejectUnauthorized === false ? "unverified" : "strict";
      assert.notEqual(effective, "strict", "baseline must exhibit the actual insecure effective driver setting");
      let attempts = 0;
      const connect = net.Socket.prototype.connect;
      net.Socket.prototype.connect = function (port, host) {
        assert.equal(host, "127.0.0.1", "only synthetic loopback destination");
        assert.equal(port, 9);
        attempts++;
        queueMicrotask(() => this.destroy(Object.assign(new Error("Controlled local baseline stop"), { code: "LOCAL_BASELINE_STOP" })));
        return this;
      };
      let error;
      try { await client.connect(); } catch (e) { error = e; }
      finally { net.Socket.prototype.connect = connect; await client.end(); }
      assert.equal(error && error.code, "LOCAL_BASELINE_STOP");
      assert.equal(attempts, 1);
      let causal;
      try { assert.equal(attempts, 0, "insecure configuration must refuse before the actual driver attempts a socket"); }
      catch (e) { assert.equal(e.code, "ERR_ASSERTION"); causal = e.name; }
      assert.equal(causal, "AssertionError");
      return { name, effective, actualDriverNetworkAttempts: attempts, desiredRefusal: "RED", failure: causal };
    });
    results.push(result);
  }
  console.log(JSON.stringify({ mode: "actual163-baseline", constructorEvidence: true, nativeHandshakeEvidence: false, results }));
  fs.writeFileSync(path.join(fixture.directory, "actual163-baseline-red.json"), JSON.stringify(results, null, 2), { flag: "wx", mode: 0o600 });
}

async function admissionControls(fixture, overrides = {}) {
  let passed = 0;
  for (const query of ["ssl=0", "ssl=no-verify", "sslmode=verify-full&sslmode=no-verify", "ssl=1&ssl=0", "uselibpqcompat=true&sslmode=require"]) {
    await withBackend(fixture, {
      NODE_ENV: "production", DATABASE_URL: "postgres://fixture_user:fixture_password@127.0.0.1:9/fixture_database?" + query
    }, async ({ load, pools, loads, output }) => {
      let attempts = 0, error, db;
      const connect = net.Socket.prototype.connect;
      net.Socket.prototype.connect = function (port, host) {
        assert.equal(port, 9); assert.equal(host, "127.0.0.1"); attempts++;
        queueMicrotask(() => this.destroy(Object.assign(new Error("Controlled local admission stop"), { code: "LOCAL_BASELINE_STOP" })));
        return this;
      };
      try {
        try { db = load(); } catch (e) { error = e; }
        if (db) { try { await db.users.get("fixture-id"); } catch (e) { error = e; } }
      } finally { net.Socket.prototype.connect = connect; }
      // The SAME pre-socket oracle that failed for each actual163 case.
      assert.equal(attempts, 0, "insecure configuration must refuse before the actual driver attempts a socket");
      assert(error && ["unsupported_tls_configuration", "ambiguous_tls_configuration"].includes(error.code));
      assert.equal(loads.length, 0); assert.equal(pools.length, 0); assert.equal(output.length, 0);
      passed++;
    }, overrides);
  }
  return { passed, failed: 0 };
}

async function runUnit() {
  const { pgSslConfig, DbTlsConfigError } = require("./db-tls");
  const base = { NODE_ENV: "production", DATABASE_URL: "postgres://fixture_user:fixture_password@localhost:5432/fixture_database" };
  let passed = 0, failed = 0;
  const test = async (name, fn) => {
    try { await fn(); passed++; }
    catch (e) { failed++; console.error("TLS unit FAIL: " + name + " (" + (e.code || e.name) + ")"); }
  };
  const policy = (query, rest = {}) => pgSslConfig({ ...base, DATABASE_URL: base.DATABASE_URL + query, ...rest });
  const bad = (query, code, rest) => assert.throws(() => policy(query, rest), e => e instanceof DbTlsConfigError && e.code === code && !e.cause);
  for (const query of ["?ssl=0", "?ssl=no-verify", "?ssl=false", "?ssl=", "?ssl=unknown", "?sslmode=", "?sslmode=unknown"]) {
    await test("insecure/unknown switch refused " + query.split("=")[0], () => bad(query, "unsupported_tls_configuration"));
  }
  for (const query of [
    "?sslmode=verify-full&sslmode=no-verify", "?sslmode=no-verify&sslmode=verify-full",
    "?ssl=1&ssl=0", "?ssl=0&ssl=1", "?ssl=1&ssl=1", "?ssl=1&%73sl=1",
    "?host=localhost&host=localhost", "?port=5432&%70ort=5432"
  ]) await test("all decoded duplicate occurrences refuse", () => bad(query, "ambiguous_tls_configuration"));
  for (const query of ["?SSL=1", "?Host=localhost", "?PORT=5432", "?sslunknown=true", "?sslcert=", "?%73slkey=fixture.key", "?sslrootcert=fixture.crt", "?uselibpqcompat=true", "?uselibpqcompat=", "?sslnegotiation=direct", "?service=fixture"]) {
    await test("unsupported controls refuse before parser", () => bad(query, "unsupported_tls_configuration"));
  }
  for (const [key, value, code] of [
    ["NODE_PG_FORCE_NATIVE", "0", "unsupported_driver_runtime"],
    ["NODE_PG_FORCE_NATIVE", "1", "unsupported_driver_runtime"],
    ["PGSSLNEGOTIATION", "direct", "unsupported_tls_configuration"],
    ["PGSSLNEGOTIATION", "", "unsupported_tls_configuration"]
  ]) await test("unsupported runtime/negotiation before driver", () => assert.throws(() => pgSslConfig({ ...base, [key]: value }), e => e.code === code));
  for (const url of ["", "not-a-url", "mysql://localhost/db", "postgres:///db", "postgres://localhost/db?bad=%QQ", "postgres://%2Ftmp/db", "postgres://localhost/db?host=/tmp", "postgres://localhost/db?port=5432junk", "postgres://localhost/db?port=0", "postgres://localhost/db?port=65536"]) {
    await test("malformed URL/TCP target refuses", () => assert.throws(() => pgSslConfig({ ...base, DATABASE_URL: url }), e => e instanceof DbTlsConfigError));
  }
  await test("safe controls consumed; actual ordinary duplicate meaning left to parser", () => {
    const result = policy("?ssl=true&sslmode=REQUIRE&uselibpqcompat=false&sslnegotiation=postgres&application_name=one&application_name=two&host=localhost&port=5432");
    const url = new URL(result.connectionString);
    assert.equal(result.ssl.rejectUnauthorized, true);
    for (const key of ["ssl", "sslmode", "uselibpqcompat", "sslnegotiation"]) assert(!url.searchParams.has(key));
    assert.deepEqual(url.searchParams.getAll("application_name"), ["one", "two"]);
  });
  await test("IPv6 target brackets admitted, malformed target refused", () => {
    assert.equal(policy("", { DATABASE_URL: "postgres://fixture_user:fixture_password@[::1]:5432/fixture_database" }).ssl.rejectUnauthorized, true);
    bad("?host=[not-ip]", "invalid_database_target");
  });
  for (const mode of ["", "verify", "off", "no-verify"]) await test("development explicit precedence, sanitized insecure URL", () => {
    const result = policy("?ssl=0&sslmode=no-verify", { NODE_ENV: "development", PGSSL: mode });
    assert.equal(result.ssl === false ? "off" : result.ssl.rejectUnauthorized ? "verify" : "no-verify", mode || "verify");
    assert(result.warning);
    assert(!new URL(result.connectionString).searchParams.has("ssl"));
  });
  await test("actual source admission refuses before private factory/driver load or filesystem selection", async () => {
    const fakeFixture = { directory: path.join(SERVER, "__absent_unit_fixture__"), inspected: new Map() };
    let reads = 0;
    const read = fs.readFileSync;
    fs.readFileSync = function (file, ...rest) {
      if (file === "fixture.key") { reads++; throw new Error("forbidden fixture key read"); }
      return read.call(this, file, ...rest);
    };
    try {
      await withBackend(fakeFixture, { ...base, DATABASE_URL: base.DATABASE_URL + "?sslkey=fixture.key" }, async ({ load, loads, pools }) => {
        assert.throws(load, e => e.code === "unsupported_tls_configuration");
        assert.equal(loads.length, 0); assert.equal(pools.length, 0);
      });
    } finally { fs.readFileSync = read; }
    assert.equal(reads, 0);
  });
  await test("fixed errors do not contain synthetic inputs or nested causes", () => {
    let error;
    try { policy("?sslrootcert=fixture-private-sentinel"); } catch (e) { error = e; }
    assert(error && !error.message.includes("fixture-private-sentinel") && !error.message.includes("fixture_password") && !error.cause);
  });
  await test("actual unchanged SQLite source uses only the in-memory stand-in and no PG/marker", async () => {
    const fakeFixture = { directory: path.join(SERVER, "__absent_unit_fixture__"), inspected: new Map() };
    let constructed = 0, executed = 0;
    class Database {
      constructor() { constructed++; }
      pragma() {}
      exec() { executed++; }
      prepare() { return { all: () => ["token_version", "handle", "source", "state_hash"].map(name => ({ name })), get: () => ({ id: "fixture-id" }), run: () => ({ changes: 1 }) }; }
    }
    await withBackend(fakeFixture, { DB_PATH: ":memory:" }, async ({ load, loads, pools, output }) => {
      const db = load();
      assert.equal(db.kind, "sqlite (:memory:)");
      assert.equal((await db.users.get("fixture-id")).id, "fixture-id");
      assert.equal(loads.length, 0); assert.equal(pools.length, 0); assert.equal(output.length, 0);
    }, { sqlite: Database });
    assert.equal(constructed, 1); assert.equal(executed, 1);
  });
  await test("unsupported Node refuses before resolving any downloaded driver", () => {
    const code = fs.readFileSync(path.join(SERVER, "db-tls-transport.js"), "utf8");
    let resolutions = 0;
    const localRequire = name => name === "./db-tls" ? { DbTlsConfigError } : require(name);
    localRequire.resolve = () => { resolutions++; throw new Error("must not resolve"); };
    const mod = { exports: {} };
    const factory = vm.runInNewContext(Module.wrap(code), { process: { release: { name: "node" }, versions: { node: "22.0.0" }, env: {} }, Buffer, console, queueMicrotask, clearTimeout });
    factory(mod.exports, localRequire, mod, path.join(SERVER, "db-tls-transport.js"), SERVER);
    assert.throws(() => mod.exports.createPgPool({}), e => e.code === "unsupported_driver_runtime");
    assert.equal(resolutions, 0);
  });
  await test("unit counterfeit authorized flags cannot create native proof or a marker", async () => {
    // Explicit UNIT stand-ins exercise only a refusal branch, never positive
    // driver resolution/TLS evidence or a copied connection-string algorithm.
    class Connection extends EventEmitter {
      constructor(config) { super(); this.ssl = config.ssl; this.sslNegotiation = "postgres"; this.stream = new net.Socket(); Object.assign(this.stream, { authorized: true, encrypted: true }); }
      startup() { throw new Error("counterfeit must never forward"); }
    }
    class Client extends EventEmitter {
      constructor(config) {
        super(); this.connectionParameters = { ...config }; this.host = config.host; this.port = config.port; this.ssl = config.ssl; this.sslNegotiation = "postgres"; this.connection = new Connection(config);
      }
      _connect(cb) { this.connection.once("error", cb); this.connection.startup({}); }
      connect(cb) { if (cb) return this._connect(cb); return new Promise((resolve, reject) => this._connect(e => e ? reject(e) : resolve(this))); }
    }
    class Pool { constructor(options) { this.options = { ...options }; this.Client = options.Client; } }
    const fakePg = { Client, Connection, Pool };
    const code = fs.readFileSync(path.join(SERVER, "db-tls-transport.js"), "utf8");
    const localRequire = name => {
      if (name === "./db-tls") return { DbTlsConfigError };
      if (name === "node:fs") return { readFileSync: p => JSON.stringify({ name: p.includes("pg-connection-string") ? "pg-connection-string" : p.includes("pg-pool") ? "pg-pool" : "pg", version: p.includes("pg-connection-string") ? "2.14.0" : p.includes("pg-pool") ? "3.14.0" : "8.22.0" }) };
      if (name === "pg") return fakePg;
      if (name === "pg/lib/connection-parameters") return class { constructor(c) { Object.assign(this, { host: "localhost", port: 5432, ssl: c.ssl, sslnegotiation: "postgres", password: "fixture_password" }); } };
      return require(name);
    };
    localRequire.resolve = name => name === "pg" ? "/unit-only/pg/lib/index.js" : name === "pg/lib/connection-parameters" ? "/unit-only/pg/lib/connection-parameters.js" : "/unit-only/" + name + (name.endsWith("package.json") ? "" : "/index.js");
    const mod = { exports: {} }, logs = [];
    vm.runInNewContext(Module.wrap(code), { process: { release: { name: "node" }, versions: { node: "20.20.2" }, env: {} }, Buffer, console: { log: x => logs.push(x) }, queueMicrotask, clearTimeout })(mod.exports, localRequire, mod, "", "");
    const pool = mod.exports.createPgPool({ ssl: { rejectUnauthorized: true }, production: true, connectionString: "unit-only-unused" });
    const client = new pool.Client(pool.options);
    await assert.rejects(client.connect(), e => e.code === "database_tls_not_verified");
    assert.equal(logs.length, 0); assert(client.connection.stream.destroyed);
    const invalid = new pool.Client({ ...pool.options, ssl: { rejectUnauthorized: false } });
    let sync = true;
    await new Promise(resolve => {
      invalid.connect(e => { assert.equal(sync, false); assert.equal(e.code, "database_tls_not_verified"); resolve(); });
      sync = false;
    });
  });
  return { passed, failed };
}

function prepareCertificates(fixture) {
  const dir = path.join(fixture.directory, "certs"), manifest = path.join(dir, "generated.json");
  if (fs.existsSync(manifest)) {
    const existing = JSON.parse(fs.readFileSync(manifest, "utf8"));
    for (const [name, hash] of Object.entries(existing.certificateHashes)) assert.equal(sha(fs.readFileSync(path.join(dir, name))), hash, "synthetic certificate drift");
    return existing;
  }
  const started = Date.now();
  fs.writeFileSync(path.join(dir, "generation-reserved.json"), JSON.stringify({ started }), { flag: "wx", mode: 0o600 });
  const config = path.join(fixture.directory, "config/openssl.cnf");
  const run = args => {
    assert(Date.now() - started < 60000, "total generation budget");
    const r = cp.spawnSync("openssl", args, { cwd: dir, env: { PATH: process.env.PATH, HOME: path.join(fixture.directory, "home"), OPENSSL_CONF: config }, timeout: Math.min(30000, 60000 - (Date.now() - started)), encoding: "utf8" });
    assert.equal(r.status, 0, "owned synthetic certificate generation failed");
    assert(!r.error);
  };
  run(["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", "ca.key", "-out", "ca.crt", "-days", "1", "-subj", "/CN=ACED-Local-Fixture-CA", "-addext", "basicConstraints=critical,CA:TRUE", "-config", config]);
  for (const [name, san, serial] of [["dns", "DNS:localhost", "2"], ["ip", "IP:127.0.0.1,IP:::1,DNS:localhost", "3"]]) {
    run(["req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", name + ".key", "-out", name + ".csr", "-subj", "/CN=localhost", "-config", config]);
    fs.writeFileSync(path.join(dir, name + ".ext"), "basicConstraints=critical,CA:FALSE\nsubjectAltName=" + san + "\nextendedKeyUsage=serverAuth\n", { flag: "wx", mode: 0o600 });
    run(["x509", "-req", "-in", name + ".csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-set_serial", serial, "-days", "1", "-extfile", name + ".ext", "-out", name + ".crt"]);
  }
  run(["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", "untrusted.key", "-out", "untrusted.crt", "-days", "1", "-subj", "/CN=localhost", "-addext", "basicConstraints=critical,CA:FALSE", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-config", config]);
  const hashes = Object.fromEntries(["ca.crt", "dns.crt", "ip.crt", "untrusted.crt"].map(p => [p, sha(fs.readFileSync(path.join(dir, p)))]));
  const result = { generatedCa: 1, generatedLeaves: 3, elapsedMs: Date.now() - started, certificateHashes: hashes,
    openssl: cp.execFileSync("openssl", ["version"], { env: { PATH: process.env.PATH, HOME: path.join(fixture.directory, "home"), OPENSSL_CONF: config }, timeout: 30000, encoding: "utf8" }).trim() };
  fs.writeFileSync(manifest, JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
  return result;
}

function int32(value) { const b = Buffer.alloc(4); b.writeInt32BE(value); return b; }
function frame(type, bytes = Buffer.alloc(0)) { return Buffer.concat([Buffer.from(type), int32(bytes.length + 4), bytes]); }
const ready = () => frame("Z", Buffer.from("I"));
function rows() {
  const names = ["id", "email", "json", "updated_at"];
  const values = ["fixture-id", "fixture-local-value", '{"fixture":true}', "1234"];
  const n = Buffer.alloc(2); n.writeInt16BE(names.length);
  const fields = names.map((name, i) => {
    const f = Buffer.alloc(18); f.writeInt32BE(i === 3 ? 20 : 25, 6); f.writeInt16BE(-1, 10); f.writeInt32BE(-1, 12);
    return Buffer.concat([Buffer.from(name + "\0"), f]);
  });
  const data = values.map(v => Buffer.concat([int32(Buffer.byteLength(v)), Buffer.from(v)]));
  return { description: frame("T", Buffer.concat([n, ...fields])), data: frame("D", Buffer.concat([n, ...data])) };
}

async function peer(fixture, options = {}) {
  const counts = { accepted: 0, startup: 0, password: 0, query: 0, sslRequest: 0 }, phases = [];
  let protocolFailure = false;
  const sockets = new Set(), secureSockets = new Set(), pending = new Set();
  const certificates = new Map(["dns", "ip", "untrusted"].map(name => [name, tls.createSecureContext({
    key: fs.readFileSync(path.join(fixture.directory, "certs", name + ".key")),
    cert: fs.readFileSync(path.join(fixture.directory, "certs", name + ".crt"))
  })]));
  const server = net.createServer(raw => {
    counts.accepted++;
    if (counts.accepted > 16 || sockets.size >= 2) { protocolFailure = true; raw.destroy(); return; }
    sockets.add(raw);
    const closed = new Promise(resolve => raw.once("close", () => { sockets.delete(raw); resolve(); }));
    pending.add(closed); closed.finally(() => pending.delete(closed));
    raw.on("error", () => {});
    const protocol = stream => {
      let buffer = Buffer.alloc(0), started = false;
      stream.on("data", bytes => {
        try {
        buffer = Buffer.concat([buffer, bytes]); assert(buffer.length <= 1048576, "bounded PG frame buffer");
        for (;;) {
          if (!started) {
            if (buffer.length < 4) return;
            const length = buffer.readInt32BE(0);
            assert(length >= 8 && length <= 1048576);
            if (buffer.length < length) return;
            assert.equal(buffer.readInt32BE(4), 196608);
            counts.startup++; phases.push("startup");
            assert(buffer.subarray(8, length).includes(Buffer.from("user\0fixture_user\0")), "synthetic Startup user preserved");
            assert(buffer.subarray(8, length).includes(Buffer.from("database\0fixture_database\0")), "synthetic Startup database preserved");
            if (options.applicationName) assert(buffer.subarray(8, length).includes(Buffer.from("application_name\0" + options.applicationName + "\0")), "synthetic Startup application name preserved");
            buffer = buffer.subarray(length); started = true;
            stream.write(frame("R", int32(3)));
          } else {
            if (buffer.length < 5) return;
            const type = String.fromCharCode(buffer[0]), length = buffer.readInt32BE(1);
            assert(length >= 4 && length <= 1048576);
            if (buffer.length < length + 1) return;
            const payload = buffer.subarray(5, length + 1);
            buffer = buffer.subarray(length + 1);
            if (type === "p") {
              counts.password++; phases.push("password");
              assert(payload.equals(Buffer.from("fixture_password\0")), "synthetic password bytes preserved");
              if (options.authFailure) stream.end(frame("E", Buffer.from("SFATAL\0C28P01\0MControlled authentication refusal\0\0")));
              else stream.write(Buffer.concat([frame("R", int32(0)), ready()]));
            } else if (type === "Q") {
              counts.query++; phases.push("query");
              const r = rows();
              stream.write(options.queryFailure ? Buffer.concat([frame("E", Buffer.from("SERROR\0C23505\0MControlled query refusal\0\0")), ready()]) :
                Buffer.concat([r.description, r.data, frame("C", Buffer.from("SELECT 1\0")), ready()]));
            } else if (type === "P") stream.write(frame("1"));
            else if (type === "B") stream.write(frame("2"));
            else if (type === "D") stream.write(rows().description);
            else if (type === "E") {
              counts.query++; phases.push("query");
              stream.write(options.queryFailure ? frame("E", Buffer.from("SERROR\0C23505\0MControlled query refusal\0\0")) : Buffer.concat([rows().data, frame("C", Buffer.from("SELECT 1\0"))]));
            }
            else if (type === "S") stream.write(ready());
            else if (type === "X") stream.end();
            else assert.fail("unsupported synthetic protocol frame");
          }
        }
        } catch (_) { protocolFailure = true; stream.destroy(); }
      });
    };
    if (options.plain) return protocol(raw);
    raw.once("data", bytes => {
      try {
      assert.equal(bytes.length, 8); assert.equal(bytes.readInt32BE(0), 8); assert.equal(bytes.readInt32BE(4), 80877103);
      counts.sslRequest++;
      if (options.refuse) return raw.end("N");
      if (options.incomplete) { raw.write("S"); return raw.end(); }
      raw.write("S");
      const name = options.badSecond && counts.accepted > 1 ? "untrusted" : options.certificate || "ip";
      const secure = new tls.TLSSocket(raw, { isServer: true, secureContext: certificates.get(name) });
      secureSockets.add(secure);
      secure.once("close", () => { secureSockets.delete(secure); sockets.delete(raw); });
      secure.on("error", () => secure.destroy());
      protocol(secure);
      } catch (_) { protocolFailure = true; raw.destroy(); }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, options.ipv6 ? "::1" : "127.0.0.1", resolve);
  });
  return {
    port: server.address().port, counts, phases, server,
    get protocolFailed() { return protocolFailure; },
    async close() {
      for (const s of secureSockets) s.destroy();
      for (const s of sockets) s.destroy();
      await new Promise(resolve => server.close(resolve));
      await Promise.all([...pending]);
      assert.equal(server.listening, false); assert.equal(sockets.size, 0); assert.equal(secureSockets.size, 0);
    }
  };
}

async function nativeSuite(fixture, adverseOnly = false) {
  const results = [], originalLookup = dns.lookup, originalConnect = net.Socket.prototype.connect;
  let activePeer, lookups = 0;
  dns.lookup = function (host, options, callback) {
    if (typeof options === "function") { callback = options; options = {}; }
    assert(["localhost", "wrong.test", "127.0.0.1", "::1"].includes(host), "no external DNS");
    lookups++;
    const address = host === "::1" ? "::1" : "127.0.0.1", family = host === "::1" ? 6 : 4;
    queueMicrotask(() => callback(null, options && options.all ? [{ address, family }] : address, family));
  };
  net.Socket.prototype.connect = function (...args) {
    const args0 = typeof args[0] === "object" ? args[0] : { port: args[0], host: args[1] };
    assert(activePeer && Number(args0.port) === activePeer.port, "only current loopback peer port");
    assert(["127.0.0.1", "::1", "localhost", "wrong.test"].includes(args0.host), "only explicit local mappings");
    return originalConnect.apply(this, args);
  };
  async function test(name, options, body) {
    const p = await peer(fixture, options);
    activePeer = p;
    let timer, error;
    try {
      await Promise.race([body(p), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("native case timeout"), { code: "CASE_TIMEOUT" })), 10000);
      })]);
    } catch (e) { error = e; }
    finally { clearTimeout(timer); await p.close(); activePeer = null; }
    if (p.protocolFailed) error = Object.assign(new Error("Controlled peer protocol mismatch"), { code: "PEER_PROTOCOL_MISMATCH" });
    results.push({ name, pass: !error, error: error ? error.code || error.name : null, ...p.counts, phases: p.phases, listenerClosed: true });
    if (error) throw Object.assign(new Error("native control failed: " + name), { code: error.code || error.name, caseName: name, partialResults: results });
  }
  const env = (p, host = "127.0.0.1", suffix = "", extra = {}) => ({
    NODE_ENV: "production",
    DATABASE_URL: "postgres://fixture_user:fixture_password@" + host + ":" + p.port + "/fixture_database" + suffix,
    ...(adverseOnly ? { NODE_TLS_REJECT_UNAUTHORIZED: "0", PGSSLMODE: "disable" } : {}), ...extra
  });
  const markerCount = output => output.filter(a => a.length === 1 && a[0] === MARKER).length;
  const failure = async (p, host, extra = {}) => withBackend(fixture, env(p, host, "", extra), async ({ load, pools, output }) => {
    const db = load();
    await assert.rejects(db.users.get("fixture-id"), e => {
      assert.equal(e.code, "database_tls_not_verified");
      for (const taint of ["fixture_user", "fixture_password", "wrong.test", "BEGIN CERTIFICATE"]) assert(!e.message.includes(taint));
      assert(!e.cause && !e.cert && !e.host);
      return true;
    });
    assert.equal(markerCount(output), 0);
    assert.equal(p.counts.startup, 0); assert.equal(p.counts.password, 0); assert.equal(p.counts.query, 0);
    assert.equal(pools[0].totalCount, 0);
  });
  try {
    await test(adverseOnly ? "unsafe-global-default-and-PGSSLMODE-still-strict" : "trusted-DNS-before-startup-and-actual-repository-result", { certificate: "dns" }, p =>
      withBackend(fixture, env(p, "localhost"), async ({ load, pools, output }) => {
        const checks = [], startups = [], oldIdentity = tls.checkServerIdentity, oldTls = tls.connect;
        const req = Module.createRequire(path.join(fixture.directory, "package.json")), pg = req("pg"), oldStartup = pg.Connection.prototype.startup;
        pg.Connection.prototype.startup = function (...args) {
          startups.push(this.stream instanceof tls.TLSSocket && this.stream.authorized === true && this.stream._secureEstablished === true && this.stream._rejectUnauthorized === true);
          this.emit("sslconnect"); // Synchronous reentrancy must not replay Startup.
          return oldStartup.apply(this, args);
        };
        tls.checkServerIdentity = function (host, cert) { checks.push({ beforeStartup: p.counts.startup === 0, ip: net.isIP(host) }); return oldIdentity(host, cert); };
        const sockets = [];
        tls.connect = function (options, ...args) { assert.equal(options.rejectUnauthorized, true); const s = oldTls.call(this, options, ...args); sockets.push(s); return s; };
        try {
          const db = load(), result = await db.users.get("fixture-id");
          assert.equal(result.id, "fixture-id"); assert.equal(result.updated_at, "1234");
          assert.equal(markerCount(output), 1); assert.equal(p.counts.startup, 1); assert.equal(p.counts.password, 1); assert.equal(p.counts.query, 1);
          assert(checks.some(c => c.beforeStartup)); assert(checks.length >= 3); assert.equal(sockets.length, 1);
          assert.deepEqual(startups, [true], "original Startup only after actual native authorization");
          const s = sockets[0]; assert(s instanceof tls.TLSSocket && s.authorized && s._rejectUnauthorized && s._tlsOptions.rejectUnauthorized);
          assert.equal(pools[0].options.connectionString, undefined);
          assert.equal(Object.getOwnPropertyDescriptor(pools[0].options, "password").enumerable, false);
        } finally { tls.connect = oldTls; tls.checkServerIdentity = oldIdentity; pg.Connection.prototype.startup = oldStartup; }
      }));
    await test("DNS-only-certificate-rejected-for-IP-target", { certificate: "dns" }, p => failure(p, "127.0.0.1"));
    if (!adverseOnly) {
      await test("trusted-IP-SAN-and-state-number-conversion", {}, p => withBackend(fixture, env(p), async ({ load, output }) => {
        const result = await load().state.get("fixture-user", "fixture-pack");
        assert.deepEqual(result, { json: '{"fixture":true}', updated_at: 1234 });
        assert.equal(markerCount(output), 1);
      }));
      await test("constructor-and-separate-trusted-TLS-probe-never-attest-application", {}, p => withBackend(fixture, env(p), async ({ load, pools, output }) => {
        load(); assert.equal(markerCount(output), 0); assert.equal(pools[0].totalCount, 0);
        const raw = new net.Socket();
        await new Promise((resolve, reject) => { raw.once("error", reject); raw.connect(p.port, "127.0.0.1", resolve); });
        const reply = new Promise((resolve, reject) => { raw.once("data", resolve); raw.once("error", reject); });
        raw.write(Buffer.concat([int32(8), int32(80877103)])); assert.equal((await reply).toString(), "S");
        const secure = tls.connect({ socket: raw, rejectUnauthorized: true, checkServerIdentity: (_host, cert) => tls.checkServerIdentity("127.0.0.1", cert) });
        try { await new Promise((resolve, reject) => { secure.once("secureConnect", resolve); secure.once("error", reject); }); assert.equal(secure.authorized, true); }
        finally { const closed = new Promise(resolve => secure.once("close", resolve)); secure.end(); await closed; }
        assert.equal(markerCount(output), 0); assert.equal(p.counts.startup, 0); assert.equal(p.counts.password, 0); assert.equal(p.counts.query, 0);
      }));
      await test("ordinary-resolved-fields-preserved-no-arbitrary-URL-hook-spread", { applicationName: "two" }, p => withBackend(fixture, env(p, "127.0.0.1", "?application_name=one&application_name=two&client_encoding=UTF8&query_timeout=2000&Client=ignored&onConnect=ignored&stream=ignored"), async ({ load, pools }) => {
        load(); const c = await pools[0].connect();
        try {
          assert.equal(c.connectionParameters.application_name, "two"); assert.equal(c.connectionParameters.client_encoding, "UTF8"); assert.equal(c.connectionParameters.query_timeout, "2000");
          assert(c.password === "fixture_password", "synthetic password preserved"); assert.equal(pools[0].options.stream, undefined); await c.query("SELECT 1");
        } finally { c.release(); }
      }));
      await test("actual-client-preIO-tamper-refuses-asynchronously-once", {}, p => withBackend(fixture, env(p), async ({ load, pools, output }) => {
        load(); const c = new pools[0].Client(pools[0].options); c.host = "wrong.test";
        let callbacks = 0, synchronous = true;
        await new Promise((resolve, reject) => {
          c.connect(error => {
            try { callbacks++; assert.equal(synchronous, false); assert.equal(error.code, "database_tls_not_verified"); resolve(); }
            catch (e) { reject(e); }
          });
          synchronous = false;
        });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(callbacks, 1); assert.equal(p.counts.accepted, 0); assert.equal(markerCount(output), 0);
        assert.equal(c.connection.stream.destroyed, true);
      }));
      for (const name of ["pg", "pg-connection-string", "pg-pool"]) await test("actual-resolved-" + name + "-version-mismatch-before-driver-evaluation", {}, p => {
        const read = fs.readFileSync, metadata = path.join(fixture.directory, "node_modules", name, "package.json");
        fs.readFileSync = function (filename, ...args) {
          const value = read.call(this, filename, ...args);
          if (filename === metadata) return JSON.stringify({ version: "0.0.0" });
          return value;
        };
        return withBackend(fixture, env(p), async ({ load, loads, pools, output }) => {
          assert.throws(load, e => e.code === "unsupported_driver_runtime");
          assert(!loads.some(n => n === "pg" || n.startsWith("pg/")));
          assert.equal(pools.length, 0); assert.equal(p.counts.accepted, 0); assert.equal(markerCount(output), 0);
        }).finally(() => { fs.readFileSync = read; });
      });
      await test("wrong-actual-DNS-rejected", { certificate: "dns" }, p => failure(p, "wrong.test"));
      await test("unique-host-port-override-binds-effective-target", { certificate: "dns" }, p => {
        const e = env(p); e.DATABASE_URL = "postgres://fixture_user:fixture_password@authority.test:9/fixture_database?host=localhost&port=" + p.port;
        return withBackend(fixture, e, async ({ load, pools }) => { await load().users.get("fixture-id"); assert.equal(pools[0].options.host, "localhost"); assert.equal(pools[0].options.port, p.port); });
      });
      for (const [name, options] of [["untrusted-chain", { certificate: "untrusted" }], ["TLS-refusing-peer", { refuse: true }], ["closed-incomplete-handshake", { incomplete: true }]]) {
        await test(name, options, p => failure(p, "127.0.0.1"));
      }
      await test("IPv6-bracket-normalization-and-native-IP-SAN", { ipv6: true }, p => withBackend(fixture, env(p, "[::1]"), async ({ load, pools }) => {
        await load().users.get("fixture-id"); assert.equal(pools[0].options.host, "::1"); assert.equal(p.counts.startup, 1);
      }));
      await test("pool-two-clients-queue-reuse-callback-promise-replacement-singleton", {}, p => withBackend(fixture, env(p), async ({ load, pools, output }) => {
        load(); const pool = pools[0]; pool.options.max = 2;
        const first = await pool.connect(), second = await new Promise((resolve, reject) => pool.connect((e, c) => e ? reject(e) : resolve(c)));
        let acquired = false;
        const pending = pool.connect().then(c => { acquired = true; return c; });
        await Promise.resolve(); assert.equal(acquired, false); assert.equal(pool.waitingCount, 1);
        first.release(); const reused = await pending; assert.equal(reused, first);
        await new Promise((resolve, reject) => reused.query("SELECT 1", (e, r) => { if (e) reject(e); else { assert.equal(r.rows[0].id, "fixture-id"); resolve(); } }));
        reused.connection.emit("sslconnect"); reused.connection.emit("sslconnect");
        reused.release(); second.release(true);
        await new Promise(resolve => second.once("end", resolve));
        const again = await pool.connect(); again.release(true);
        await new Promise(resolve => again.once("end", resolve));
        const replacement = await pool.connect(); await replacement.query("SELECT 1"); replacement.release();
        assert.equal(markerCount(output), 1); assert.equal(p.counts.startup, 3); assert.equal(p.counts.password, 3);
        assert.equal(pool.waitingCount, 0);
        assert.throws(() => replacement.release(), /already been released/);
      }));
      await test("bad-second-client-after-verified-first-still-rejected", { badSecond: true }, p => withBackend(fixture, env(p), async ({ load, pools, output }) => {
        load(); const pool = pools[0], first = await pool.connect();
        try { await assert.rejects(pool.connect(), e => e.code === "database_tls_not_verified"); }
        finally { first.release(); }
        assert.equal(markerCount(output), 1); assert.equal(p.counts.startup, 1); assert.equal(p.counts.password, 1); assert.equal(p.counts.query, 0);
      }));
      await test("auth-error-code-preserved-and-no-marker", { authFailure: true }, p => withBackend(fixture, env(p), async ({ load, output, pools }) => {
        await assert.rejects(load().users.get("fixture-id"), e => e.code === "28P01");
        assert.equal(markerCount(output), 0); assert.equal(p.counts.query, 0); assert.equal(pools[0].totalCount, 0);
      }));
      await test("ordinary-query-error-code-preserved-marker-is-not-query-success", { queryFailure: true }, p => withBackend(fixture, env(p), async ({ load, output }) => {
        await assert.rejects(load().users.get("fixture-id"), e => e.code === "23505");
        assert.equal(markerCount(output), 1); assert.equal(p.counts.query, 1);
      }));
      for (const mode of ["verify", "no-verify", "off"]) {
        await test("development-" + mode + "-never-verified-marker", { plain: mode === "off", certificate: mode === "no-verify" ? "untrusted" : "ip" }, p => withBackend(fixture, env(p, "127.0.0.1", "?ssl=0", { NODE_ENV: "development", PGSSL: mode }), async ({ load, output }) => {
          await load().users.get("fixture-id"); assert.equal(markerCount(output), 0); assert.equal(p.counts.query, 1);
          assert(output.some(a => typeof a[0] === "string" && a[0].startsWith("[db]")));
        }));
      }
      await test("throwing-log-sink-one-attempt-still-verified-query", {}, p => withBackend(fixture, env(p), async ({ load, pools }) => {
        load(); const old = console.log; let attempts = 0;
        console.log = line => { assert.equal(line, MARKER); attempts++; throw new Error("Controlled output failure"); };
        try {
          await pools[0].query("SELECT 1");
          const c = await pools[0].connect(); c.release(true); await new Promise(resolve => c.once("end", resolve));
          await pools[0].query("SELECT 1"); assert.equal(attempts, 1);
        } finally { console.log = old; }
      }));
      await test("original-startup-throw-is-terminal-no-replay", {}, p => {
        const req = Module.createRequire(path.join(fixture.directory, "package.json")), pg = req("pg"), original = pg.Connection.prototype.startup;
        pg.Connection.prototype.startup = () => { throw new Error("Controlled startup failure"); };
        return withBackend(fixture, env(p), async ({ load, output }) => {
          await assert.rejects(load().users.get("fixture-id"), e => e.code === "database_tls_not_verified");
          assert.equal(p.counts.startup, 0); assert.equal(p.counts.password, 0); assert.equal(markerCount(output), 0);
        }).finally(() => { pg.Connection.prototype.startup = original; });
      });
      await test("original-connect-throw-is-terminal-without-uncaught-constructor", {}, p => {
        const req = Module.createRequire(path.join(fixture.directory, "package.json")), pg = req("pg"), original = pg.Connection.prototype.connect;
        pg.Connection.prototype.connect = () => { throw new Error("Controlled connect failure"); };
        return withBackend(fixture, env(p), async ({ load, pools, output }) => {
          await assert.rejects(load().users.get("fixture-id"), e => e.code === "database_tls_not_verified");
          assert.equal(p.counts.accepted, 0); assert.equal(pools[0].totalCount, 0); assert.equal(markerCount(output), 0);
        }).finally(() => { pg.Connection.prototype.connect = original; });
      });
      for (const kind of ["throw", "reject"]) await test("actual-awaited-pool-hook-" + kind + "-before-acquire", {}, p => {
        const filename = path.join(SERVER, "db-tls-transport.js");
        const code = fs.readFileSync(filename, "utf8").replace("await Promise.resolve();", kind === "throw" ? 'throw new Error("Controlled hook failure");' : 'await Promise.reject(new Error("Controlled hook rejection"));');
        return withBackend(fixture, env(p), async ({ load, pools, output }) => {
          load(); let acquired = 0; pools[0].on("acquire", () => acquired++);
          await assert.rejects(pools[0].query("SELECT 1"), /Controlled hook/);
          assert.equal(acquired, 0); assert.equal(p.counts.query, 0); assert.equal(pools[0].totalCount, 0); assert.equal(markerCount(output), 0);
        }, { [filename]: code });
      });
      for (const flag of ["authorized", "_rejectUnauthorized", "_tlsOptions"]) await test("same-native-proof-" + flag + "-lost-before-pool-check", {}, p => {
        const req = Module.createRequire(path.join(fixture.directory, "package.json")), pg = req("pg"), original = pg.Client.prototype._connect;
        pg.Client.prototype._connect = function (callback) {
          return original.call(this, (error, client) => {
            if (!error) { if (flag === "_tlsOptions") this.connection.stream._tlsOptions.rejectUnauthorized = false; else this.connection.stream[flag] = false; }
            callback(error, client);
          });
        };
        return withBackend(fixture, env(p), async ({ load, pools, output }) => {
          await assert.rejects(load().users.get("fixture-id"), e => e.code === "database_tls_not_verified");
          assert.equal(p.counts.query, 0); assert.equal(markerCount(output), 0); assert.equal(pools[0].totalCount, 0);
        }).finally(() => { pg.Client.prototype._connect = original; });
      });
    }
  } finally { dns.lookup = originalLookup; net.Socket.prototype.connect = originalConnect; }
  return { results, mappedLookups: lookups, nativeNode: process.version, openssl: process.versions.openssl, allListenersClosed: true };
}

async function runDriver(fixture) {
  const started = Date.now();
  prepareCertificates(fixture);
  let passed = (await admissionControls(fixture)).passed;
  for (const mode of ["--native-child", "--adverse-child"]) {
    const env = isolatedEnv(fixture, { NODE_EXTRA_CA_CERTS: path.join(fixture.directory, "certs/ca.crt"), ...(mode === "--adverse-child" ? { NODE_TLS_REJECT_UNAUTHORIZED: "0", PGSSLMODE: "disable" } : {}) });
    const remaining = 180000 - (Date.now() - started);
    assert(remaining > 0, "whole driver suite budget exhausted");
    const result = cp.spawnSync(process.execPath, [__filename, mode, fixture.directory], { env, encoding: "utf8", timeout: Math.min(30000, remaining), maxBuffer: 1024 * 1024 });
    fs.writeFileSync(path.join(fixture.directory, "native-execution-" + Date.now() + "-" + mode.slice(2) + ".json"), JSON.stringify({
      mode, sourceSHA256: sha(fs.readFileSync(__filename)), exit: result.status, signal: result.signal, error: result.error ? result.error.code : null, stdout: result.stdout, stderr: result.stderr
    }, null, 2), { flag: "wx", mode: 0o600 });
    if (result.status !== 0) {
      console.error(result.stdout);
      console.error(result.stderr);
      throw Object.assign(new Error("mandatory native child failed"), { code: result.error ? result.error.code : "NATIVE_CHILD_FAILED" });
    }
    const evidence = JSON.parse(result.stdout.trim());
    passed += evidence.results.length;
    fs.writeFileSync(path.join(fixture.directory, mode.slice(2) + "-latest-result.json"), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  }
  return { passed, failed: 0 };
}

module.exports = { runUnit, runDriver };
if (require.main === module) {
  (async () => {
    const fixture = fixtureInfo(process.argv[3] || process.argv[2]);
    if (process.argv[2] === "--baseline") await runBaseline(fixture);
    else if (process.argv[2] === "--native-child" || process.argv[2] === "--adverse-child") {
      console.log(JSON.stringify(await nativeSuite(fixture, process.argv[2] === "--adverse-child")));
    } else {
      const result = await runDriver(fixture);
      console.log("db-tls-transport.test.js: " + result.passed + " passed, " + result.failed + " failed");
      if (result.failed) process.exitCode = 1;
    }
  })().catch(e => {
    if (e.partialResults) console.error(JSON.stringify({ failedNativeCase: e.caseName, results: e.partialResults }));
    console.error("db-tls-transport.test.js failed: " + (e.code || e.name) + (e.caseName ? " / " + e.caseName : ""));
    if (!e.caseName && e.stack) console.error(e.stack.split("\n").filter(line => /^\s+at /.test(line)).slice(0, 6).join("\n"));
    process.exitCode = 1;
  });
}
