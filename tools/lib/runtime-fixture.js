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
const scriptBodies = source => require("./product-success-s1-tests").scripts(source).map(s=>s.code);
const scripts = scriptBodies(html);
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
  get audit(){return AUDIT;}, _qKey, wasMissedEver, addMissedEver, clearMissedEver,
  renderAcctBtn, openAcctModal, showModal, hideModal, toast,
  runQuiz, launchReview, updateReviewBadge, explanationsView, studyReport, runInfoView,
  readinessReport, nemesisRise, codexView, deckView, calibGridHTML, calibData,
  masteryPct, addMastery, readinessPct, weakestModule, renderCalibration, launchMockExam,
  win, lose, endRunSummary, confirmEndRun,
  shareCardArgs, moduleStatus, TREATMENTS, rulesCardHTML,
  get pack(){return PACK;}, get allMods(){return ALLMODS;}, get pay(){return ACEDPay;},
  get owns(){return _ownsSection;},set owns(value){_ownsSection=value;},
  fastAnimations(){
    wait=async function(){};
    countUp=async function(el,to){if(el)el.textContent=String(to);};
  }
};
`;

function createRuntime(options = {}) {
  const sourceRead=options.read||read;
  const alternate=options.read?scriptBodies(sourceRead("study.html")):scripts;
  const actualLoader=alternate.find(s=>s.includes("(function loadPack()"));
  const actualEngine=alternate.find(s=>s.includes("window._packReady=function"));
  assert.ok(actualLoader&&actualEngine&&actualEngine.split(end).length===2,"actual source boundaries");
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
      attrs: {},
      appendChild() {}, remove() {},
      setAttribute(k,v) { this.attrs[k]=String(v); },
      getAttribute(k) { return Object.hasOwn(this.attrs,k)?this.attrs[k]:null; },
      addEventListener() {}, focus() { document.activeElement=this; },
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
    Math: Object.create(Math), Date: Clock, Set, Map, Promise, AbortController,
    atob: s => Buffer.from(s, "base64").toString("binary"),
    btoa: s => Buffer.from(s, "binary").toString("base64"),
    // Generated IDs are deterministic and contain no user data.
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001",
      getRandomValues(a) { a.fill(7); return a; } },
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
  let focusModel;
  if (options.focusLifecycle) {
    // Explicit inert ownership/removal and options conversion. No HTML parsing,
    // browser focus support, computed geometry or native accessibility claim.
    const listeners=new Map(),calls=[],attempts=[],created=[];
    class Element {}
    Element.prototype.focus=function(opts){
      attempts.push({node:this,connected:this.isConnected});
      if(focusModel.mode==="throw")throw Error("synthetic focus failure");
      const preventScroll=focusModel.mode==="ignore"?undefined:opts?.preventScroll;
      calls.push({node:this,preventScroll,connected:this.isConnected});
      if(!this.isConnected){if(focusModel.mode==="probe-steals")document.activeElement=this;return;}
      if(focusModel.mode!=="no-land")document.activeElement=this;
    };
    function make(n,tag="DIV"){
      Object.setPrototypeOf(n,Element.prototype);delete n.focus;
      Object.assign(n,{nodeType:1,tagName:tag,ownerDocument:document,isConnected:true,parentElement:null,
        hidden:false,inert:false,tabIndex:0,computed:{display:"block",visibility:"visible",opacity:"1"}});
      n.hasAttribute=k=>Object.hasOwn(n.attrs,k);
      n.removeAttribute=k=>{delete n.attrs[k];};
      n.getClientRects=()=>[{width:100,height:100}];
      n.closest=selector=>{
        assert.equal(selector,'[hidden],[inert],[aria-hidden="true"]');
        for(let p=n;p;p=p.parentElement)if(p.hidden||p.inert||p.attrs?.["aria-hidden"]==="true")return p;
        return null;
      };
      n.matches=selector=>{
        assert.equal(selector,".qch,.tbopt,.ctier");
        return ["qch","tbopt","ctier"].some(c=>n.classList.contains(c));
      };
      n.click=()=>{if(n.onclick)n.onclick();};
      return n;
    }
    const get=document.getElementById;
    document.getElementById=id=>{
      const n=get(id);if(!(n instanceof Element))make(n);
      return n;
    };
    make(document.body,"BODY");make(document.documentElement,"HTML");document.body.parentElement=document.documentElement;
    const hand=document.getElementById("hand");hand.parentElement=document.body;
    let markup="",cards=[];
    Object.defineProperty(hand,"innerHTML",{get:()=>markup,set(value){
      markup=String(value);focusModel.renders++;
      if(cards.includes(document.activeElement))document.activeElement=document.body;
      cards.forEach(n=>{n.isConnected=false;n.parentElement=null;});
      const game=context.__runtime.G;
      cards=Array.from(game.hand,(c,i)=>{
        const n=make(node());n.parentElement=hand;n.classList.add("card");
        n.dataset.id=String(c.id);n.setAttribute("data-id",String(c.id));
        n.setAttribute("role","button");n.setAttribute("tabindex","0");
        n.setAttribute("aria-label","Synthetic engine card "+i);
        n.setAttribute("aria-pressed",game.sel.has(c.id)?"true":"false");return n;
      });
      selectors.set("#hand .card",cards);
      if(focusModel.afterReplace)focusModel.afterReplace(cards);
    }});
    document.addEventListener=(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);};
    const query=document.querySelectorAll;
    document.querySelectorAll=selector=>selector==='.aced-ob-back,dialog[open],[role="dialog"][aria-modal="true"]'?focusModel.dialogs:query(selector);
    document.visibilityState="visible";document.hasFocus=()=>true;
    document.createElement=tag=>{const n=make(node(),tag.toUpperCase());n.isConnected=false;created.push(n);return n;};
    context.HTMLElement=Element;context.getComputedStyle=n=>n.computed;
    focusModel={mode:"supported",calls,attempts,created,listeners,dialogs:[],renders:0,afterReplace:null,hand,
      make:(tag="BUTTON")=>make(node(),tag),get cards(){return cards;},
      key(n,key,extra={}){
        const e={key,currentTarget:n,target:n,prevented:0,stopped:0,
          preventDefault(){this.prevented++;},stopPropagation(){this.stopped++;},...(typeof extra==="function"?{}:extra)};
        if(typeof extra==="function")extra(e);
        n.onkeydown(e);
        if(!e.stopped)for(const fn of listeners.get("keydown")||[])fn.call(document,e);
        return e;
      }
    };
  }
  ["aced-library.js", "aced-bridge.js", "aced-core.js", "packs/core-jokers.js"].forEach(file =>
    evaluate(sourceRead(file), file));
  if (options.publicLoader) {
    // Explicit event/script scheduling, not HTML parsing or real requests.
    assert.equal(alternate.filter(s=>s.includes("(function loadPack()")).length,1);
    assert.equal(alternate.filter(s=>s.includes("window._packReady=function")).length,1);
    const listeners = new Map(), listenerAdds = [], listenerRemoves = [], timers = [];
    document.readyState = options.publicLoader.readyState || "loading";
    document.addEventListener = (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn); listenerAdds.push(type);
    };
    document.removeEventListener = (type, fn) => {
      if (listeners.has(type)) listeners.get(type).delete(fn);
      listenerRemoves.push(type);
    };
    context.setTimeout = (fn, ms) => { timers.push({fn, ms}); return timers.length; };
    let started = false, defined = false;
    evaluate("globalThis.__publicDeliveries=[]", "fixture:public-counter");
    return {
      context, document, elements, memory, writes, sanitized, logs, requests, appended,
      node, evaluate, listeners, listenerAdds, listenerRemoves, timers,
      get api() { return context.__runtime; },
      get deliveries() { return Array.from(context.__publicDeliveries); },
      startLoader() {
        assert.equal(started, false); started = true;
        evaluate(actualLoader, "study.html:actual-public-loader");
      },
      defineEngine() {
        assert.equal(defined, false); defined = true;
        const anchor = "window._packReady=function(){";
        assert.equal(actualEngine.split(anchor).length, 2);
        evaluate(actualEngine.replace(anchor, anchor+"window.__publicDeliveries.push(this===window);")
          .replace(end, hook+end), "study.html:actual-public-engine");
      },
      fireDocument(type, state) {
        if (state !== undefined) document.readyState = state;
        for (const fn of [...(listeners.get(type) || [])]) fn.call(document, {type, target:document});
      },
      modal() { return document.getElementById("modal").innerHTML; },
      loaderSource: actualLoader
    };
  }
  const raw = options.raw || { id, name: "Runtime fixture", questions: [
    { id: "fixture-q1", q: "Synthetic question?", source: "Fixture topic",
      choices: ["Synthetic yes", "Synthetic no"], answer: 0, explain: "Synthetic explanation." }
  ] };
  const saved = options.loadExisting ? context.ACEDLibrary.get(id) : context.ACEDLibrary.save(raw);
  assert.equal(saved.id, id);
  const actualHook=options.focusLifecycle?hook.replace("store:ACED_STORE, start,",
    "render, get sound(){return sfx;}, setGame(value){G=value;}, store:ACED_STORE, start,"):hook;
  evaluate(actualEngine.replace(end, actualHook + end), "study.html:actual-engine");
  const ready = context._packReady;
  context._packReady = function () {
    if (options.configurePack) options.configurePack(context.ACED_PACK, context);
    if (options.configureContext) options.configureContext(context);
    ready();
  };
  evaluate(actualLoader, "study.html:actual-loader");
  assert.ok(context.__runtime, "actual library loader must invoke actual engine");
  return {
    context, api: context.__runtime, memory, document, elements, writes, sanitized,
    logs, requests, appended, node,
    ...(focusModel?{focusModel}:{}),
    blockStorage(value = true) { storageBlocked = value; },
    blockWrites(value = true) { writesBlocked = value; },
    setNow(value) { now = value; },
    choices(selector, data) {
      const nodes = data.map(dataset => Object.assign(node(), { dataset }));
      selectors.set(selector, nodes);
      return nodes;
    },
    modal() { return document.getElementById("modal").innerHTML; },
    loaderSource: actualLoader, evaluate
  };
}

module.exports = { createRuntime };
