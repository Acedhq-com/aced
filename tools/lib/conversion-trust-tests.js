"use strict";

// Actual page/controller source, synthetic DOM/I/O only. This is not browser QA.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const copy = {
  invalid: "Enter a valid email address. No request was started for this submission.",
  unavailable: "Launch-list signup is unavailable here. No request was started for this submission. Your email is unchanged.",
  pending: "Submitting your launch-list request. Confirmation is pending.",
  editedPending: "Request in progress for the submitted value. Your current edits have not been submitted.",
  confirmed: "Your update request was accepted. Thanks for your interest in ACED.",
  unconfirmed: "Request not confirmed. It may have reached the service. Your email is unchanged. You can submit again.",
  limited: "Request not confirmed. The service is limiting requests; wait before submitting again. Your email is unchanged.",
  expired: "Confirmation timed out. This request may still have reached the service. Your email is unchanged. You can submit again.",
  earlierConfirmed: "An earlier submission was accepted. Your current form has changed and has not been submitted.",
  earlierUnconfirmed: "An earlier submission could not be confirmed. Your current form has changed and has not been submitted.",
  draft: "Email changed. Submit to request updates for this value."
};
const address = "synthetic@example.invalid";
const other = "changed@example.invalid";
const response = (body = { ok: true }, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body)
});
const defer = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const captures = f => f.events.filter(e => e[0] === "email_captured");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const attrs = text => Object.fromEntries([...text.matchAll(/([-\w]+)(?:="([^"]*)")?/g)]
  .map(m => [m[1], m[2] === undefined ? "" : m[2]]));

function fixture(options = {}) {
  const nodes = [], requests = [], events = [], storage = [], logs = [], navigations = [];
  const legacy = [{ retained: true }], timers = new Map(), docListeners = {};
  let now = 1000, timerID = 0, aborts = 0;
  function matches(node, selector) {
    if (selector === "[id]") return !!node.id;
    if (/^\.[\w-]+$/.test(selector)) return node.className.split(/\s+/).includes(selector.slice(1));
    const m = selector.match(/^(\w+)?(?:\[([-\w]+)(?:="([^"]*)")?\])?$/);
    return !!m && (!m[1] || node.tag === m[1]) &&
      (!m[2] || node.hasAttribute(m[2]) && (m[3] === undefined || node.getAttribute(m[2]) === m[3]));
  }
  function element(tag, values = {}) {
    let content = "";
    const n = {
      tag, attrs: { ...values }, children: [], parentNode: null, listeners: {},
      isConnected: false, value: "", disabled: false, resetCalls: 0,
      get id() { return this.attrs.id || ""; }, set id(v) { this.attrs.id = String(v); },
      get className() { return this.attrs.class || ""; }, set className(v) { this.attrs.class = String(v); },
      get textContent() { return content + this.children.map(c => c.textContent).join(""); },
      set textContent(v) { content = String(v); this.children = []; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; },
      hasAttribute(k) { return Object.hasOwn(this.attrs, k); },
      removeAttribute(k) { delete this.attrs[k]; },
      appendChild(child) { this.children.push(child); child.parentNode = this; child.isConnected = this.isConnected; return child; },
      contains(child) { return this === child || this.children.some(c => c.contains(child)); },
      querySelectorAll(selector) {
        const all = this.children.flatMap(c => [c, ...c.querySelectorAll("*")]);
        return selector === "*" ? all : all.filter(c => selector.split(/,\s*/).some(s => matches(c, s)));
      },
      querySelector(s) { return this.querySelectorAll(s)[0] || null; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      dispatch(type) {
        const e = { target: this, prevented: false, preventDefault() { this.prevented = true; } };
        (this.listeners[type] || []).forEach(fn => fn(e));
        return e;
      },
      focus() { document.activeElement = this; },
      reset() { this.resetCalls++; this.dispatch("reset"); this.querySelectorAll("input").forEach(x => { x.value = ""; }); }
    };
    n.classList = {
      add(c) { if (!n.className.split(/\s+/).includes(c)) n.className = (n.className + " " + c).trim(); },
      remove(c) { n.className = n.className.split(/\s+/).filter(x => x !== c).join(" "); },
      contains(c) { return n.className.split(/\s+/).includes(c); }
    };
    nodes.push(n); return n;
  }
  const body = element("body"); body.isConnected = true;
  const head = element("head"); head.isConnected = true;
  const document = {
    readyState: options.loading ? "loading" : "complete", body, head, activeElement: null,
    getElementById(id) { return nodes.find(n => n.isConnected && n.id === id) || null; },
    querySelectorAll(s) { return nodes.filter(n => n.isConnected && matches(n, s)); },
    createElement: element,
    addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); }
  };
  function addPage(page) {
    const html = read(page), added = [];
    for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
      const a = attrs(m[1]);
      if (a.id !== "capForm" && !Object.hasOwn(a, "data-aced-notify")) continue;
      const parent = element("section"), form = element("form", a); body.appendChild(parent); parent.appendChild(form);
      for (const label of m[2].matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
        const n = element("label", attrs(label[1])); n.textContent = label[2]; form.appendChild(n);
      }
      const row = m[2].match(/<div\b([^>]*class="formrow"[^>]*)>/i);
      const controls = row ? element("div", attrs(row[1])) : form;
      if (row) form.appendChild(controls);
      for (const input of m[2].matchAll(/<input\b([^>]*)>/gi)) controls.appendChild(element("input", attrs(input[1])));
      const b = m[2].match(/<button\b([^>]*)>([\s\S]*?)<\/button>/i);
      if (b) { const button = element("button", attrs(b[1])); button.textContent = b[2].replace(/<[^>]*>/g, ""); controls.appendChild(button); }
      const note = html.slice(m.index).match(/<div\b([^>]*class="capnote"[^>]*)>/i);
      if (note) {
        const n = element("div", attrs(note[1]));
        (m[2].includes(note[0]) ? form : parent).appendChild(n);
      }
      added.push(form);
    }
    return { html, forms: added };
  }
  const first = addPage(options.page || "index.html"), form = first.forms[0];
  assert.ok(form, "actual capture form exists");
  const input = form.querySelector('input[type="email"]');
  if (input) input.value = address;
  class Clock extends Date { static now() { return now; } }
  class Abort {
    constructor() { this.signal = {}; }
    abort() { aborts++; }
  }
  const context = {
    document, Date: Clock, Promise,
    setTimeout(fn, delay) { const id = ++timerID; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    AbortController: options.abort === false ? undefined : Abort,
    console: Object.fromEntries(["log", "warn", "error"].map(k => [k, (...a) => logs.push(a)])),
    location: { set href(v) { navigations.push(v); } },
    localStorage: { getItem(k) { storage.push(["local-read", k]); return null; }, setItem(k) { storage.push(["local-write", k]); } },
    sessionStorage: { getItem(k) { storage.push(["session-read", k]); return null; }, setItem(k) { storage.push(["session-write", k]); } }
  };
  if (options.endpoint !== false) context.ACED_API_URL = "https://notification.invalid/";
  if (options.core !== false) context.ACEDCore = {
    store: { get(k, d) { storage.push(["core-read", k]); return k === "subscribers" ? legacy : d; },
      set(k, v) { storage.push(["core-write", k]); return true; } },
    analytics: { track(name, data) { events.push([name, data]); if (options.analyticsThrow) throw Error("Synthetic"); } },
    streak: { get() { return { current: 0 }; } }
  };
  const fetcher = options.fetch || (() => Promise.resolve(response()));
  if (options.fetch !== false) context.fetch = (...a) => { requests.push(a); return fetcher(...a); };
  context.window = context; vm.createContext(context);
  const evaluate = (code, name) => vm.runInContext(code, context, { filename: name, timeout: 1000 });
  function loadPage(html) {
    for (const s of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/application\/ld\+json/.test(s[1])) continue;
      if (/\bsrc="notify\.js"/.test(s[1])) evaluate(read("notify.js"), "notify.js");
      else if (!/\bsrc=/.test(s[1]) && s[2].includes("// live streak")) evaluate(s[2], "index.html:actual-inline");
    }
  }
  loadPage(first.html);
  return {
    context, document, form, input, nodes, requests, events, storage, logs, legacy, timers, navigations,
    get note() { return form.querySelector(".capnote") || form.parentNode.querySelector(".capnote"); },
    get button() { return form.querySelector("button"); }, get aborts() { return aborts; },
    submit(f = form) { return f.dispatch("submit"); },
    edit(value = other) { input.value = value; input.dispatch("input"); },
    init() { (docListeners.DOMContentLoaded || []).forEach(fn => fn()); },
    duplicate() { evaluate(read("notify.js"), "notify.js:duplicate"); },
    addPage(page) { return addPage(page).forms[0]; },
    now(value, fire = true) { now = value; if (fire) for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); } },
    detach(f = form) { f.isConnected = false; f.querySelectorAll("*").forEach(n => { n.isConnected = false; }); f.parentNode.children = f.parentNode.children.filter(n => n !== f); }
  };
}

