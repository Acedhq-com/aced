"use strict";

// Actual-source, synthetic-I/O checks. This is not an HTML parser, sanitizer,
// browser, PDF codec or accessibility/layout implementation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../..");
const disk = name => fs.readFileSync(path.join(root, name), "utf8");
const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }

function scripts(html) {
  const result = [], open = /<script(?=[\t\n\f\r />])[^>]*>/gi;
  let m;
  while ((m = open.exec(html))) {
    const lower = html.toLowerCase(); let end = lower.indexOf("</script", open.lastIndex);
    while (end >= 0 && !/[\t\n\f\r />]/.test(html[end + 8] || "")) end = lower.indexOf("</script", end + 8);
    assert.ok(end >= 0, "actual script requires an end delimiter");
    const close = html.indexOf(">", end);
    assert.ok(close >= 0, "actual script requires a closed end tag");
    result.push({ tag: m[0], code: html.slice(open.lastIndex, end) });
    open.lastIndex = close + 1;
  }
  return result;
}
function uniqueScript(html, marker) {
  const selected = scripts(html).filter(s => s.code.includes(marker));
  assert.equal(selected.length, 1, "actual script selector must be unique");
  return selected[0].code;
}
function dom() {
  const ids = new Map(), nodes = [], writes = [], timers = new Map();
  let now = 1000, timerId = 0;
  function node(id = "", tagName = "DIV") {
    const listeners = {}, attrs = {}, classes = new Set();
    const n = {
      tagName, value: "", textContent: "", innerHTML: "", hidden: false, disabled: false,
      isConnected: true, style: {}, children: [], dataset: {}, listeners, attrs,
      setAttribute(k,v) { attrs[k]=String(v); if(k==="id") this.id=String(v); },
      getAttribute(k) { return Object.hasOwn(attrs,k)?attrs[k]:null; },
      removeAttribute(k) { delete attrs[k]; }, hasAttribute(k) { return Object.hasOwn(attrs,k); },
      addEventListener(k,fn) { (listeners[k] ||= []).push(fn); },
      async fire(k,extra={}) { const e={target:this,preventDefault(){},...extra}; if(typeof this["on"+k]==="function") await this["on"+k](e); for(const f of listeners[k]||[]) await f(e); await tick(); },
      appendChild(child) { this.children.push(child); child.parentNode=this; return child; },
      contains(child) { return child===this||this.children.some(c=>c.contains(child)); },
      querySelectorAll(selector) {
        if(selector===".qc") return []; // No invented parsing of renderer strings.
        return [];
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0]||null; },
      classList: { add(...a){a.forEach(x=>classes.add(x));},remove(...a){a.forEach(x=>classes.delete(x));},contains(x){return classes.has(x);},toggle(x){if(classes.has(x)){classes.delete(x);return false;}classes.add(x);return true;} },
      focus() { document.activeElement=this; }, select(){}, click(){return this.fire("click");},
      remove(){this.isConnected=false;}, reset(){this.resets=(this.resets||0)+1;this.children.filter(c=>c.tagName==="INPUT").forEach(c=>{c.value="";});}
    };
    let ownId=id,markup=""; Object.defineProperty(n,"id",{get:()=>ownId,set(v){ids.delete(ownId); ownId=v;ids.set(v,n);}});
    Object.defineProperty(n,"innerHTML",{get:()=>markup,set(v){markup=String(v);n.children=[];}});
    if(id) ids.set(id,n); nodes.push(n); return n;
  }
  const document = {
    readyState:"complete", activeElement:null, body:null, head:null,
    getElementById:id=>ids.get(id)||null, createElement:tag=>node("",tag.toUpperCase()),
    addEventListener(){}, querySelectorAll(selector) {
      if(selector==="[id]") return nodes.filter(n=>n.id);
      if(selector==="form[data-aced-notify]") return nodes.filter(n=>n.tagName==="FORM"&&n.hasAttribute("data-aced-notify"));
      if(selector==="style[data-aced-notify-style]") return nodes.filter(n=>n.tagName==="STYLE"&&n.hasAttribute("data-aced-notify-style"));
      return [];
    }, querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  };
  document.body=node("body"); document.head=node("head");
  class Clock extends Date { static now(){return now;} }
  const memory=new Map(), requests=[], events=[], navigations=[], bufferCalls=[];
  const location={search:"",hash:"",pathname:"/index.html"};
  Object.defineProperty(location,"href",{get:()=>navigations.at(-1)||"https://fixture.invalid/index.html",set:v=>navigations.push(v)});
  const context={
    document,location,history:{replaceState(){}},URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,
    Date:Clock,AbortController, Blob, console:{log(){},warn(){},error(){}},
    setTimeout(fn,ms){timers.set(++timerId,{fn,at:now+ms});return timerId;},clearTimeout(id){timers.delete(id);},
    scrollTo(){}, navigator:{}, localStorage:{
      getItem(k){return memory.get(k)??null;},setItem(k,v){writes.push(k);memory.set(k,String(v));},
      removeItem(k){memory.delete(k);},key(i){return [...memory.keys()][i]||null;},get length(){return memory.size;}
    },
    btoa:s=>Buffer.from(s,"binary").toString("base64"),atob:s=>Buffer.from(s,"base64").toString("binary"),
    fetch(...args){requests.push(args);throw Error("synthetic network trap");},
    ACEDCore:{store:{get(){bufferCalls.push("read");throw Error("address buffer read forbidden");},set(){bufferCalls.push("write");throw Error("address buffer write forbidden");}},analytics:{track(...a){events.push(a);}}},
  };
  context.window=context; vm.createContext(context);
  const evaluate=(code,name="actual-source")=>vm.runInContext(code,context,{filename:name,timeout:3000});
  const json=value=>evaluate("("+JSON.stringify(value)+")");
  function form(source="home") {
    const f=node("","FORM"),input=node("","INPUT"),button=node("","BUTTON"),note=node(),hp=node("","INPUT"),row=f;
    f.setAttribute("data-aced-notify","");f.setAttribute("data-source",source);f.setAttribute("data-endpoint","https://capture.invalid/notify");
    f.classList.add("formrow");input.value="synthetic@example.invalid"; button.textContent="NOTIFY ME"; note.classList.add("capnote");
    f.appendChild(input);f.appendChild(button);f.appendChild(hp);f.appendChild(note);
    f.querySelectorAll=s=>s==='input[type="email"]'?[input]:s==='input[name="company"]'?[hp]:s==='[type="submit"]'||s==="button"?[button]:s===".capnote"?[note]:s===".formrow"?[row]:[];
    return {form:f,input,button,note,hp};
  }
  return {context,document,node,evaluate,json,form,memory,writes,requests,events,navigations,timers,bufferCalls,
    advance(ms){now+=ms; for(const [id,t] of [...timers]) if(t.at<=now){timers.delete(id);t.fn();}},
    ensure(id){return document.getElementById(id)||node(id);}
  };
}
function classic(read=disk) {
  const f=dom(); ["toast","hero","flowPaste","flowUpload","flowSample","flowPreview","pasteBox","pasteBuild","copyPrompt","aiPrompt","qlist","pvMeta","packName","playNow","sharePack","dlPack","shareBox","file","drop","uStatus","uBuild"].forEach(f.ensure);
  f.evaluate(read("aced-library.js"),"aced-library.js");
  const html=read("importer-classic.html");
  f.evaluate(uniqueScript(html,"root.ACEDExtract = api"),"classic:actual-extractor");
  const controller=uniqueScript(html,'var SECTIONS=["hero"');
  const end=controller.lastIndexOf("})();"); assert.ok(end>=0);
  f.evaluate(controller.slice(0,end)+
    "globalThis.__classic={handleFile,extractPdf,validPack,toPreview,get draft(){return draft;}};\n"+controller.slice(end),"classic:actual-controller");
  f.api=f.context.__classic; f.change=file=>f.ensure("file").fire("change",{target:{files:file?[file]:[]}});
  const list=f.ensure("qlist"),append=list.appendChild;
  list.querySelectorAll=s=>s===".qc"?list.children:[];
  list.appendChild=function(card){
    // Supply explicit controls for event wiring, never interpret innerHTML.
    const index=Number(card.getAttribute("data-i")),q=f.api.draft[index],stem=f.node(),del=f.node();
    const choices=q.choices.map((v,i)=>{const n=f.node();n.value=v;n.setAttribute("data-j",i);return n;});
    const radios=q.choices.map((v,i)=>{const n=f.node();n.setAttribute("data-j",i);return n;});
    stem.value=q.q;card.fixture={stem,del,choices,radios};
    card.querySelector=s=>s===".qstem"?stem:s===".del"?del:null;
    card.querySelectorAll=s=>s===".qopt"?choices:s==="input[type=radio]"?radios:[];
    return append.call(list,card);
  };
  f.build=()=>f.ensure("uBuild").fire("click");
  f.pdf=pages=>{f.context.pdfjsLib={getDocument:()=>({promise:Promise.resolve({numPages:pages.length,getPage:async i=>({getTextContent:async()=>{if(pages[i-1] instanceof Error)throw pages[i-1];return {items:pages[i-1]};}})})})};};
  return f;
}
function home(read=disk) {
  const f=dom(); ["bootGo","bootNotes","bootStatus","capForm","capNote","capEmail"].forEach(f.ensure);
  const form=f.ensure("capForm");form.tagName="FORM";const input=f.ensure("capEmail"), note=f.ensure("capNote"),button=f.node("","BUTTON");
  form.setAttribute("data-aced-notify","");form.setAttribute("data-source","home");form.setAttribute("data-endpoint","https://capture.invalid/notify");
  form.appendChild(input);form.appendChild(button);form.appendChild(note);input.value="synthetic@example.invalid";
  form.querySelectorAll=s=>s==='input[type="email"]'?[input]:s==='[type="submit"]'||s==="button"?[button]:s===".capnote"?[note]:[];
  f.evaluate(read("aced-library.js"),"aced-library.js");
  f.evaluate(uniqueScript(read("index.html"),"var bootGo="),"home:actual-controller");
  f.evaluate(read("notify.js"),"notify.js");
  return {...f,form,input,note,button};
}
function modern(read=disk) {
  const f=dom();
  ["pack-form","pack-notes","pack-name","pack-subject","question-editors","save-play","save-library","input-stage","review-stage","questions-section","import-status","import-title","import-subtitle","question-count","pack-file","dropzone","example-button","back-input","add-question"].forEach(f.ensure);
  f.document.readyState="loading";
  f.evaluate(read("aced-library.js"),"aced-library.js"); f.evaluate(read("aced-ui.js"),"aced-ui.js");f.evaluate(read("aced-importer.js"),"aced-importer.js");
  return f;
}
const inputFile=(name,text)=>({name,size:100,text:async()=>text,arrayBuffer:async()=>new ArrayBuffer(0)});
const pairText="alpha: first\nbeta: second";
// Already supported by the pinned old classic parser and its 20-word gate.
// Use this control to isolate lifecycle/durability defects from the new grammar.
const legacyPairText="alpha: "+Array(21).fill("one").join(" ")+"\nbeta: second distinct answer";
function item(str,x=20,y=700,width=30,hasEOL=false) {return {str,width,hasEOL,transform:[1,0,0,1,x,y]};}

