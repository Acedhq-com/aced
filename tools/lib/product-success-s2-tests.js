"use strict";
const assert=require("node:assert/strict"),vm=require("node:vm");
const {createRuntime}=require("./runtime-fixture");
const {dom,uniqueScript,disk,tick}=require("./product-success-s1-tests");
const questions=n=>Array.from({length:n},(_,i)=>({id:"synthetic-"+i,q:"Synthetic "+i,choices:["One","Two"],answer:0,source:i%2?"A.two":"A.one",explain:"Synthetic explanation"}));
function runtime(options={}){
  const n=options.n??6,id="success-fixture";
  return createRuntime({id,read:options.read,initial:options.initial,now:1700000000000,
    raw:{id,name:"Synthetic pack",questions:questions(n)},
    configurePack(p,c){if(options.weights!==undefined)p.blueprintWeights=vm.runInContext(options.weights,c);if(options.setup)options.setup(p,c);},
    configureContext:options.configureContext
  });
}
function canvas(f){
  const texts=[],downloads=[],original=f.document.createElement;
  const drawing={fillText(t){texts.push(String(t));},measureText(t){return{width:String(t).length*10};},
    createLinearGradient(){return{addColorStop(){}};},createRadialGradient(){return{addColorStop(){}};}};
  for(const name of ["fillRect","strokeRect","beginPath","moveTo","lineTo","stroke","arc","fill","save","restore"])drawing[name]=()=>{};
  f.document.createElement=function(tag){const n=original(tag);if(tag==="canvas"){n.getContext=()=>drawing;n.toDataURL=()=>"data:image/png;base64,synthetic";}if(tag==="a")n.click=()=>downloads.push({href:n.href,name:n.download});return n;};
  return {texts,downloads};
}
function daily(options={}){
  const read=options.read||disk,f=dom(),scripts=[],domReady=[],events=[],rewards=[],banks=[];
  for(const id of ["app","toast","callout","startBtn","howBtn","muteBtn","backBtn","lockBtn","nextBtn","shareBtn","cardBtn","reviewBtn","runFull","playToday","rPrev","rNext","scoreVal","cd"])f.ensure(id);
  f.context.setInterval=()=>1;f.context.clearInterval=()=>{};f.context.innerWidth=390;f.context.innerHeight=844;
  f.context.Date=class extends Date{constructor(...a){super(...(a.length?a:["2026-11-07T12:00:00Z"]));}static now(){return new Date("2026-11-07T12:00:00Z").getTime();}};
  f.context.addEventListener=(type,fn)=>{if(type==="DOMContentLoaded")domReady.push(fn);};
  f.document.head.appendChild=s=>{scripts.push(s);};
  f.context.ACEDCore={analytics:{track(...a){events.push(a);}},sync:{push(){events.push(["push"]);},pull(){}}};
  f.context.ACEDProgress={event(...a){rewards.push(["xp",...a]);return null;}};
  f.context.ACEDVault={event(...a){rewards.push(["vault",...a]);}};
  const shell=f.node();shell.insertAdjacentHTML=(_where,html)=>{shell.innerHTML+=html;};
  f.ensure("app").querySelector=selector=>selector===".card-shell"?shell:null;
  f.context.ACEDLibrary={lastPack:()=>"world-capitals",starter:id=>options.starter?{id}:null,get:()=>options.local?{id:options.id||"world-capitals",name:"Private synthetic name",questions:questions(7)}:null};
  f.context.ACEDBridge={toEngineQuestions:p=>p.questions};
  f.context.location.search="?pack="+(options.id||"world-capitals")+(options.search||"");
  const captures=canvas(f),html=read("daily.html");
  let engine=uniqueScript(html,"window._dailyReady=function");
  const marker="}; // ===== end _dailyReady =====";assert.equal(engine.split(marker).length,2);
  engine=engine.replace(marker,`globalThis.__daily={shareString,shareText,shareCard,makeCardDataURL,pointsFor,brier,pickDaily,mirrorMasteryToGame,startRun,finishRun,get qs(){return QS;},get state(){return D;},get run(){return run;},get target(){return TARGET_KEY;}};\n`+marker);
  f.evaluate(engine,"daily:actual-engine");
  // In the baseline this loader is a separate script. A private combined
  // source may run it during engine evaluation; never execute a loader twice.
  if(!engine.includes("(function loadPack()"))f.evaluate(uniqueScript(html,"(function loadPack()"),"daily:actual-loader");
  if(options.direct){f.context.ACED_PACK={id:"unproven",name:"Private synthetic name",questions:questions(7)};f.context._dailyReady();}
  else if(options.local&&!options.starter)domReady.forEach(fn=>fn());
  else{
    const packScript=scripts.shift();assert.ok(packScript&&packScript.src==="packs/"+(options.id||"world-capitals")+".js");
    f.context.ACED_PACK={id:options.mismatch?"other":options.id||"world-capitals",name:"Public synthetic pack",questions:questions(7),scripts:options.banks||[]};
    packScript.onload();f.beforeBanksBooted=!!f.context._DAILY_BOOTED;
    while(scripts.length){const s=scripts.shift();banks.push(s.src);if(options.swapAtBank)f.context.ACED_PACK={id:"other",name:"Private synthetic name",questions:questions(7)};if(options.bankError)s.onerror();else s.onload();}
  }
  f.api=f.context.__daily;assert.ok(f.api,"actual accepted loader must boot Daily");
  return {...f,...captures,scripts,events,rewards,banks,shell};
}
const rec={score:500,correct:3,total:7,glyphs:["g","y","r","k","g","y","k"],calib:60,perfect:false,close:676,timeSec:1};
async function run(options={}){
  const read=options.read||disk,results=[];
  async function test(name,fn){try{await fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,kind:e.name,frame:String(e.stack).split("\n").find(s=>s.includes("product-success-s2-tests.js:"))||""});}}
  await test("copy: actual initial modal makes the quiz optional and retains full casual access",()=>{
    const f=runtime({read}),marker='<p class="help">Clear a ',parts=f.modal().split(marker);
    assert.equal(parts.length,2,"the actual initial help paragraph must be unique");
    const copy=parts[1].split("</p>")[0];
    assert.ok(copy.includes('>optional Pop Quiz</b>'));
    assert.ok(copy.includes("Full casual-game access remains available without answering questions."));
    assert.equal(f.requests.length,0);
  });
  await test("copy: actual rules scope Weakness Cards to HIGH misses and match genuine outcomes",()=>{
    const f=runtime({read}),marker='<div class="rt">POP QUIZ</div><div class="rd">',parts=f.api.rulesCardHTML().split(marker);
    assert.equal(parts.length,2,"the actual quiz rule must be unique");
    const copy=parts[1].split("</div>")[0];
    assert.ok(copy.includes("Only HIGH-confidence misses can add a Weakness Card."));
    assert.ok(!copy.includes("misses add a Weakness Card."));
    for(const tier of ["LOW","MED","HIGH"]){
      const r=runtime({read});r.api.start();const before=r.api.G.masterDeck.filter(c=>c.weakness).length;
      const [choice]=r.choices("[data-ach]",[{ach:"1"}]),[confidence]=r.choices("[data-conf]",[{conf:tier}]);
      r.api.beginAuditQuestion("A.one",r.api.qbank[0],10,true);choice.onclick();confidence.onclick();r.document.getElementById("auditSubmit").onclick();
      assert.equal(r.api.G.masterDeck.filter(c=>c.weakness).length-before,tier==="HIGH"?1:0);
      assert.equal(r.api.calibData().n,1);assert.equal(r.api.calibData().k,0);assert.equal(r.requests.length,0);
    }
  });
  await test("copy: actual guided WELCOME separates optional answers from game progress and recall",()=>{
    const timers=[],f=runtime({read,configureContext(c){c.setTimeout=(fn,delay)=>{timers.push({fn,delay});return timers.length;};}});
    f.api.start();f.document.getElementById("helpBtn").onclick();
    const first=timers.length;f.document.getElementById("replayTut").onclick();
    const scheduled=timers.slice(first).filter(t=>t.delay===80);assert.equal(scheduled.length,1);scheduled[0].fn();
    assert.equal(f.document.getElementById("tutTitle").textContent,"WELCOME TO ACED");
    const copy=f.document.getElementById("tutBody").innerHTML;
    assert.ok(copy.includes("Questions are optional."));
    assert.ok(copy.includes("Game progress is not a measure of recall or a prediction of test performance."));
    assert.ok(!copy.includes("tracks how well you actually know it"));
    assert.equal(f.requests.length,0);
  });
  await test("phone source contract: scoped compact groups retain controls, growing content and card order",()=>{
    const html=read("study.html"),parts=html.split('<style id="aced-product-success-layout">');
    assert.equal(parts.length,2);const style=parts[1].split("</style>")[0];
    assert.ok(style.includes(".topbar .tbtns{display:grid;grid-template-columns:repeat(6,minmax(0,1fr))"));
    assert.ok(style.includes('grid-template-areas:"blind blind score score score" "blind blind handline handline handline" "blind blind readout readout readout" "counters counters counters counters info"'));
    assert.ok(style.includes(".readiness .progress-scope[open]{grid-column:1/-1;grid-row:2}"));
    assert.ok(style.includes("grid-template-columns:repeat(4,minmax(0,1fr))"));
    assert.ok(style.includes("grid-template-columns:repeat(3,minmax(0,1fr))"));
    for(const forbidden of ["overflow:hidden","overflow-x:hidden","height:100vh","zoom:","scale(",".jk{",".ci{",".jokers{",".cons{"])assert.ok(!style.includes(forbidden));
    assert.doesNotMatch(style,/(?:^|[;{])\s*order\s*:/);
    for(const id of ["dailyLink","reviewBtn","tbsBtn","handsBtn","helpBtn","deckBtn","codexBtn","notesBtn","mute","endRunBtn","jokerRail","consRail","runInfoBtn","play","discard","sortCat","sortVal"]){
      assert.equal(html.split('id="'+id+'"').length,2,"existing owned control must remain unique");
    }
    // This checks the owned source contract, not browser rectangles or CSS layout.
  });
  await test("accessibility source: finite owned labels and active actions have contrasting palettes",()=>{
    const html=read("study.html"),parts=html.split('<style id="aced-product-success-layout">');assert.equal(parts.length,2);const style=parts[1].split("</style>")[0];
    function rule(selector){const p=style.split("\n"+selector+"{");assert.equal(p.length,2);return p[1].split("}")[0];}
    function color(body){const m=body.match(/(?:^|;)color:(#[0-9a-f]{6})(?:!important)?(?:;|$)/i);assert.ok(m);return m[1];}
    function luminance(hex){const v=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];}
    function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
    const labels=rule(".topbar #deckBtn,.topbar #notesBtn,.topbar #acctBtn,.topbar #mute,.sidebar .blind .bk,.sidebar .rscore .rsk,.sidebar .handline .ht,.sidebar .ctk,#hand .card .modk,.playarea #phLabel,.playarea .ph,.actions .sortlbl");
    assert.equal(color(labels),"#d8f5d8");
    const backgrounds=["#040904","#06100a","#0a160a","#05100a"];for(const name of ["panel","panel2","felt1","felt2","felt3"]){const bg=html.match(new RegExp("--"+name+":(#[0-9a-f]{6});","i"))?.[1];assert.ok(bg);backgrounds.push(bg);}
    for(const bg of backgrounds){assert.ok(html.includes(bg));assert.ok(contrast(color(labels),bg)>=4.5);}
    const actions=rule(".sidebar #runInfoBtn,.actions #play,.actions #discard,#modal button.act.play,#modal button.act.disc");assert.ok(actions.includes("text-shadow:none!important"));
    for(const name of ["b-blue","b-red","red"]){const bg=html.match(new RegExp("--"+name+":(#[0-9a-f]{6});","i"))?.[1];assert.ok(bg);assert.ok(contrast(color(actions),bg)>=4.5);}
    // Known source palette arithmetic is not a computed-style/native contrast measurement.
  });
  await test("accessibility source: owned topic toggle and selected modal controls retain targets and focus",()=>{
    const html=read("study.html"),parts=html.split('<style id="aced-product-success-layout">');assert.equal(parts.length,2);const style=parts[1].split("</style>")[0];
    function rule(selector){const p=style.split("\n"+selector+"{");assert.equal(p.length,2);return p[1].split("}")[0];}
    const toggle=rule(".mastery #mToggle"),modal=rule("#modal button.act"),focus=rule(".mastery #mToggle:focus-visible,#modal button.act:focus-visible");
    for(const body of [toggle,modal]){assert.ok(body.includes("min-height:44px"));assert.ok(body.includes("min-width:44px"));assert.ok(body.includes("box-sizing:border-box"));}
    assert.ok(toggle.includes("color:#d8f5d8"));assert.ok(toggle.includes("font:14px/1.1 'VT323',monospace"));assert.ok(focus.includes("outline:3px solid #5cffea"));assert.ok(focus.includes("outline-offset:3px"));
    const f=runtime({read});f.api.start();const panel=f.document.getElementById("masteryPanel"),button=f.document.getElementById("mToggle");
    button.onclick();assert.equal(panel.classList.contains("collapsed"),true);assert.equal(button.textContent,"SHOW");
    button.onclick();assert.equal(panel.classList.contains("collapsed"),false);assert.equal(button.textContent,"HIDE");
    f.document.getElementById("helpBtn").onclick();assert.ok(f.modal().includes('id="replayTut"'));assert.ok(f.modal().includes('id="closeRules"'));assert.equal(f.document.getElementById("overlay").classList.contains("show"),true);
    f.document.getElementById("closeRules").onclick();assert.equal(f.document.getElementById("overlay").classList.contains("show"),false);assert.equal(f.requests.length,0);
    // Actual callbacks plus owned source minima do not assert browser hit rectangles.
  });
  await test("mechanics control: existing counters, arithmetic and Daily points remain genuine",()=>{
    const f=runtime({read,weights:"({A:1})"});f.api.start();
    assert.equal(f.api.readinessPct(),0);f.api.addMastery("A.one",1);assert.equal(f.api.masteryPct("A.one"),2);assert.equal(f.api.readinessPct(),1);
    f.api.addMastery("A.two",3);assert.equal(f.api.readinessPct(),4);
    const d=daily({read});assert.deepEqual(["LOW","MED","HIGH"].map(c=>d.api.pointsFor(true,c)),[100,150,250]);assert.deepEqual(["LOW","MED","HIGH"].map(c=>d.api.pointsFor(false,c)),[0,-40,-100]);assert.equal(d.api.brier(false,"HIGH"),.9025);
  });
  await test("aggregate: unweighted generic pack never fabricates zero knowledge",()=>{
    const f=runtime({read});f.api.start();f.api.renderReadiness();assert.equal(f.document.getElementById("rPct").textContent,"Aggregate not available for this pack.");
    assert.equal(f.document.getElementById("rFill").style.width,"");assert.equal(f.document.getElementById("gateMock").textContent,"PRACTICE QUESTIONS");
    f.api.studyReport();assert.ok(f.modal().includes("Aggregate not available for this pack."));assert.ok(!f.modal().includes("0%</span><span class=\"srbiglbl\">"));
  });
  await test("aggregate: real weighted zero and 60/90 retain arithmetic; missing coverage unavailable",()=>{
    for(const weights of ["({A:1})","({A:0})","({B:1})","({A:-1})","({A:NaN})","({})","null"]){
      const f=runtime({read,weights});f.api.start();f.api.renderReadiness();
      assert.equal(f.document.getElementById("rPct").textContent,weights==="({A:1})"?"0%":"Aggregate not available for this pack.");
      if(weights==="({A:1})"){f.api.addMastery("A.one",30);f.api.addMastery("A.two",30);assert.equal(f.api.readinessPct(),60);f.api.renderReadiness();assert.equal(f.document.getElementById("gateMock").textContent,"PRACTICE TEST");}
    }
  });
  await test("aggregate: own special area keys and Unicode labels retain arithmetic and escaped views",()=>{
    const source=["__proto__.日本<&","toString.β"];
    const f=createRuntime({read,id:"success-fixture",now:1700000000000,raw:{id:"success-fixture",name:"Synthetic",questions:questions(6).map((q,i)=>({...q,source:source[i%2]}))},
      configurePack(p,c){p.blueprintWeights=vm.runInContext(`JSON.parse('{"__proto__":1,"toString":1}')`,c);}});
    f.api.start();f.api.addMastery(source[0],10);assert.equal(f.api.readinessPct(),10);assert.equal(f.api.shareCardArgs().readiness,10);
    f.api.readinessReport();assert.ok(f.modal().includes("日本&lt;&amp;"));assert.ok(!f.modal().includes("日本<&"));assert.equal(f.requests.length,0);
  });
  await test("aggregate: accessors, inherited/custom/symbol weights do not execute hooks in any consumer",()=>{
    const cases=[
      'Object.defineProperty(ACED_PACK,"blueprintWeights",{get(){hooks++;return {A:1};}})',
      'ACED_PACK.blueprintWeights={get A(){hooks++;return 1;}}',
      'ACED_PACK.blueprintWeights=Object.create({A:1})',
      'ACED_PACK.blueprintWeights=Object.assign(Object.create({custom:true}),{A:1})',
      'ACED_PACK.blueprintWeights={A:1,[Symbol("unsupported")]:1}',
      'ACED_PACK.blueprintWeights={A:1,B:-1}'
    ];
    for(const source of cases){
      const f=runtime({read});f.api.start();f.context.hooks=0;f.evaluate(source);
      for(const consumer of [()=>f.api.renderReadiness(),()=>f.api.runInfoView(),()=>f.api.studyReport(),()=>f.api.readinessReport(),()=>f.api.shareCardArgs()])consumer();
      assert.equal(f.context.hooks,0);assert.equal(f.api.shareCardArgs().readiness,null);
      assert.equal(f.document.getElementById("progressBar").hidden,true);
    }
    const f=runtime({read,weights:"Object.assign(Object.create(null),{A:1,Extra:0})"});f.api.start();assert.equal(f.api.shareCardArgs().readiness,0);
  });
  await test("aggregate: run-end/confirm/help consumers and keyboard entry retain honest unknown scope",()=>{
    const f=runtime({read});f.api.start();const scope="Game progress is tracked separately from recorded question answers. Storage and sync may be unavailable; see recording details for submitted answers.";
    const before=JSON.stringify([...f.memory].filter(([k])=>/:(mastery|review|learning_v1|calib|unlocked)$/.test(k)));
    for(const view of [()=>f.api.win(true),()=>f.api.lose("Synthetic","Synthetic",true),()=>f.api.endRunSummary(true),()=>f.api.confirmEndRun()]){
      view();assert.ok(f.modal().includes(scope));assert.ok(!f.modal().includes("0% readiness"));assert.ok(!f.modal().includes("YOU KEPT EVERYTHING THAT MATTERS"));
    }
    assert.ok(f.api.rulesCardHTML().includes("not educational mastery"));
    const rt=f.document.getElementById("rTop");for(const key of ["Enter"," "]){let prevented=false;rt.onkeydown({key,preventDefault(){prevented=true;}});assert.ok(prevented);assert.ok(f.modal().includes("Aggregate not available for this pack."));}
    assert.equal(JSON.stringify([...f.memory].filter(([k])=>/:(mastery|review|learning_v1|calib|unlocked)$/.test(k))),before);
  });
  await test("confidence: missing evidence is neither zero accuracy nor calibrated",()=>{
    const f=runtime({read});f.api.start();const html=f.api.calibGridHTML();assert.ok(html.includes("No recorded confidence answers to display."));f.api.studyReport();assert.ok(!f.modal().includes("Calibrated and clean"));
  });
  await test("confidence: valid last-400 positions only, malformed omissions and genuine all-wrong zero",()=>{
    const f=runtime({read});f.api.start();
    f.evaluate('ACEDCore.store.set("calib",{samples:[{c:"HIGH",ok:1,b:0,m:"A.one"},...Array.from({length:399},()=>({c:"LOW",ok:0,b:.25,m:"A.two"})),{c:"HIGH",ok:"1",b:0}]})');
    const d=f.api.calibData();assert.equal(d.n,399);assert.equal(d.acc,0);assert.equal(d.pct,75);
    const html=f.api.calibGridHTML();assert.ok(html.includes("Recorded confidence answers: 399. Correct: 0/399 (0%)."));assert.ok(html.includes("Some stored entries could not be summarized."));assert.ok(html.includes("up to the latest 400 records"));
  });
  await test("confidence: unsupported module leaves global evidence; no field coercion",()=>{
    const f=runtime({read});f.api.start();f.evaluate('ACEDCore.store.set("calib",{samples:[{c:"MED",ok:1,b:.0625,m:null},{c:"HIGH",ok:0,b:.9025},{c:"LOW",ok:true,b:.25},{c:"LOW",ok:0,b:"0.25"}]})');
    const d=f.api.calibData();assert.equal(d.n,2);assert.equal(d.rows.length,0);assert.equal(d.acc,50);assert.equal(d.pct,52);
  });
  await test("confidence: accessor/corrupt arrays and record fields hold without hooks or historical repair",()=>{
    const f=runtime({read});f.api.start();f.context.hooks=0;
    for(const source of ['({get samples(){hooks++;return [];}})','({samples:null})','({samples:{}})',
      '({samples:[{get c(){hooks++;return "LOW";},ok:0,b:.25},{c:"LOW",get ok(){hooks++;return 1;},b:.25},{c:"LOW",ok:0,get b(){hooks++;return .25;}}]})']){
      const raw=f.evaluate(source),get=f.context.ACEDCore.store.get;f.context.ACEDCore.store.get=(key,...rest)=>key==="calib"?raw:get(key,...rest);
      const d=f.api.calibData();assert.equal(d.n,0);assert.equal(d.pct,null);assert.ok(f.api.calibGridHTML().includes("Some stored entries could not be summarized."));f.context.ACEDCore.store.get=get;
    }
    assert.equal(f.context.hooks,0);
    f.evaluate('ACEDCore.store.set("calib",{samples:[{c:"LOW",ok:0,b:1,m:"A.one"},{c:"MED",ok:0,b:1,m:"A.one"},{c:"HIGH",ok:0,b:1,m:"A.one"}]})');
    assert.equal(f.api.calibData().pct,0);assert.equal(f.api.calibData().n,3);f.api.renderCalibration();assert.ok(f.document.getElementById("calibPct").textContent.includes("0/3 (0%)"));assert.equal(f.api.shareCardArgs().calibCount,3);
  });
  await test("practice: valid pool threshold and owner/game access are consistent across HUD/report",()=>{
    for(const n of [4,5])for(const weighted of [false,true])for(const owns of [false,true]){
      const f=runtime({read,n,weights:weighted?"({A:1})":"({})"});f.api.start();f.api.owns=owns;f.api.renderReadiness();
      const text=f.document.getElementById("gateMock").textContent;
      assert.equal(text,n<5?"At least 5 valid questions are needed for practice.":!weighted?"PRACTICE QUESTIONS":owns?"PRACTICE TEST":"Practice unlocks at 60% game progress or through existing owned access.");
      f.api.readinessReport();assert.ok(f.modal().includes(text));
    }
  });
  await test("practice: malformed required/optional fields never reach shared runner",()=>{
    const f=runtime({read,n:5});f.api.start();f.context.hooks=0;f.api.qbank=f.evaluate('[{q:"Synthetic",choices:["One","Two"],answer:.5},{q:"Synthetic",choices:["One",,"Two"],answer:0},{get q(){hooks++;return "Synthetic";},choices:["One","Two"],answer:0},{q:"Synthetic",choices:["One","Two"],answer:0,get source(){hooks++;return "A.one";}},{q:"Synthetic",choices:["One","Two"],answer:0,explain:{}}]');
    f.api.renderReadiness();assert.equal(f.document.getElementById("gateMock").textContent,"At least 5 valid questions are needed for practice.");assert.equal(f.context.hooks,0);
  });
  await test("practice: optional inert fields, duplicates and owned strings stay unchanged; inherited fields hold",()=>{
    const f=runtime({read,n:5});f.api.start();f.context.hooks=0;
    const valid=questions(5);valid.forEach(q=>{q.q="  "+q.q+"  ";q.id="same";q.source=null;q.explain=undefined;});f.api.qbank=valid;
    const bytes=JSON.stringify(valid);f.api.renderReadiness();assert.equal(f.document.getElementById("gateMock").textContent,"PRACTICE QUESTIONS");assert.equal(JSON.stringify(valid),bytes);
    for(const source of ['Object.assign(Object.create({q:"Inherited"}),{choices:["One","Two"],answer:0})',
      'Object.assign(Object.create({source:"A.one"}),{q:"Synthetic",choices:["One","Two"],answer:0})',
      '({q:"Synthetic",choices:["One","Two"],get answer(){hooks++;return 0;}})',
      '({q:"Synthetic",choices:Object.assign(new Array(2),{0:"One"}),answer:0})']){
      f.api.qbank=valid.slice(0,4).concat(f.evaluate(source));f.api.renderReadiness();
      assert.equal(f.document.getElementById("gateMock").textContent,"At least 5 valid questions are needed for practice.");
    }
    assert.equal(f.context.hooks,0);
  });
  await test("practice: actual 59/60 and real paid-owner callbacks; same shared runner records only submitted answers",async()=>{
    const f=runtime({read,n:5,weights:"({A:1})"});f.api.start();f.api.mastery["A.one"]=29;f.api.mastery["A.two"]=30;f.api.renderReadiness();
    assert.equal(f.api.readinessPct(),59);assert.equal(f.document.getElementById("gateMock").disabled,true);
    f.api.mastery["A.one"]=30;f.api.renderReadiness();assert.equal(f.api.readinessPct(),60);assert.equal(f.document.getElementById("gateMock").disabled,false);
    const owned=runtime({read,n:5,weights:"({A:1})",configureContext(c){
      c.ACED_MONETIZATION={enabled:true,lockMock:true};c.ACED_API_URL="https://blocked.invalid";
      c.ACEDAccount={has:()=>Promise.resolve(true),isSignedIn:()=>true,email:()=>""};
    }});owned.api.start();await tick();owned.api.owns=true;owned.api.renderReadiness();
    let records=0,library=0;const original=owned.context.ACEDCore.review.record;
    owned.context.ACEDCore.review.record=(...a)=>{records++;return original(...a);};owned.context.ACEDLibraryRecord=()=>{library++;};
    const [choice]=owned.choices("[data-qc]",[{qc:"0"}]);owned.document.getElementById("gateMock").onclick();await tick();assert.equal(records,0);
    for(let i=0;i<5;i++){choice.onclick();owned.document.getElementById("qSubmit").onclick();owned.document.getElementById("qSubmit").onclick();assert.equal(records,i+1);owned.document.getElementById("qNext").onclick();}
    assert.equal(records,5);assert.equal(library,0);assert.ok(owned.modal().includes("This is your score on these practice questions, not a prediction of test performance."));
    assert.equal(owned.requests.length,0);assert.equal(owned.api.calibData().n,0);
  });
  await test("practice: ordinary valid pool retains shuffle/module round-robin and up-to20 cap",()=>{
    const marker="function runQuiz(opts){";
    const f=runtime({n:28,weights:"({A:1})",read(name){
      const source=read(name);if(name!=="study.html")return source;
      assert.equal(source.split(marker).length,2);return source.replace(marker,marker+"globalThis.__selectedPractice=opts;");
    }});f.api.start();f.api.owns=true;f.api.launchMockExam();
    const selected=f.context.__selectedPractice;assert.equal(selected.kind,"mock");assert.equal(selected.questions.length,20);
    assert.equal(new Set(selected.questions).size,20);for(let i=1;i<20;i++)assert.notEqual(selected.questions[i-1].source,selected.questions[i].source);
    assert.equal(f.requests.length,0);
  });
  await test("practice: real gate, delayed callback revalidation and denied paywall preserve recording boundary",async()=>{
    const f=runtime({read,n:6});f.api.start();await tick();
    let recorded=0;f.context.ACEDCore.review.record=()=>{recorded++;};
    f.api.launchMockExam();assert.ok(f.modal().includes("PRACTICE QUESTIONS"));assert.equal(recorded,0);
    let callback,calls=0;f.api.pay.gate=(label,locked,run)=>{calls++;assert.equal(label,"The Mock Test");callback=run;};
    f.api.launchMockExam();assert.equal(calls,1);f.api.qbank=f.api.qbank.slice(0,4);callback();assert.ok(f.document.getElementById("toast").textContent.includes("At least 5"));assert.equal(recorded,0);
    f.api.qbank=questions(6);f.api.launchMockExam();f.context.ACED_PACK={id:"other"};callback();assert.ok(f.document.getElementById("toast").textContent.includes("material changed"));assert.equal(recorded,0);
    const denied=runtime({read,configureContext(c){
      c.ACED_MONETIZATION={enabled:true,lockMock:true};c.ACED_API_URL="https://blocked.invalid";
      c.ACEDAccount={has:()=>Promise.resolve(false),isSignedIn:()=>false};
    }});denied.api.start();await tick();denied.api.launchMockExam();await tick();assert.ok(denied.modal().includes("SIGN IN TO UNLOCK"));assert.equal(denied.requests.length,0);
  });
  await test("views: no fabricated answers, game rewards, unlocks or canonical history writes",()=>{
    const f=runtime({read});f.api.start();
    const watched=()=>JSON.stringify([...f.memory].filter(([key])=>/:(mastery|review|learning_v1|calib|unlocked)$/.test(key)));
    const before=watched(),unlocked=JSON.stringify(f.api.unlocked),score=f.api.G.score,cash=f.api.G.money;
    for(let i=0;i<2;i++){f.api.renderReadiness();f.api.calibData();f.api.shareCardArgs();f.api.runInfoView();f.api.studyReport();f.api.readinessReport();}
    assert.equal(watched(),before);assert.equal(JSON.stringify(f.api.unlocked),unlocked);assert.equal(f.api.G.score,score);assert.equal(f.api.G.money,cash);assert.equal(f.requests.length,0);
  });
  await test("mechanics: actual card-only play and all-miss/mixed genuine answers retain deltas and evidence",async()=>{
    const cardOnly=runtime({read,weights:"({A:1})"});cardOnly.api.start();cardOnly.api.fastAnimations();cardOnly.api.G.target=1e9;
    const card=cardOnly.api.G.masterDeck.find(c=>c.moduleKey==="A.one");cardOnly.api.G.hand=[card];cardOnly.api.G.sel=new Set([card.id]);await cardOnly.api.play();
    assert.equal(cardOnly.api.mastery["A.one"],1);assert.equal(cardOnly.api.calibData().n,0);assert.ok(cardOnly.api.calibGridHTML().includes("No recorded confidence answers to display."));
    for(const correct of [[false,false,false],[true,false,true]]){
      const f=runtime({read,weights:"({A:1})"});f.api.start();const q=f.api.qbank[0];
      let reviews=0,library=0;const record=f.context.ACEDCore.review.record,bridge=f.context.ACEDLibraryRecord;
      f.context.ACEDCore.review.record=(...a)=>{reviews++;return record(...a);};f.context.ACEDLibraryRecord=(...a)=>{library++;return bridge(...a);};
      for(const ok of correct){
        const [choice]=f.choices("[data-ach]",[{ach:ok?"0":"1"}]),[confidence]=f.choices("[data-conf]",[{conf:"MED"}]);
        f.api.beginAuditQuestion("A.one",q,10,true);choice.onclick();confidence.onclick();f.document.getElementById("auditSubmit").onclick();
      }
      const good=correct.filter(Boolean).length;assert.equal(f.api.mastery["A.one"],good?17:3);assert.equal(f.api.G.money,4+good*12);
      assert.equal(reviews,3);assert.equal(library,3);assert.equal(f.api.calibData().n,3);assert.equal(f.api.calibData().k,good);assert.equal(f.api.calibData().acc,good?67:0);
      assert.equal(JSON.parse(f.memory.get("aced:success-fixture:learning_v1")).attempts,3);assert.equal(f.requests.length,0);
    }
  });
  await test("social: unavailable is UNRANKED with no percent or numeric progress bar",()=>{
    const f=dom(),c=canvas(f);f.evaluate(read("social.js"));
    for(const readiness of [undefined,null,NaN,"0"]){c.texts.length=0;f.context.ACEDSocial.generateShareCard({readiness,score:0});assert.ok(c.texts.includes("UNRANKED"));assert.ok(c.texts.includes("Game progress not available."));assert.ok(!c.texts.includes("%"));}
    c.texts.length=0;f.context.ACEDSocial.generateShareCard({readiness:0,score:0});assert.ok(c.texts.includes("GAME PROGRESS"));assert.ok(c.texts.includes("ROOKIE"));
  });
  await test("social/FX: own finite rounding and rank thresholds, absent and accessor controls",()=>{
    const f=dom(),c=canvas(f);f.evaluate(read("social.js"));f.context.hooks=0;
    for(const opts of [f.evaluate('({get readiness(){hooks++;return 0;}})'),f.evaluate('Object.create({readiness:0})')]){
      c.texts.length=0;f.context.ACEDSocial.generateShareCard(opts);assert.ok(c.texts.includes("UNRANKED"));
    }
    assert.equal(f.context.hooks,0);
    for(const [n,rank]of [[0,"ROOKIE"],[30,"APPRENTICE"],[50,"SCHOLAR"],[65,"ADEPT"],[80,"MASTER"],[90,"LEGEND"]])assert.equal(f.context.ACEDSocial.rankFor(n),rank);
    c.texts.length=0;f.context.ACEDSocial.generateShareCard({readiness:101.7});assert.ok(c.texts.includes("100"));
    f.context.matchMedia=()=>({matches:true,addEventListener(){}});f.context.requestAnimationFrame=()=>1;f.context.cancelAnimationFrame=()=>{};f.context.innerWidth=390;f.context.innerHeight=844;f.evaluate(read("aced-fx.js"));
    assert.ok(!f.context.ACEDFX.grid({}).includes("GAME PROGRESS"));assert.ok(f.context.ACEDFX.grid({readiness:null}).includes("Game progress not available."));assert.ok(f.context.ACEDFX.grid({readiness:2.5}).includes("GAME PROGRESS 3%"));
  });
  await test("banner: actual owner is idempotent, dismissal retains its sole key and no game side effects",async()=>{
    const f=dom(),button=f.node("","BUTTON"),create=f.document.createElement,get=f.document.getElementById;
    f.document.createElement=tag=>{const n=create(tag);n.querySelector=s=>s==="button"?button:null;return n;};
    f.document.getElementById=id=>id==="acedArcadeBanner"?f.document.body.children.find(n=>n.id===id)||null:get(id);
    f.document.body.removeChild=n=>{f.document.body.children=f.document.body.children.filter(x=>x!==n);n.parentNode=null;n.isConnected=false;};
    const html=read("study.html"),source=uniqueScript(html,"aced_library_banner_dismissed");
    f.evaluate(source);f.evaluate(source);assert.equal(f.document.body.children.length,1);
    const banner=f.document.body.children[0];assert.equal(banner.className,"aced-arcade-banner");assert.ok(banner.innerHTML.includes('aria-label="Dismiss Library suggestion"'));
    assert.equal(/position\s*:\s*(fixed|sticky|absolute)/.test(banner.style.cssText||""),false);
    const focused=f.node();focused.focus();await button.fire("click");assert.equal(f.document.body.children.length,0);assert.deepEqual(f.writes,["aced_library_banner_dismissed"]);assert.equal(f.document.activeElement,focused);
    f.evaluate(source);assert.equal(f.document.body.children.length,0);assert.equal(f.requests.length,0);
    const style=html.split('<style id="aced-product-success-layout">')[1]?.split("</style>")[0];assert.ok(style);assert.ok(style.includes("grid-template-columns:repeat(4,minmax(0,1fr))"));assert.ok(style.includes("grid-template-columns:repeat(3,minmax(0,1fr))"));
    assert.match(style,/\.aced-arcade-banner button\{[^}]*min-width:44px;min-height:44px/);
  });
  for(const mode of ["local","direct"]){
    await test("Daily "+mode+": actual branch shares only a personal result",()=>{
      const f=daily({read,[mode]:true,id:"public-looking",search:"&date=2026-11-07&s=2&private=synthetic#secret"}),text=f.api.shareString(rec);
      assert.ok(text.includes("ACED Daily result"));assert.ok(text.includes("Personal practice result. This does not identify or link to the question set."));assert.ok(text.includes("https://acedhq.com/library.html"));
      assert.ok(!text.includes("Private synthetic name")&&!text.includes("public-looking")&&!text.includes("private="));f.api.makeCardDataURL(rec);assert.ok(!f.texts.join(" ").includes("Private synthetic name"));
    });
  }
  await test("Daily public: actual hosted starter branch, pack-aware clean bounded URL",()=>{
    const f=daily({read,starter:true,local:true,id:"world-capitals",search:"&date=2026-11-07&extra=synthetic#fragment"}),text=f.api.shareString(rec);
    const urls=text.split("\n").filter(s=>s.startsWith("https://"));assert.equal(urls.length,1);const url=new URL(urls[0]);assert.equal(url.origin,"https://acedhq.com");assert.equal(url.pathname,"/daily.html");assert.deepEqual([...url.searchParams.keys()],["pack","date","s"]);assert.equal(url.searchParams.get("pack"),"world-capitals");assert.equal(url.hash,"");assert.ok(text.includes("Material can change"));
  });
  await test("Daily unknown: mismatched loaded identity cannot acquire public provenance",()=>{
    const f=daily({read,mismatch:true});assert.ok(f.api.shareString(rec).includes("Personal practice result."));assert.ok(!f.api.shareString(rec).includes("Public synthetic pack"));
  });
  await test("Daily public: actual bank completion, immutable first provenance, invalid optional URL data",()=>{
    const f=daily({read,banks:["synthetic-one.js","synthetic-two.js"],bankError:true,search:"&date=2026-02-30"});
    assert.equal(f.beforeBanksBooted,false);assert.deepEqual(f.banks,["synthetic-one.js","synthetic-two.js"]);
    const url=new URL(f.api.shareString({...rec,score:10000000}).split("\n").at(-1));assert.equal(url.searchParams.has("date"),false);assert.equal(url.searchParams.has("s"),false);
    f.context.ACED_PACK={id:"private-changed",name:"Private synthetic name"};f.context._dailyReady();assert.ok(f.api.shareString(rec).includes("pack=world-capitals"));
    const unknown=daily({read,banks:["synthetic-bank.js"],swapAtBank:true});assert.ok(unknown.api.shareString(rec).includes("Personal practice result."));
  });
  await test("Daily public: nondefault actual source slug, bounded 0/max result and no extras",()=>{
    for(const id of ["spanish-1k","cpa-far"]){
      const f=daily({read,id,search:"&date=2026-11-07&account=synthetic#secret"});
      for(const score of [0,9999999]){const url=new URL(f.api.shareString({...rec,score}).split("\n").at(-1));assert.equal(url.searchParams.get("pack"),id);assert.equal(url.searchParams.get("s"),String(score));assert.deepEqual([...url.searchParams.keys()],["pack","date","s"]);assert.equal(url.hash,"");}
      f.api.makeCardDataURL(rec);assert.ok(f.texts.some(t=>t.includes("pack="+id)));assert.ok(!f.texts.join(" ").includes("account="));
    }
  });
  await test("Daily private: native cancel, clipboard, manual fallback and PNG all use one sanitized payload",async()=>{
    const f=daily({read,local:true,id:"private-synthetic"}),native=[],copied=[];
    f.context.navigator.share=async payload=>{native.push(payload);throw Error("synthetic cancel");};
    f.context.navigator.clipboard={writeText:async text=>{copied.push(text);}};
    const before=[...f.memory];await f.api.shareText(rec);assert.equal(native.length,1);assert.equal(copied[0],native[0].text);assert.equal(native[0].title,"ACED Daily result");
    f.context.navigator.clipboard.writeText=async()=>{throw Error("synthetic unavailable");};await f.api.shareText(rec);assert.ok(f.shell.innerHTML.includes("Personal practice result."));assert.ok(!f.shell.innerHTML.includes("private-synthetic"));
    f.api.shareCard(rec);assert.equal(f.downloads.length,1);assert.equal(f.downloads[0].name,"aced-run-676.png");
    assert.ok(f.texts.includes("ACED Daily result"));assert.ok(f.texts.includes("https://acedhq.com/library.html"));assert.deepEqual([...f.memory],before);
  });
  await test("Daily mechanics: first completion and replay keep score, module increments, XP and vault policy",()=>{
    const f=daily({read});f.api.startRun();f.api.run.picks.forEach((p,i)=>{p.sel=f.api.qs[i].answer;p.conf="HIGH";p.locked=true;});f.api.finishRun();
    const first=f.api.state.results[f.api.target];assert.equal(first.score,1950);assert.equal(first.correct,7);assert.equal(first.total,7);assert.equal(first.calib,100);assert.equal(f.api.state.currentStreak,1);
    const masteryKey="aced:world-capitals:mastery";assert.equal(Object.values(JSON.parse(f.memory.get(masteryKey))).reduce((a,b)=>a+b,0),14);
    assert.equal(f.rewards.filter(r=>r[0]==="xp").length,1);assert.equal(f.rewards.filter(r=>r[0]==="vault").length,1);
    f.api.startRun();f.api.run.picks.forEach((p,i)=>{p.sel=f.api.qs[i].answer;p.conf="HIGH";p.locked=true;});f.api.finishRun();
    assert.equal(Object.values(JSON.parse(f.memory.get(masteryKey))).reduce((a,b)=>a+b,0),28);assert.equal(f.api.state.currentStreak,1);assert.equal(f.rewards.length,2);
    const state=JSON.stringify(f.api.state),keys=[...f.memory];f.api.shareString(rec);f.api.makeCardDataURL(rec);assert.equal(JSON.stringify(f.api.state),state);assert.deepEqual([...f.memory],keys);
  });
  await test("Daily mechanics: genuine all-miss/mixed outcomes retain zero/score, increments and reward thresholds",()=>{
    for(const good of [0,4,5]){
      const f=daily({read});f.api.startRun();f.api.run.picks.forEach((p,i)=>{p.sel=i<good?f.api.qs[i].answer:1-f.api.qs[i].answer;p.conf=good?"MED":"HIGH";p.locked=true;});f.api.finishRun();
      const result=f.api.state.results[f.api.target];assert.equal(result.correct,good);assert.equal(result.score,good===0?0:good===4?480:670);
      assert.equal(Object.values(JSON.parse(f.memory.get("aced:world-capitals:mastery"))).reduce((a,b)=>a+b,0),7+good);
      assert.equal(f.rewards.filter(r=>r[0]==="xp").length,1);assert.equal(f.rewards.filter(r=>r[0]==="vault").length,good>=5?1:0);
    }
  });
  return {passed:results.filter(t=>t.ok).length,failed:results.filter(t=>!t.ok).length,results};
}
module.exports={run,runtime,daily,canvas,questions,rec};
if(require.main===module)run().then(r=>{for(const t of r.results)console.log((t.ok?"PASS ":"FAIL ")+t.name);console.log("product-success-s2: "+r.passed+" passed, "+r.failed+" failed.");if(r.failed)process.exitCode=1;},()=>{console.error("product-success-s2: rejected aggregate");process.exitCode=1;});