module.exports = async function () {
  let passed = 0, failed = 0;
  async function test(name, fn) {
    try { await fn(); passed++; console.log("PASS conversion-trust " + name); }
    catch (_) { failed++; console.error("FAIL conversion-trust " + name); }
  }
  for (const page of ["index.html", "lsat.html"]) {
    await test("T01 actual " + page + " HTTP failure is not confirmation or buffering", async () => {
      const f = fixture({ page, fetch: () => Promise.resolve(response({ ok: true }, 500)) });
      const value = f.input.value; f.submit(); await flush();
      assert.equal(f.note.textContent, copy.unconfirmed);
      assert.equal(f.input.value, value); assert.equal(f.storage.length, 0);
    });
    await test("T01 actual " + page + " rejected request remains unconfirmed", async () => {
      const f = fixture({ page, fetch: () => Promise.reject(Error("Synthetic")) });
      f.submit(); await flush(); assert.equal(f.note.textContent, copy.unconfirmed);
      assert.equal(f.form.resetCalls, 0); assert.equal(f.storage.length, 0);
    });
    await test("T01 actual " + page + " unavailable starts no request and stores no address", async () => {
      const f = fixture({ page, endpoint: false }); f.submit(); await flush();
      assert.equal(f.note.textContent, copy.unavailable); assert.equal(f.requests.length, 0);
      assert.equal(f.storage.length, 0); assert.equal(f.legacy.length, 1);
    });
  }
  for (const page of ["index.html", "lsat.html", "mcat.html", "nclex.html", "bar-exam.html", "usmle.html"]) {
    await test("T02 actual route and bounded acceptance " + page, async () => {
      const f = fixture({ page }), source = page === "index.html" ? "home" : page.slice(0, -5);
      f.input.value = "  " + address + "  "; const raw = f.input.value;
      assert.equal(f.form.listeners.submit.length, 1);
      assert.equal(f.input.listeners.input.length, 1);
      assert.equal(f.form.listeners.reset.length, 1);
      assert.ok(f.submit().prevented); assert.equal(f.note.textContent, copy.pending);
      assert.equal(f.requests.length, 1); const [url, request] = f.requests[0];
      assert.equal(url, "https://notification.invalid/notify");
      assert.equal(request.method, "POST");
      assert.deepEqual(Object.keys(request.headers), ["Content-Type"]);
      assert.equal(request.headers["Content-Type"], "application/json");
      assert.deepEqual(JSON.parse(request.body), { email: address, source });
      assert.equal(request.credentials, undefined);
      await flush();
      assert.equal(f.note.textContent, copy.confirmed); assert.ok(f.note.classList.contains("ok"));
      assert.equal(f.input.value, raw); assert.equal(f.form.resetCalls, 0);
      assert.equal(f.timers.size, 0); assert.equal(f.storage.length, 0);
      assert.equal(captures(f).length, 1);
      assert.equal(JSON.stringify(captures(f)[0][1]), JSON.stringify({ source }));
      assert.equal(f.note.getAttribute("role"), "status");
      assert.equal(f.note.getAttribute("aria-live"), "polite");
      assert.equal(f.note.getAttribute("aria-atomic"), "true");
      assert.ok(f.input.getAttribute("aria-describedby").split(/\s+/).includes(f.note.id));
      assert.equal(f.document.activeElement, null);
      f.submit(); await flush();
      assert.equal(f.requests.length, 2); assert.equal(captures(f).length, 2);
      assert.equal(f.note.textContent, copy.confirmed, "duplicate acknowledgment is still generic");
    });
  }
  await test("T02 exact endpoint precedence and default source", async () => {
    for (const mode of ["form", "capture", "api", "double-trailing"]) {
      const f = fixture(); f.form.removeAttribute("data-source");
      f.context.ACED_CAPTURE_ENDPOINT = "https://capture.invalid/notify";
      if (mode === "form") f.form.setAttribute("data-endpoint", "https://form.invalid/notify");
      if (mode === "api" || mode === "double-trailing") delete f.context.ACED_CAPTURE_ENDPOINT;
      if (mode === "double-trailing") f.context.ACED_API_URL = "https://notification.invalid//";
      f.submit(); await flush();
      assert.equal(f.requests[0][0], {
        form: "https://form.invalid/notify", capture: "https://capture.invalid/notify",
        api: "https://notification.invalid/notify", "double-trailing": "https://notification.invalid//notify"
      }[mode]);
      assert.equal(JSON.parse(f.requests[0][1].body).source, "home");
    }
  });
  await test("T02 honeypot precedence is silent and never submits", async () => {
    const f = fixture({ page: "lsat.html" }); f.input.value = "invalid";
    f.form.querySelector('input[name="company"]').value = "Synthetic";
    f.submit(); await flush();
    assert.equal(f.requests.length, 0); assert.equal(f.events.length, 0);
    assert.equal(f.note.textContent, ""); assert.equal(f.document.activeElement, null);
    assert.equal(f.storage.length, 0); assert.equal(f.timers.size, 0);
  });
  await test("T02 explicit invalid focus, editable recovery, missing input and no native address field", async () => {
    const f = fixture(); f.input.value = "invalid"; f.submit(); await flush();
    assert.equal(f.requests.length, 0); assert.equal(f.note.textContent, copy.invalid);
    assert.equal(f.document.activeElement, f.input); assert.equal(f.input.getAttribute("aria-invalid"), "true");
    f.edit(address); assert.equal(f.note.textContent, copy.draft);
    assert.equal(f.input.getAttribute("aria-invalid"), null);
    f.submit(); await flush(); assert.equal(f.note.textContent, copy.confirmed);
    const missing = fixture({ loading: true });
    missing.form.children = missing.form.children.filter(n => n !== missing.input);
    missing.input.isConnected = false; missing.init(); missing.submit(); await flush();
    assert.equal(missing.note.textContent, copy.unavailable); assert.equal(missing.requests.length, 0);
    for (const page of ["index.html", "lsat.html", "mcat.html", "nclex.html", "bar-exam.html", "usmle.html"])
      assert.equal(fixture({ page }).input.hasAttribute("name"), false);
  });
  await test("T02 duplicate evaluation and repeated DOM ready bind once; new forms bind later", async () => {
    for (const loading of [false, true]) {
      const f = fixture({ loading }); f.duplicate(); f.duplicate(); f.init(); f.init();
      assert.equal(f.form.listeners.submit.length, 1);
      assert.equal(f.input.listeners.input.length, 1); assert.equal(f.form.listeners.reset.length, 1);
      assert.equal(f.form.parentNode.querySelectorAll(".capnote").length, 1);
      f.submit(); f.submit(); await flush(); assert.equal(f.requests.length, 1);
      const later = f.addPage("lsat.html"); later.querySelector('input[type="email"]').value = address;
      f.duplicate(); f.init();
      assert.equal(later.listeners.submit.length, 1); f.submit(later); await flush();
      assert.equal(f.requests.length, 2);
    }
  });
  await test("T02 shared sibling note and duplicate IDs never create an ambiguous live status", async () => {
    const f = fixture({ loading: true }), second = f.addPage("index.html");
    const oldParent = second.parentNode;
    oldParent.children = oldParent.children.filter(n => n !== second);
    f.form.parentNode.appendChild(second); f.init();
    const a = f.form.querySelector(".capnote"), b = second.querySelector(".capnote");
    assert.ok(a); assert.ok(b); assert.notEqual(a, b); assert.notEqual(a.id, b.id);
    const s = second.querySelector('input[type="email"]');
    assert.ok(f.input.getAttribute("aria-describedby").split(/\s+/).includes(a.id));
    assert.ok(s.getAttribute("aria-describedby").split(/\s+/).includes(b.id));
    assert.equal(f.document.querySelectorAll("[id]").filter(n => n.id === a.id).length, 1);
    assert.equal(f.document.querySelectorAll("[id]").filter(n => n.id === b.id).length, 1);
  });
  const badAcks = [
    ["null", () => null], ["array", () => []], ["scalar", () => true], ["string", () => "ok"],
    ["absent", () => ({})], ["false", () => ({ ok: false })], ["truthy", () => ({ ok: "true" })],
    ["inherited", () => Object.create({ ok: true })], ["contradictory", () => ({ ok: true, error: "Synthetic" })]
  ];
  for (const [label, body] of badAcks) await test("T03 unsupported own acknowledgment " + label, async () => {
    const f = fixture({ fetch: () => Promise.resolve(response(body())) }); f.submit(); await flush();
    assert.equal(f.note.textContent, copy.unconfirmed); assert.equal(captures(f).length, 0);
    assert.equal(f.input.value, address); assert.equal(f.form.resetCalls, 0); assert.equal(f.timers.size, 0);
  });
  await test("T03 body accessors are rejected without executing getters", async () => {
    for (const field of ["ok", "error"]) {
      let hooks = 0;
      const body = { ok: true };
      Object.defineProperty(body, field, { get() { hooks++; throw Error("Synthetic"); } });
      const f = fixture({ fetch: () => Promise.resolve(response(body)) });
      f.submit(); await flush(); assert.equal(hooks, 0);
      assert.equal(f.note.textContent, copy.unconfirmed); assert.equal(captures(f).length, 0);
    }
  });
  await test("T03 supported own data and falsey own error or inherited error", async () => {
    for (const body of [{ ok: true }, { ok: true, error: false }, { ok: true, error: "" },
      Object.assign(Object.create({ error: "Synthetic" }), { ok: true })]) {
      const f = fixture({ fetch: () => Promise.resolve(response(body, 201)) }); f.submit(); await flush();
      assert.equal(f.note.textContent, copy.confirmed); assert.equal(captures(f).length, 1);
    }
  });
  const badResponses = [
    ["400", () => response({ ok: true }, 400), "unconfirmed"],
    ["429", () => response({ ok: true }, 429), "limited"],
    ["500", () => response({ ok: true }, 500), "unconfirmed"],
    ["204-empty", () => ({ ok: true, status: 204, json() { return Promise.reject(Error("Synthetic")); } }), "unconfirmed"],
    ["json-throws", () => ({ ok: true, status: 200, json() { throw Error("Synthetic"); } }), "unconfirmed"],
    ["json-rejects", () => ({ ok: true, status: 200, json() { return Promise.reject(Error("Synthetic")); } }), "unconfirmed"],
    ["missing-json", () => ({ ok: true, status: 200 }), "unconfirmed"],
    ["fractional-status", () => ({ ...response(), status: 200.5 }), "unconfirmed"],
    ["string-status", () => ({ ...response(), status: "200" }), "unconfirmed"],
    ["ok-not-true", () => ({ ...response(), ok: 1 }), "unconfirmed"],
    ["false-http-ok", () => ({ ...response(), ok: false }), "unconfirmed"],
    ["redirect", () => ({ ...response(), status: 302 }), "unconfirmed"],
    ["no-response", () => null, "unconfirmed"]
  ];
  for (const [label, value, state] of badResponses) await test("T03 HTTP and parse " + label, async () => {
    const f = fixture({ fetch: () => Promise.resolve(value()) }); f.submit(); await flush();
    assert.equal(f.note.textContent, copy[state]); assert.equal(f.input.value, address);
    assert.equal(captures(f).length, 0); assert.equal(f.timers.size, 0);
    assert.equal(f.button.hasAttribute("aria-disabled"), false);
  });
  await test("T03 absent fetch and synchronous request errors remain truthful", async () => {
    for (const fetch of [false, () => { throw Error("Synthetic"); }]) {
      const f = fixture({ fetch }); f.submit(); await flush();
      assert.equal(f.note.textContent, copy[fetch === false ? "unavailable" : "unconfirmed"]);
      assert.equal(f.requests.length, fetch === false ? 0 : 1); assert.equal(f.timers.size, 0);
      assert.equal(captures(f).length, 0); assert.equal(f.logs.length, 0);
    }
  });
  for (const abort of [false, true]) await test("T04 hanging fetch, pending repeats and manual retry abort=" + abort, async () => {
    const first = defer(), next = defer(); let calls = 0;
    const f = fixture({ abort, fetch: () => (++calls === 1 ? first.promise : next.promise) });
    f.button.setAttribute("aria-disabled", "false"); f.button.setAttribute("aria-busy", "false");
    f.submit(); const firstLabel = f.button.textContent;
    assert.equal(firstLabel, "SUBMITTING..."); assert.equal(f.button.disabled, false); assert.equal(f.input.disabled, false);
    assert.equal(f.button.getAttribute("aria-disabled"), "true"); assert.equal(f.button.getAttribute("aria-busy"), "true");
    f.edit("invalid"); f.submit(); f.submit(); f.duplicate(); f.init();
    assert.equal(f.requests.length, 1); assert.equal(f.timers.size, 1); assert.equal(f.document.activeElement, null);
    assert.equal(f.note.textContent, copy.editedPending);
    f.now(11000); await flush(); assert.equal(f.note.textContent, copy.earlierUnconfirmed);
    assert.equal(f.aborts, abort ? 1 : 0); assert.equal(f.timers.size, 0);
    assert.equal(f.button.getAttribute("aria-disabled"), "false"); assert.equal(f.button.getAttribute("aria-busy"), "false");
    assert.equal(f.button.textContent, "NOTIFY ME"); assert.equal(calls, 1);
    f.edit(other); f.submit(); assert.equal(calls, 2);
    first.resolve(response()); await flush();
    assert.equal(f.note.textContent, copy.pending); assert.equal(captures(f).length, 0);
    assert.equal(f.button.getAttribute("aria-disabled"), "true"); assert.equal(f.timers.size, 1);
    next.resolve(response()); await flush(); assert.equal(f.note.textContent, copy.confirmed);
    assert.equal(captures(f).length, 1); assert.equal(f.input.value, other); assert.equal(f.timers.size, 0);
  });
  for (const time of [10999, 11000, 11001]) await test("T04 delayed timer cannot accept at deadline " + time, async () => {
    const pending = defer(), f = fixture({ fetch: () => pending.promise }); f.submit();
    f.now(time, false); pending.resolve(response()); await flush();
    assert.equal(f.note.textContent, copy[time < 11000 ? "confirmed" : "expired"]);
    assert.equal(captures(f).length, time < 11000 ? 1 : 0); assert.equal(f.timers.size, 0);
    assert.equal(f.requests.length, 1);
  });
  await test("T04 total deadline covers hanging JSON; late rejection or parse never revives request", async () => {
    for (const bodyStage of [false, true]) {
      for (const reject of [false, true]) {
        const pending = defer(), f = fixture({ fetch: () => bodyStage
          ? Promise.resolve({ ok: true, status: 200, json: () => pending.promise }) : pending.promise });
        f.submit(); await flush(); f.now(11000); await flush();
        assert.equal(f.note.textContent, copy.expired); assert.equal(f.timers.size, 0);
        const note = f.note.textContent;
        if (reject) pending.reject(Error("Synthetic")); else pending.resolve(bodyStage ? { ok: true } : response());
        await flush();
        assert.equal(f.note.textContent, note); assert.equal(captures(f).length, 0);
        assert.equal(f.requests.length, 1); assert.equal(f.button.hasAttribute("aria-disabled"), false);
      }
    }
  });
  await test("T04 before-deadline JSON acceptance clears timer and later callback changes nothing", async () => {
    const body = defer(), f = fixture({ fetch: () => Promise.resolve({ ok: true, status: 200, json: () => body.promise }) });
    f.submit(); await flush(); f.now(10999, false); body.resolve({ ok: true }); await flush();
    assert.equal(f.note.textContent, copy.confirmed); assert.equal(f.timers.size, 0);
    f.now(21000); await flush(); assert.equal(f.note.textContent, copy.confirmed);
    assert.equal(captures(f).length, 1); assert.equal(f.requests.length, 1);
  });
  for (const mutation of ["input", "away-back", "reset", "programmatic", "source", "endpoint"]) {
    for (const outcome of ["confirmed", "unconfirmed", "limited", "expired"]) {
      await test("T05 earlier-submission precedence " + mutation + " " + outcome, async () => {
        const pending = defer(), f = fixture({ fetch: () => pending.promise }); f.submit();
        if (mutation === "input") f.edit();
        if (mutation === "away-back") { f.edit(); f.edit(address); }
        if (mutation === "reset") { f.form.dispatch("reset"); f.input.value = address; }
        if (mutation === "programmatic") f.input.value = other;
        if (mutation === "source") f.form.setAttribute("data-source", "lsat");
        if (mutation === "endpoint") f.form.setAttribute("data-endpoint", "https://different.invalid/notify");
        const raw = f.input.value;
        if (outcome === "expired") f.now(11000);
        else pending.resolve(response(outcome === "unconfirmed" ? { ok: false } : { ok: true }, outcome === "limited" ? 429 : 200));
        await flush();
        assert.equal(f.note.textContent, copy[outcome === "confirmed" ? "earlierConfirmed" : "earlierUnconfirmed"]);
        assert.equal(f.note.classList.contains("ok"), false); assert.equal(f.input.value, raw);
        assert.equal(captures(f).length, outcome === "confirmed" ? 1 : 0);
        assert.equal(f.requests.length, 1); assert.equal(f.document.activeElement, null);
        assert.equal(f.timers.size, 0);
      });
    }
  }
  await test("T05 input edit after every terminal state removes result and invalid state", async () => {
    for (const state of ["confirmed", "unconfirmed", "limited", "expired", "invalid", "unavailable"]) {
      const f = fixture({ endpoint: state !== "unavailable", fetch: state === "expired" ? () => new Promise(() => {})
        : () => Promise.resolve(response(state === "unconfirmed" ? { ok: false } : { ok: true }, state === "limited" ? 429 : 200)) });
      if (state === "invalid") f.input.value = "invalid";
      f.submit(); if (state === "expired") f.now(11000); await flush();
      assert.equal(f.note.textContent, copy[state]);
      f.edit(); assert.equal(f.note.textContent, copy.draft);
      assert.equal(f.note.classList.contains("ok"), false); assert.equal(f.input.getAttribute("aria-invalid"), null);
      assert.equal(f.input.value, other);
    }
  });
  await test("T05 concurrent forms are independent, with no shared lock/status/deadline/focus", async () => {
    const a = defer(), b = defer(); let calls = 0;
    const f = fixture({ fetch: () => (++calls === 1 ? a.promise : b.promise) });
    const second = f.addPage("lsat.html"), secondInput = second.querySelector('input[type="email"]');
    secondInput.value = other; f.duplicate();
    const secondNote = second.querySelector(".capnote"), secondButton = second.querySelector("button");
    f.submit(); f.now(1500, false); f.submit(second); secondInput.focus();
    assert.equal(calls, 2); assert.equal(f.timers.size, 2);
    a.resolve(response()); await flush();
    assert.equal(f.note.textContent, copy.confirmed); assert.equal(secondNote.textContent, copy.pending);
    assert.equal(secondButton.getAttribute("aria-disabled"), "true"); assert.equal(f.document.activeElement, secondInput);
    f.now(11500); await flush();
    assert.equal(secondNote.textContent, copy.expired); assert.equal(f.note.textContent, copy.confirmed);
    assert.equal(f.document.activeElement, secondInput); assert.equal(captures(f).length, 1);
    b.resolve(response()); await flush(); assert.equal(secondNote.textContent, copy.expired);
  });
  await test("T05 detached completion restores only old controls, never replacement nodes or focus/event", async () => {
    const pending = defer(), f = fixture({ fetch: () => pending.promise }); f.submit();
    const oldButton = f.button, oldNote = f.note; f.detach();
    const replacement = f.addPage("index.html"); f.duplicate();
    const input = replacement.querySelector('input[type="email"]'), note = replacement.parentNode.querySelector(".capnote");
    input.value = other; input.focus(); const newButton = replacement.querySelector("button"), before = note.textContent;
    pending.resolve(response()); await flush();
    assert.equal(note.textContent, before); assert.equal(newButton.textContent, "NOTIFY ME");
    assert.equal(newButton.hasAttribute("aria-disabled"), false);
    assert.equal(oldButton.hasAttribute("aria-disabled"), false); assert.equal(oldButton.textContent, "NOTIFY ME");
    assert.equal(oldNote.textContent, copy.pending); assert.equal(f.document.activeElement, input);
    assert.equal(captures(f).length, 0); assert.equal(f.timers.size, 0); assert.equal(input.value, other);
    const described = input.getAttribute("aria-describedby").split(/\s+/);
    assert.ok(described.includes(note.id)); assert.equal(described.includes(oldNote.id), false);
  });
  await test("T06 no persistence, raw logs, URL writes, legacy changes or extra event properties", async () => {
    for (const source of ["home", "lsat", "mcat", "nclex", "bar-exam", "usmle", address, "__proto__", "HOME"]) {
      const f = fixture(); f.form.setAttribute("data-source", source); const before = JSON.stringify(f.legacy);
      f.submit(); assert.equal(captures(f).length, 0); await flush();
      assert.equal(f.note.textContent, copy.confirmed); assert.equal(f.storage.length, 0);
      assert.equal(JSON.stringify(f.legacy), before); assert.equal(f.logs.length, 0); assert.equal(f.navigations.length, 0);
      assert.equal(JSON.parse(f.requests[0][1].body).source, source);
      const allowed = ["home", "lsat", "mcat", "nclex", "bar-exam", "usmle"].includes(source);
      assert.equal(captures(f).length, allowed ? 1 : 0);
      if (allowed) assert.equal(JSON.stringify(captures(f)[0][1]), JSON.stringify({ source }));
      assert.equal(JSON.stringify(f.events).includes(address), false);
      assert.equal(f.note.textContent.includes(address), false);
      assert.equal(f.form.resetCalls, 0); assert.equal(f.timers.size, 0);
    }
  });
  await test("T06 missing core/analytics or throwing analytics cannot change acceptance or retry", async () => {
    for (const mode of ["no-core", "no-analytics", "throwing"]) {
      const f = fixture({ core: mode !== "no-core", analyticsThrow: mode === "throwing" });
      if (mode === "no-analytics") delete f.context.ACEDCore.analytics;
      f.submit(); await flush(); assert.equal(f.note.textContent, copy.confirmed);
      assert.equal(f.requests.length, 1); assert.equal(f.storage.length, 0);
      assert.equal(captures(f).length, mode === "throwing" ? 1 : 0); assert.equal(f.timers.size, 0);
    }
  });
  await test("T07 exact Home purposes, disclosures and only relevant FAQ changes", async () => {
    const html = read("index.html"), plain = html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
    const processing = "Supported pasted text and files are processed in your browser to build a pack. The parser does not upload the original document for processing.";
    const sync = "Packs are saved in this browser when storage is available. Optional account sync can send saved progress to ACED's backend, including associated IDs, source or topic labels, review and calibration history, and event records. These fields can include text you entered; sync is not limited to XP and streaks.";
    const control = "The Library's delete action targets a local pack and that pack’s data in this browser. It is not a clear-all tool for saved drafts, other browser data, cloud copies or launch-list records. This page does not provide a cloud or launch-list deletion control.";
    for (const text of [
      "YOUR NOTES AND PROGRESS: DATA HANDLING", processing, sync, control,
      "Get updates about ACED features and study packs. Submit your email to request launch updates.",
      "Submitting sends your email and this form's source to the notification service. See Data handling.",
      "Launch-list forms send the email and form source you choose to submit to the notification service. These updated forms do not add a new address to browser progress storage. Older versions may have stored addresses in browser data that can still be included in optional sync. Request acceptance does not confirm email delivery."
    ]) assert.ok(plain.includes(text));
    assert.ok(html.includes('href="#trust">Data handling</a>'));
    assert.ok(html.includes('href="library.html" style="color:var(--green);text-decoration:underline;text-underline-offset:3px">Library</a>'));
    assert.ok(html.includes("No punishment for missing a day &mdash; streaks celebrate consistency, not shame."));
    assert.ok(html.includes("Bigger uploads and optional AI deck-generation are coming later as a paid upgrade."));
    const schemas = [...html.matchAll(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/g)].map(m => JSON.parse(m[1]));
    assert.equal(schemas[0]["@type"], "SoftwareApplication");
    const questions = schemas.find(o => o["@type"] === "FAQPage").mainEntity;
    assert.equal(questions.find(q => q.name === "Where are my notes stored?").acceptedAnswer.text, [processing, sync, control].join(" "));
    assert.equal(questions.find(q => q.name === "Do I need an account?").acceptedAnswer.text,
      "No account is required to play. Optional account sync can send progress and associated IDs, labels and history to ACED's backend when available. See Data handling for storage and deletion limits.");
    const changed = html.match(/<section class="sec" id="trust">([\s\S]*?)<\/section>/)[1];
    for (const obsolete of ["Nothing you paste or upload is sent", "never your note contents", "clear everything", "used to train any model"])
      assert.equal(changed.includes(obsolete), false);
    const rest = html
      .replace(/  \/\* email capture \*\/[\s\S]*?(?=  footer\{)/, "")
      .replace(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/g, (all, raw) => {
        const o = JSON.parse(raw); if (o["@type"] !== "FAQPage") return all;
        for (const q of o.mainEntity) if (["Do I need an account?", "Where are my notes stored?"].includes(q.name)) q.acceptedAnswer.text = "";
        return '<script type="application/ld+json">\n' + JSON.stringify(o) + "\n</script>";
      })
      .replace(/  <!-- ===== TRUST \/ DATA HANDLING ===== -->[\s\S]*?(?=  <!-- ===== EMAIL CAPTURE ===== -->)/, "")
      .replace(/  <!-- ===== EMAIL CAPTURE ===== -->[\s\S]*?<\/section>/, "")
      .replace(/^<script src="notify\.js"><\/script>\n/gm, "")
      .replace(/  \/\/ email capture[^\n]*\n[\s\S]*?(?=  \/\/ engine-first entry)/, "");
    assert.equal(hash(rest), "a4d302957864af18a0a28860f41a62701aec1475ca2539ff488446becd467f13");
    assert.equal([...html.matchAll(/src="notify\.js"/g)].length, 1);
    assert.equal(/\/\/ email capture|store\.get\("subscribers"/.test(html), false);
  });
  await test("T07 exact pricing privacy copy and byte-preserved unrelated content", async () => {
    const html = read("pricing.html"), plain = html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
    assert.ok(plain.includes("Supported notes are processed in your browser. Optional account sync can send progress and associated IDs, labels and history to ACED's backend. See Data handling."));
    assert.ok(plain.includes("No account is required to play. Packs and progress use browser storage when available. Optional sync can send progress and associated text-bearing fields to ACED's backend; it is not limited to XP or streaks. See Data handling for legacy records and deletion limits."));
    assert.equal([...html.matchAll(/href="index\.html#trust">Data handling<\/a>/g)].length, 2);
    const rest = html.replace(/^     <li>(?:Runs in your browser\.|Supported notes are processed)[^\n]*<\/li>$/m, "")
      .replace(/^   <div class="q"><b>Do I need an account\?<\/b>[^\n]*<\/div>$/m, "");
    assert.equal(hash(rest), "75fdcd3ee0c3826c18b011ba3c2d2b9f8c092402e23858ac56245b06df33dcac");
  });
  for (const page of ["index.html", "lsat.html", "mcat.html", "nclex.html", "bar-exam.html", "usmle.html"]) {
    await test("T02 v1.1 owned component markers and one static sheet " + page, async () => {
      const f = fixture({ page });
      const sheets = () => f.document.querySelectorAll("style[data-aced-notify-style]");
      assert.equal(sheets().length, 1);
      const sheet = sheets()[0], css = sheet.textContent;
      assert.ok(f.form.hasAttribute("data-aced-notify-form"));
      assert.ok(f.input.hasAttribute("data-aced-notify-email"));
      assert.ok(f.button.hasAttribute("data-aced-notify-submit"));
      assert.ok(f.note.hasAttribute("data-aced-notify-status"));
      const row = page === "index.html" ? f.form : f.input.parentNode;
      assert.ok(row.hasAttribute("data-aced-notify-row"));
      assert.ok(row.contains(f.input)); assert.ok(row.contains(f.button));
      const hp = f.form.querySelector('input[name="company"]');
      if (hp) assert.equal(Object.keys(hp.attrs).some(k => k.startsWith("data-aced-notify-")), false);
      const note = f.note, label = f.form.querySelector("label"), parent = f.form.parentNode;
      f.duplicate(); f.duplicate(); f.init(); f.init();
      assert.equal(sheets().length, 1); assert.equal(sheets()[0], sheet); assert.equal(sheet.textContent, css);
      assert.equal(f.note, note); assert.equal(f.form.parentNode, parent);
      assert.equal(f.form.querySelector("label"), label); assert.equal(f.input.parentNode, row);
      assert.equal(f.form.listeners.submit.length, 1); assert.equal(f.input.listeners.input.length, 1);
      const later = f.addPage("lsat.html"); f.duplicate();
      assert.ok(later.hasAttribute("data-aced-notify-form")); assert.equal(sheets().length, 1);
      f.submit(); f.submit(); await flush(); assert.equal(f.requests.length, 1);
      assert.equal(f.note.textContent, copy.confirmed); assert.equal(f.storage.length, 0);
    });
  }
  await test("T02 v1.1 no matching forms means no stylesheet or component mutation", async () => {
    const f = fixture({ loading: true }); f.form.removeAttribute("data-aced-notify");
    f.init(); f.duplicate(); f.init();
    assert.equal(f.document.querySelectorAll("style[data-aced-notify-style]").length, 0);
    assert.equal(f.form.listeners.submit, undefined); assert.equal(f.input.listeners.input, undefined);
    assert.equal(f.form.hasAttribute("data-aced-notify-form"), false);
    assert.equal(f.note.hasAttribute("data-aced-notify-status"), false);
    assert.equal(f.requests.length, 0); assert.equal(f.storage.length, 0);
  });
  await test("T08 v1.1 static selector arms and geometry/focus rules (not computed browser layout)", async () => {
    const f = fixture(), sheet = f.document.querySelectorAll("style[data-aced-notify-style]")[0];
    assert.ok(sheet); const css = sheet.textContent;
    assert.equal(/url\s*\(|@import|@font-face|animation|--[\w-]+\s*:|(?:^|[,{}])\s*(?:body|html|:root|\*)/i.test(css), false);
    assert.equal(css.includes(address), false); assert.equal(css.includes(other), false);
    let arms = 0;
    for (const m of css.matchAll(/([^{}]+)\{/g)) {
      if (m[1].trim().startsWith("@media")) continue;
      for (const arm of m[1].split(",")) {
        arms++; assert.match(arm, /\[data-aced-notify-(?:form|row|email|submit|status)\]/);
      }
    }
    assert.ok(arms > 8);
    assert.match(css, /@media\s*\(max-width:\s*480px\)/);
    assert.match(css, /min-width:\s*0/); assert.match(css, /min-height:\s*44px/);
    assert.match(css, /box-sizing:\s*border-box/); assert.match(css, /max-width:\s*100%/);
    assert.match(css, /flex-direction:\s*column/); assert.match(css, /align-items:\s*stretch/);
    assert.match(css, /overflow-wrap:\s*anywhere/); assert.match(css, /:focus-visible/);
    assert.match(css, /outline:\s*2px solid #5cffea/);
    assert.match(css, /data-aced-notify-status[^\{]*\{[^}]*color:\s*#d8f5d8/i);
    assert.match(css, /data-aced-notify-status[^\{]*\.ok[^\{]*\{[^}]*color:\s*#9be36b/i);
    for (const id of ["capEmail", "em-lsat", "em-mcat", "em-nclex", "em-bar-exam", "em-usmle"])
      assert.ok(css.includes('label[for="' + id + '"]'));
  });
  await test("T02 v1.1 unmarked lookalikes, unrelated labels and ancestors stay unowned", async () => {
    const f = fixture({ loading: true }), create = (tag, values) => {
      const n = f.document.createElement(tag); for (const [k, v] of Object.entries(values)) n.setAttribute(k, v); return n;
    };
    const parent = create("section", {}), fake = create("form", { class: "formrow" });
    const input = create("input", { type: "email", id: "lookalike" }), button = create("button", { type: "submit" });
    const note = create("div", { class: "capnote ok" }), label = create("label", { for: "lookalike" });
    f.document.body.appendChild(parent); parent.appendChild(fake);
    for (const n of [label, input, button, note]) fake.appendChild(n);
    const unrelated = create("label", { for: "unrelated" }); f.form.appendChild(unrelated);
    const original = [parent, fake, input, button, note, label, unrelated].map(n => JSON.stringify(n.attrs));
    f.init(); f.duplicate(); f.init();
    [parent, fake, input, button, note, label, unrelated].forEach((n, i) => assert.equal(JSON.stringify(n.attrs), original[i]));
    assert.equal(fake.listeners.submit, undefined); assert.equal(f.form.parentNode.hasAttribute("data-aced-notify-form"), false);
    assert.equal(f.requests.length, 0); assert.equal(f.storage.length, 0);
  });
  return { passed, failed };
};