async function run(options={}) {
  const read=options.read||disk, results=[];
  async function test(name,fn) {
    try {await fn();results.push({name,ok:true});}
    catch (_) {results.push({name,ok:false,kind:_.name,frame:String(_.stack).split("\n").find(s=>s.includes("product-success-s1-tests.js:"))||""});} // Never print fixture content/assertion values.
  }
  for(const route of ["home","subject"]) {
    await test(route+": HTTP rejection never confirms or resets",async()=>{
      const f=route==="home"?home(read):dom(), form=route==="home"?f:{...f.form("lsat")};
      if(route!=="home") f.evaluate(read("notify.js"),"notify.js");
      f.context.fetch=(...a)=>{f.requests.push(a);return Promise.resolve({ok:false,status:500,json:()=>Promise.resolve(f.json({ok:true}))});};
      await form.form.fire("submit"); assert.match(form.note.textContent,/not confirmed/);assert.equal(form.input.value,"synthetic@example.invalid");assert.equal(f.events.length,0);
    });
    await test(route+": missing endpoint never confirms",async()=>{
      const f=route==="home"?home(read):dom(), form=route==="home"?f:{...f.form()};
      if(route!=="home")f.evaluate(read("notify.js"));
      form.form.setAttribute("data-endpoint","");await form.form.fire("submit");
      assert.match(form.note.textContent,/not connected/);assert.equal(f.requests.length,0);
    });
  }
  await test("capture: strict ACK/status and no storage access",async()=>{
    for(const status of [0,199,200,204,299,300,429,500,"200"])for(const ok of [true,false]){
      const f=dom(),a=f.form();f.context.fetch=(...v)=>{f.requests.push(v);return Promise.resolve({status,ok,json:()=>Promise.resolve(f.json({ok:true}))});};f.evaluate(read("notify.js"));await a.form.fire("submit");
      assert.equal(a.note.textContent.includes("was accepted"),ok&&Number.isInteger(status)&&status>=200&&status<300);
      assert.equal(f.events.length,ok&&Number.isInteger(status)&&status>=200&&status<300?1:0);assert.equal(f.writes.length,0);assert.equal(f.bufferCalls.length,0);
    }
  });
  await test("capture: own inert JSON ACK only; hooks are never invoked",async()=>{
    for(const expression of ['({ok:true})','Object.assign(Object.create(null),{ok:true})','({ok:"true"})','({ok:1})','({})','null','[]','Object.create({ok:true})','Object.assign(Object.create({}),{ok:true})','({get ok(){globalThis.hooks++;return true;}})','({ok:true,get extra(){globalThis.hooks++;return 1;}})','({ok:true,then(){globalThis.hooks++;}})','({ok:true,[Symbol()]:1})']){
      const f=dom(),a=f.form();f.context.hooks=0;const body=f.evaluate(expression);f.context.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>body});f.evaluate(read("notify.js"));await a.form.fire("submit");
      assert.equal(f.context.hooks,0); assert.equal(a.note.textContent.includes("was accepted"),expression==='({ok:true})'||expression.startsWith("Object.assign(Object.create(null)"));
    }
  });
  await test("capture: arbitrary transport thenable is not invoked",async()=>{
    const f=dom(),a=f.form();f.context.hooks=0;f.context.fetch=()=>f.evaluate("({then(){hooks++;}})");f.evaluate(read("notify.js"));await a.form.fire("submit");assert.equal(f.context.hooks,0);assert.match(a.note.textContent,/not confirmed/);
  });
  await test("capture: pending edits, deadline, late response and new attempt",async()=>{
    const f=dom(),a=f.form(),d=deferred();f.context.fetch=(...v)=>{f.requests.push(v);return d.promise;};f.evaluate(read("notify.js"));
    await a.form.fire("submit");assert.equal(a.button.disabled,true);assert.equal(a.input.disabled,false);assert.equal(a.form.getAttribute("aria-busy"),"true");
    await a.form.fire("submit");assert.equal(f.requests.length,1);
    a.input.value="changed@example.invalid";await a.input.fire("input");a.input.value="synthetic@example.invalid";await a.input.fire("change");
    d.resolve({ok:true,status:200,json:()=>Promise.resolve(f.json({ok:true}))});await tick();
    assert.match(a.note.textContent,/earlier submission was accepted/i);assert.equal(f.events.length,0);assert.equal(a.button.disabled,false);
    const slow=deferred();f.context.fetch=()=>slow.promise;await a.form.fire("submit");f.advance(10000);await tick();assert.match(a.note.textContent,/timed out/);
    slow.resolve({ok:true,status:200,json:()=>f.json({ok:true})});await tick();assert.match(a.note.textContent,/timed out/);assert.equal(f.events.length,0);
  });
  await test("capture: parse deadline, detach, independent forms and idempotence",async()=>{
    const f=dom(),a=f.form("lsat"),b=f.form("mcat"),d=deferred();
    f.context.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>d.promise});f.evaluate(read("notify.js"));f.evaluate(read("notify.js"));
    await a.form.fire("submit");await b.form.fire("submit");assert.equal(a.form.listeners.submit.length,1);a.form.isConnected=false;
    f.advance(10001);d.resolve(f.json({ok:true}));await tick();assert.equal(f.events.length,0);assert.equal(b.button.disabled,false);
    assert.equal(f.document.querySelectorAll("style[data-aced-notify-style]").length,1);
  });
  await test("capture: fixed metric sources, payload, endpoint and honeypot",async()=>{
    for(const source of ["home","lsat","mcat","nclex","bar-exam","usmle","unknown"]){
      const f=dom(),a=f.form(source);f.context.fetch=(...v)=>{f.requests.push(v);return Promise.resolve({ok:true,status:200,json:()=>f.json({ok:true})});};f.evaluate(read("notify.js"));a.hp.value="blocked";await a.form.fire("submit");assert.equal(f.requests.length,0);a.hp.value="";await a.form.fire("submit");
      assert.deepEqual(JSON.parse(f.requests[0][1].body),{email:"synthetic@example.invalid",source});assert.equal(f.events.length,source==="unknown"?0:1);
      if(f.events.length)assert.deepEqual(JSON.parse(JSON.stringify(f.events[0])),["email_captured",{source}]);
    }
  });
  await test("classic: short pairs through actual file change and Build",async()=>{
    const f=classic(read);await f.change(inputFile("fixture.TXT",pairText));await tick();assert.equal(f.ensure("uBuild").disabled,false);await f.build();
    assert.ok(f.api.draft.length>=2);assert.equal(f.ensure("pasteBox").value,pairText);
  });
  await test("classic: PDF item order and geometry retain independent lines",async()=>{
    const f=classic(read);f.pdf([[item("per",20,700,30),item("ro",50,700,20),item(" / dog",80,700,50,true),item("gato / cat",20,684,70,true)]]);
    await f.change(inputFile("fixture.pdf",""));await tick();await f.build();assert.ok(f.api.draft.length>=2);
    assert.equal(f.ensure("pasteBox").value,"perro / dog\ngato / cat\n");
  });
  await test("classic: PDF gap/baseline boundaries and fail-closed malformed geometry",async()=>{
    for(const gap of [-1,0,1,1.01,24]){
      const f=classic(read);f.pdf([[item("alpha:",20,700,30),item("first",50+gap,700,30,true)],[item("beta: second",20,684,80,true)]]);
      const text=await f.api.extractPdf(inputFile("fixture.pdf",""));assert.equal(text.includes(gap<=1?"alpha:first":"alpha: first"),true);
    }
    for(const gap of [-1.01,24.01]){
      const f=classic(read);f.pdf([[item("alpha:",20,700,30),item("first",50+gap,700,30,true)]]);await assert.rejects(f.api.extractPdf(inputFile("fixture.pdf","")));
    }
    for(const bad of [undefined, [1,0.01,0,1,20,700], [1,0,0,1,NaN,700]]){
      const f=classic(read),a=item("alpha:");a.transform=bad;f.pdf([[a,item("first",50,700,30,true)]]);await assert.rejects(f.api.extractPdf(inputFile("fixture.pdf","")));
    }
    const f=classic(read);f.pdf([[item("alpha: first"),item("beta: second",0,697.99,20,true)]]);assert.equal((await f.api.extractPdf(inputFile("fixture.pdf",""))).split("\n").filter(Boolean).length,2);
  });
  await test("classic: supported grammar, true alternatives, safe literal terms and MCQ precedence",()=>{
    const f=classic(read),E=f.context.ACEDExtract;
    for(const sep of ["::",": "," = "," -> "," => "," → "," — "," – "," - "," / "]){
      assert.ok(E.fromAny("x"+sep+"one\ny"+sep+"two").questions.length>=2);
    }
    assert.equal(E.fromAny("a: x").questions.length,0);
    assert.equal(E.fromAny("https://fixture.invalid/path\n12:30 PM").questions.length,0);
    assert.ok(E.fromAny("constructor: x\ntoString: y\nhasOwnProperty: z\n日本: 語").questions.length>=4);
    assert.ok(E.fromAny("Spanish: perro / dog\nFrench: chat / cat").questions.length>=2);
    assert.equal(E.fromAny('{"cards":[{"question":"Synthetic","answer":"One"}]}').questions.length,1);
    const q=E.fromAny("1. Synthetic?\nA. One\nB. Two\nAnswer: B\nExplanation: Authored").questions[0];assert.equal(q.answer,1);assert.equal(q.explain,"Authored");
    assert.ok(E.fromAny(Array.from({length:100},(_,i)=>"term"+i+": answer"+i).join("\n")).questions.length<=60);
  });
  await test("classic: latest file intent invalidates null, rejected, manual and delayed operations",async()=>{
    const f=classic(read),d=deferred();await f.change(inputFile("old.txt",legacyPairText));assert.equal(f.ensure("uBuild").disabled,false);const before=f.ensure("uStatus").textContent;
    await f.change({name:"slow.txt",size:10,text:()=>d.promise});await f.change(null);d.resolve(legacyPairText);await tick();assert.equal(f.ensure("uBuild").disabled,true);assert.notEqual(f.ensure("uStatus").textContent,before);
    await f.change(inputFile("new.txt",legacyPairText));await f.change(inputFile("bad.exe",legacyPairText));assert.equal(f.ensure("uBuild").disabled,true);
    const next=deferred();await f.change({name:"slow.txt",size:10,text:()=>next.promise});await f.ensure("pasteBox").fire("input");next.resolve(legacyPairText);await tick();assert.equal(f.ensure("uBuild").disabled,true);
  });
  await test("modern: stale file cannot overwrite manual notes or metadata",async()=>{
    const f=modern(read),d=deferred();f.ensure("pack-file").onchange({target:{files:[{name:"old.txt",size:10,text:()=>d.promise}]}});
    f.ensure("pack-notes").value=pairText;await f.ensure("pack-notes").fire("input");f.ensure("pack-name").value="Synthetic title";await f.ensure("pack-name").fire("input");d.resolve("stale: answer");await tick();assert.equal(f.ensure("pack-notes").value,pairText);assert.equal(f.ensure("pack-name").value,"Synthetic title");
  });
  await test("home: blocked or contradicted draft carrier never navigates truncated text",async()=>{
    const f=home(read),L=f.context.ACEDLibrary;f.ensure("bootNotes").value="a: x\n"+" ".repeat(60001);L.stashDraft=()=>false;L.isPersistent=()=>false;await f.ensure("bootGo").fire("click");assert.equal(f.navigations.length,0);assert.match(f.ensure("bootStatus").textContent,/could not be handed/);
  });
  await test("home: real blocked-storage Unicode fragment is exact and bounded",async()=>{
    const f=home(read);f.context.ACEDLibrary.stashDraft=()=>false;f.context.ACEDLibrary.isPersistent=()=>false;
    const raw="日本: 語\nα: β\n ";f.ensure("bootNotes").value=raw;await f.ensure("bootGo").fire("click");assert.equal(f.navigations.length,1);
    const url=new URL(f.navigations[0],"https://fixture.invalid/");assert.equal(f.context.ACEDLibrary.decode(new URLSearchParams(url.hash.slice(1)).get("notes")),raw);
  });
  await test("classic: memory-only save holds exact editable preview; durable save opens fresh library",async()=>{
    for(const persistent of [false,true]){
      const f=classic(read);await f.change(inputFile("fixture.txt",legacyPairText));await tick();await f.build();assert.ok(f.api.draft.length>0);const before=JSON.stringify(f.api.draft);f.ensure("packName").value="Synthetic title";
      if(!persistent)f.context.ACEDLibrary.isPersistent=()=>false;
      await f.ensure("playNow").fire("click");assert.equal(f.navigations.length,persistent?1:0);assert.equal(JSON.stringify(f.api.draft),before);assert.equal(f.ensure("packName").value,"Synthetic title");
      if(!persistent)assert.match(f.ensure("pvMeta").textContent,/not confirmed saved/);
      else {const next=dom();for(const [k,v] of f.memory)next.memory.set(k,v);next.evaluate(read("aced-library.js"));const id=new URL(f.navigations[0],"https://fixture.invalid/").searchParams.get("pack");assert.ok(next.context.ACEDLibrary.get(id));}
    }
  });
  await test("classic: PDF explicit hard breaks, pages, empty middle and failed pages",async()=>{
    const f=classic(read);f.pdf([[{str:"alpha: first\r\nbeta: second"}],[],[{str:"gamma: third",hasEOL:true}]]);
    const text=await f.api.extractPdf(inputFile("fixture.pdf",""));assert.ok(text.indexOf("alpha")<text.indexOf("beta")&&text.indexOf("beta")<text.indexOf("gamma"));
    f.pdf([[{str:"alpha: first",hasEOL:true},{str:"",hasEOL:true},{str:"beta: second",hasEOL:true}]]);assert.ok((await f.api.extractPdf(inputFile("fixture.pdf",""))).includes("beta"));
    f.pdf([[item("alpha: first",20,700,80,true)],new Error("synthetic")]);await f.change(inputFile("fixture.pdf",""));await tick();assert.equal(f.ensure("uBuild").disabled,true);assert.equal(f.api.draft.length,0);
  });
  await test("classic: PDF baseline inclusive two, EOL reset and multiline ambiguity",async()=>{
    for(const delta of [2,2.001]){
      const f=classic(read);f.pdf([[item("alpha:",20,700,30),item("first",50,700-delta,30,true)]]);
      const text=await f.api.extractPdf(inputFile("fixture.pdf",""));assert.equal(text.includes("alpha:first"),delta===2);
    }
    const f=classic(read);f.pdf([[item("alpha: first",20,700,80,true),item("beta: second",20,700,80,true)]]);assert.equal((await f.api.extractPdf(inputFile("fixture.pdf",""))).split("\n").filter(Boolean).length,2);
    f.pdf([[item("alpha: first\nbeta:",20,700,30),item("second",50,700,30,true)]]);await assert.rejects(f.api.extractPdf(inputFile("fixture.pdf","")));
  });
  await test("classic: Word plumbing, uppercase extensions, empty and oversize replacement",async()=>{
    const f=classic(read);let calls=0;f.context.mammoth={extractRawText:async()=>{calls++;return {value:pairText};}};
    await f.change(inputFile("fixture.DOCX",""));await tick();assert.equal(calls,1);assert.equal(f.ensure("uBuild").disabled,false);await f.build();assert.equal(f.ensure("pasteBox").value,pairText);
    for(const file of [inputFile("empty.txt",""),{...inputFile("large.txt",pairText),size:20*1024*1024+1},inputFile("bad.exe",pairText),null]){
      await f.change(file);await tick();assert.equal(f.ensure("uBuild").disabled,true);const before=f.navigations.length;await f.ensure("playNow").fire("click");assert.equal(f.navigations.length,before);
    }
  });
  await test("modern: null/rejected/oversize replacement and stale rejection preserve current source",async()=>{
    const f=modern(read);f.ensure("pack-notes").value=pairText;await f.ensure("pack-form").fire("submit");
    for(const file of [null,inputFile("bad.pdf",pairText),{...inputFile("large.txt",pairText),size:5*1024*1024+1}]){
      await f.ensure("pack-file").fire("change",{target:{files:file?[file]:[]}});assert.equal(f.ensure("pack-notes").value,pairText);assert.equal(f.ensure("save-play").disabled,true);
    }
    const d=deferred();f.ensure("pack-file").onchange({target:{files:[{name:"slow.txt",size:10,text:()=>d.promise}]}});
    await f.ensure("example-button").fire("click");const before=f.ensure("import-status").textContent;d.reject(new Error("synthetic"));await tick();assert.equal(f.ensure("import-status").textContent,before);
  });
  await test("modern: an old issue-acceptance button cannot release a rejected new file",async()=>{
    const f=modern(read);f.ensure("pack-notes").value=pairText+"\nUnsupported prose";await f.ensure("pack-form").fire("submit");
    assert.equal(f.ensure("save-play").disabled,true);
    await f.ensure("pack-file").fire("change",{target:{files:[inputFile("bad.pdf",pairText)]}});
    await f.ensure("continue-lines").fire("click");assert.equal(f.ensure("save-play").disabled,true);await f.ensure("save-play").fire("click");assert.equal(f.navigations.length,0);
    await f.ensure("back-input").fire("click");await f.ensure("pack-form").fire("submit");await f.ensure("continue-lines").fire("click");assert.equal(f.ensure("save-play").disabled,false);
  });
  await test("home: actual persistent draft readback and exact Unicode size boundary",async()=>{
    const f=home(read),raw=" "+pairText+"\n ";f.ensure("bootNotes").value=raw;await f.ensure("bootGo").fire("click");assert.equal(f.navigations[0],"importer.html?boot=1");assert.equal(f.context.ACEDLibrary.getDraft().text,raw);
    for(const n of [60000,60001]){
      const h=home(read);h.context.ACEDLibrary.stashDraft=()=>false;h.context.ACEDLibrary.isPersistent=()=>false;h.ensure("bootNotes").value="x: one\n"+" ".repeat(n-7);assert.equal(h.ensure("bootNotes").value.length,n);
      await h.ensure("bootGo").fire("click");assert.equal(h.navigations.length,n===60000?1:0);
    }
    for(const size of [200000,200001]){
      const h=home(read),L=h.context.ACEDLibrary;h.ensure("bootNotes").value=pairText;L.stashDraft=()=>false;L.isPersistent=()=>false;L.encode=()=>"a".repeat(size);L.decode=()=>pairText;
      await h.ensure("bootGo").fire("click");assert.equal(h.navigations.length,size===200000?1:0);
    }
  });
  await test("classic: contradictory or throwing readback holds, without legacy fallback",async()=>{
    for(const mode of ["missing","different","throws","read-blocked"]){
      const f=classic(read);await f.change(inputFile("fixture.txt",legacyPairText));await tick();await f.build();assert.ok(f.api.draft.length>0);const before=JSON.stringify(f.api.draft),L=f.context.ACEDLibrary;
      if(mode==="missing")L.get=()=>null;
      if(mode==="different")L.get=id=>({id,questions:[],name:"Synthetic"});
      if(mode==="throws")L.get=()=>{throw Error("synthetic");};
      if(mode==="read-blocked"){const get=L.get;L.get=id=>{const p=get(id);L.isPersistent=()=>false;return p;};}
      await f.ensure("playNow").fire("click");assert.equal(f.navigations.length,0);assert.equal(JSON.stringify(f.api.draft),before);assert.equal(f.memory.has("aced:local:customPack"),false);
    }
  });
  await test("classic: actual preview edit, selected answer, delete and held-source recovery",async()=>{
    const f=classic(read);await f.change(inputFile("fixture.txt",pairText));await tick();await f.build();
    const first=f.ensure("qlist").children[0].fixture;first.stem.value="Edited synthetic question";await first.stem.fire("input");first.choices[0].value="Edited synthetic choice";await first.choices[0].fire("input");await first.radios[1].fire("change");
    assert.equal(f.api.draft[0].q,"Edited synthetic question");assert.equal(f.api.draft[0].choices[0],"Edited synthetic choice");assert.equal(f.api.draft[0].answer,1);
    const before=f.api.draft.length;await f.ensure("qlist").children.at(-1).fixture.del.fire("click");assert.equal(f.api.draft.length,before-1);
    f.context.ACEDLibrary.isPersistent=()=>false;await f.ensure("playNow").fire("click");assert.equal(f.navigations.length,0);assert.equal(f.ensure("pasteBox").value,pairText);assert.equal(f.api.draft[0].answer,1);
  });
  await test("classic: malformed PDF item/width/rotation rejects actual extraction without partial Build",async()=>{
    for(const bad of [{...item("first",50),width:NaN},{...item("first",50),width:-1},{...item("first",50),transform:[1,0,0.01,1,50,700]},{...item("first",50),str:17},null]){
      const f=classic(read);f.pdf([[item("alpha:"),bad]]);await f.change(inputFile("fixture.pdf",""));await tick();assert.equal(f.ensure("uBuild").disabled,true);assert.equal(f.api.draft.length,0);assert.match(f.ensure("uStatus").textContent,/could not be read/);
    }
  });
  await test("classic: paired emphasis, bullets, all language prefixes and clock pairs",()=>{
    const E=classic(read).context.ACEDExtract;
    for(const lang of ["spanish","french","german","italian","portuguese","japanese","chinese","mandarin","korean","latin","arabic","russian","hindi","vocab","vocabulary"]){
      const defs=E._parseDefinitions(lang.toUpperCase()+": uno / one\n- **dos**: two");assert.equal(defs.length,2);assert.equal(defs[0].term,"uno");assert.equal(defs[1].term,"dos");
    }
    assert.equal(E._parseDefinitions("12:30 PM :: 1:00 AM").length,0);
    assert.equal(E._parseDefinitions("Office hours :: 12:30 PM").length,1);
    assert.equal(E._parseDefinitions("unspaced/words").length,0);
  });
  await test("capture: unmarked controls, status ownership, source/endpoint edits and focus",async()=>{
    const f=dom(),a=f.form(),b=f.form(),unmarked=f.node("","FORM"),d=deferred();unmarked.appendChild(f.node("","INPUT"));
    f.context.fetch=()=>d.promise;f.evaluate(read("notify.js"));assert.equal(unmarked.hasAttribute("data-aced-notify-form"),false);assert.notEqual(a.note.id,b.note.id);
    a.input.focus();await a.form.fire("submit");assert.equal(f.document.activeElement,a.input);a.form.setAttribute("data-source","mcat");
    d.resolve({ok:true,status:200,json:()=>f.json({ok:true})});await tick();assert.equal(f.events.length,0);assert.match(a.note.textContent,/earlier submission/);assert.equal(a.note.getAttribute("aria-atomic"),"true");
  });
  await test("copy: owned visible paragraphs and JSON-LD are separate evidence",()=>{
    const contracts=[
      ["index.html","supported-input","Use Term: definition lines or Q:/A: blocks, then review the questions before play. Arbitrary articles, links and prose are not automatically turned into a deck."],
      ["index.html","sample-purpose","Try the game with the World Capitals sample pack. No upload is needed."],
      ["index.html","optional-practice","Play poker hands to clear score targets. Between rounds, optional question practice lets you choose LOW, MED or HIGH confidence. You can win the casual game without answering questions."],
      ["index.html","processing-disclosure","Pasted text and original PDF/Word files are processed in your browser. Supported structured material becomes study questions for you to review; ACED does not automatically understand arbitrary documents or fetch study links."],
      ["index.html","sync-disclosure","If you sign in and sync, study progress can include question, topic or source labels and other text-bearing study data. Optional launch updates send your email to the configured service. Older versions may already have retained email copies locally or in synced snapshots."],
      ["index.html","deletion-disclosure","Deleting a pack removes that pack’s data in this browser. It does not clear every draft, earlier email copy, other device or cloud snapshot. Keep an export if you need a backup."],
      ["index.html","capture-disclosure","An accepted request confirms registration with the service, not email delivery, a new subscription or updates for a particular pack. No launch date is promised."],
      ["importer-classic.html","classic-review","Review every question and answer. Only supported structured material is converted; other prose may be left out. Automatically assembled choices are not a test of free recall. You can inspect the extracted text through Back → Paste."],
      ["importer.html","review-description","Check every answer before play. Optional question practice uses multiple-choice answers. Where choices were not authored, options can be assembled from other answers; this is not a test of free recall."]
    ];
    function paragraph(html,id,text){
      const start=html.indexOf('id="'+id+'"');assert.ok(start>=0&&html.indexOf('id="'+id+'"',start+1)<0,"unique visible owner");
      const tagStart=html.lastIndexOf("<",start),content=html.indexOf(">",start)+1,end=html.indexOf("</p>",content);
      assert.ok(/^<p(?:\s|>)/.test(html.slice(tagStart)));assert.equal(html.slice(content,end),text);
    }
    for(const [name,id,text] of contracts){
      const html=read(name);paragraph(html,id,text);
      const start=html.lastIndexOf("<p",html.indexOf('id="'+id+'"')),end=html.indexOf("</p>",start)+4;
      assert.throws(()=>paragraph(html.slice(0,start)+html.slice(end),id,text));
    }
    const data=scripts(read("index.html")).filter(s=>s.tag.includes('type="application/ld+json"')).map(s=>JSON.parse(s.code));
    const faq=data.find(s=>s["@type"]==="FAQPage");assert.ok(faq&&faq.mainEntity.length>=5);
    for(const [,id,text] of contracts.filter(c=>["supported-input","optional-practice","processing-disclosure","sync-disclosure","deletion-disclosure"].includes(c[1])))
      assert.ok(faq.mainEntity.some(q=>q.acceptedAnswer.text===text),id);
    assert.ok(read("index.html").includes('href="study.html?pack=world-capitals"'));
    function literalButton(html){
      const open='<button type="submit">',start=html.indexOf(open);assert.ok(start>=0);const end=html.indexOf("</button>",start),text=html.slice(start+open.length,end);
      assert.ok(!/[<>]/.test(text)&&!/[\r\n]/.test(text));assert.equal(text,"NOTIFY ME");return text;
    }
    literalButton(read("index.html"));
    for(const body of ["<span>NOTIFY ME</span>","${dynamic}","NOTIFY ME<script>","<b>NOTIFY</b> ME"])
      assert.throws(()=>literalButton('<button type="submit">'+body+"</button>"));
  });
  for(const end of ["</script>","</script >","</script/>","</ScRiPt x=1>","</script\n>"]){
    await test("source selector: real delimiter "+JSON.stringify(end),()=>assert.equal(uniqueScript("<script>const marker=1;"+end,"marker"),"const marker=1;"));
  }
  await test("source selector: custom lookalikes do not satisfy ownership",()=>assert.throws(()=>uniqueScript("<script-widget>const marker=1;</script>","marker")));
  return {passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,results};
}
module.exports={run,dom,classic,modern,home,scripts,uniqueScript,disk,tick,deferred,item,inputFile};
if(require.main===module) run().then(r=>{for(const t of r.results)console.log((t.ok?"PASS ":"FAIL ")+t.name);console.log("product-success-s1: "+r.passed+" passed, "+r.failed+" failed.");if(r.failed)process.exitCode=1;},()=>{console.error("product-success-s1: rejected aggregate");process.exitCode=1;});
