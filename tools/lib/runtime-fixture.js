"use strict";

// Test-only environment for the ACTUAL inline study engine. No parsing dependency,
// copied rules, network, timers, executable HTML, or production debug API.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const html = read("study.html");
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script(?:\s+[^>]*)?>/gi)].map(m => m[1]);
const loader = scripts.find(s => s.includes("(function loadPack()"));
const engine = scripts.find(s => s.includes("window._packReady=function"));
const end = "}; // ===== end window._packReady =====";
assert.ok(loader && engine && engine.split(end).length === 2, "actual engine boundary must be unique");
const hook = `
globalThis.__runtime = {
  get G(){return G;}, get mastery(){return MASTERY;}, get unlocked(){return [...UNLOCKED];},
  get starters(){return STARTER_UNLOCKS.slice();}, get loadout(){return STARTER_DOCTRINES.slice();},
  get qbank(){return QBANK;}, set qbank(v){QBANK=v;},
  get modules(){return MODLABEL;}, get jokers(){return ALLJK;},
  store:ACED_STORE, start, saveUnlocked, checkUnlocks, buyJoker, mk, play, detectHand,
  openInsight, renderMastery, renderReadiness, cardHTML, showCardTip,
  renderAuditPicker, beginAuditQuestion, renderAudit, submitAudit, drillModule,
  runQuiz, launchReview, explanationsView, studyReport, runInfoView,
  readinessReport, nemesisRise, codexView, deckView, calibGridHTML, calibData,
  fastAnimations(){
    wait=async function(){};
    countUp=async function(el,to){if(el)el.textContent=String(to);};
  }
};
`;

function createRuntime(options = {}) {
  const id = options.id || "runtime-fixture";
  let now = options.now;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : now === undefined ? [] : [now])); }
    static now() { return now === undefined ? Date.now() : now; }
  }
  const memory = new Map(Object.entries(options.initial || {}).map(([k, v]) =>
    [k, typeof v === "string" ? v : JSON.stringify(v)]));
  const elements = new Map(), selectors = new Map(), requests = [], appended = [];
  const writes = [], sanitized = [], logs = [];
  let storageBlocked = !!options.storageBlocked, writesBlocked = false;
  function node(id = "") {
    const classes = new Set();
    return {
      id, style: { setProperty() {} }, dataset: {}, textContent: "", innerHTML: "",
      className: "", disabled: false,
      classList: {
        add(...items) { items.forEach(x => classes.add(x)); },
        remove(...items) { items.forEach(x => classes.delete(x)); },
        contains(x) { return classes.has(x); },
        toggle(x, force) {
          const add = force === undefined ? !classes.has(x) : force;
          if (add) classes.add(x); else classes.delete(x);
          return add;
        }
      },
      // Deliberately capture the pre-sanitizer string. This fixture does NOT
      // pretend to implement DOMPurify or browser HTML parsing/execution.
      replaceChildren(fragment) { this.innerHTML = fragment.markup; },
      appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {}, focus() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    };
  }
  const document = {
    readyState: "complete", title: "", activeElement: null, hidden: false,
    body: node("body"), documentElement: node("html"),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, node(id));
      return elements.get(id);
    },
    createElement: node,
    querySelectorAll(selector) { return selectors.get(selector) || []; },
    querySelector(selector) { return (selectors.get(selector) || [])[0] || null; },
    addEventListener() {},
    head: { appendChild(n) { appended.push(n); } }
  };
  const localStorage = {
    getItem(key) {
      if (storageBlocked) throw new Error("Synthetic inaccessible storage");
      return memory.has(key) ? memory.get(key) : null;
    },
    setItem(key, value) {
      if (storageBlocked || writesBlocked) throw new Error("Synthetic inaccessible storage");
      writes.push(key); memory.set(key, String(value));
    },
    removeItem(key) {
      if (storageBlocked) throw new Error("Synthetic inaccessible storage");
      memory.delete(key);
    },
    key(i) { return [...memory.keys()][i] || null; },
    get length() { return memory.size; }
  };
  const context = {
    document, localStorage,
    location: { search: "?pack=" + id, hash: "", pathname: "/study.html",
      href: "https://fixture.invalid/study.html?pack=" + id },
    history: { replaceState() {} }, URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array,
    Math: Object.create(Math), Date: Clock, JSON, Set, Map, Promise, AbortController,
    atob: s => Buffer.from(s, "base64").toString("binary"),
    btoa: s => Buffer.from(s, "binary").toString("base64"),
    // Generated IDs are deterministic and contain no user data.
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" },
    console: Object.fromEntries(["debug", "log", "warn", "error"].map(k =>
      [k, (...args) => logs.push([k, ...args])])),
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}, addEventListener() {},
    innerWidth: 1200, innerHeight: 900, performance: { now: () => 0 },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    DOMPurify: { sanitize(markup) { sanitized.push(markup); return { markup }; } },
    fetch(...args) { requests.push(args); throw new Error("Network forbidden in runtime fixture"); }
  };
  context.Math.random = () => 0.5;
  context.window = context;
  vm.createContext(context);
  const evaluate = (source, filename) => vm.runInContext(source, context, { filename, timeout: 3000 });
  ["aced-library.js", "aced-bridge.js", "aced-core.js", "packs/core-jokers.js"].forEach(file =>
    evaluate(read(file), file));
  const raw = options.raw || { id, name: "Runtime fixture", questions: [
    { id: "fixture-q1", q: "Synthetic question?", source: "Fixture topic",
      choices: ["Synthetic yes", "Synthetic no"], answer: 0, explain: "Synthetic explanation." }
  ] };
  const saved = context.ACEDLibrary.save(raw);
  assert.equal(saved.id, id);
  evaluate(engine.replace(end, hook + end), "study.html:actual-engine");
  const ready = context._packReady;
  context._packReady = function () {
    if (options.configurePack) options.configurePack(context.ACED_PACK, context);
    ready();
  };
  evaluate(loader, "study.html:actual-loader");
  assert.ok(context.__runtime, "actual library loader must invoke actual engine");
  return {
    context, api: context.__runtime, memory, document, elements, writes, sanitized,
    logs, requests, appended, node,
    blockStorage(value = true) { storageBlocked = value; },
    blockWrites(value = true) { writesBlocked = value; },
    setNow(value) { now = value; },
    choices(selector, data) {
      const nodes = data.map(dataset => Object.assign(node(), { dataset }));
      selectors.set(selector, nodes);
      return nodes;
    },
    modal() { return document.getElementById("modal").innerHTML; },
    loaderSource: loader, evaluate
  };
}

module.exports = { createRuntime };
