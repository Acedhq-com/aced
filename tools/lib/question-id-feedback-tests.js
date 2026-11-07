"use strict";
// Actual study handlers and scoring, synthetic memory/DOM only. No network,
// credential environment, copied scorer, or fixture values in diagnostics.
const assert = require("node:assert/strict");
const { createRuntime } = require("./runtime-fixture");
const key = "aced:runtime-fixture:missedEver";
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const outcomes=[
  [{outcome:"recorded",persistence:"durable",reason:"complete"},"recorded in this browser."],
  [{outcome:"partial",persistence:"durable",reason:"historical-fields-unknown"},"current progress update accepted in this browser; some historical fields or totals remain unknown."],
  [{outcome:"recorded",persistence:"memory",reason:"storage-unavailable"},"recorded for this page session only, not saved to browser storage."],
  [{outcome:"partial",persistence:"memory",reason:"historical-fields-unknown"},"current progress update accepted for this page session only; some historical fields or totals remain unknown. Not saved to browser storage."],
  [{outcome:"held",persistence:"none",reason:"historical-state-held"},"this update was not recorded; existing history was left unchanged."],
  [{outcome:"no-question",persistence:"none",reason:"no-question"},"this answer was not recorded."],
  [undefined,"recording could not be confirmed."]
];
const scopeNote="Recording status describes these answer updates, not all game progress or cloud sync.";
function check(v, message="bounded condition failed") { if(!v)throw Error(message); }
function eq(a,b) { try {assert.deepStrictEqual(a,b);}catch(_){throw Error("bounded structure mismatch");} }
function fixture(id="ordinary", options={}) {
  const f=createRuntime({...options, raw:{id:"runtime-fixture",name:"Synthetic",
    questions:[{id:["constructor","__proto__","識別"].includes(id)?"legacy-control":id,
      q:"Synthetic",choices:["Synthetic A","Synthetic B"],answer:0,source:"Fixture",explain:"Synthetic"}]}});
  if(["constructor","__proto__","識別"].includes(id)) {
    // Explicit targeted legacy engine setup, NOT an accepted library import.
    f.api.qbank=[{...f.api.qbank[0],id}];
    f.context.ACEDLibraryRecord=undefined;
  }
  eq(f.api.qbank[0].id,id);
  check(f.api.store && f.context.ACED_PACK.id==="runtime-fixture");
  eq(new URLSearchParams(f.context.location.search).get("pack"),"runtime-fixture");
  f.api.start();
  return f;
}
function answer(f,ok=true,confidence="MED") {
  const [choice]=f.choices("[data-ach]",[{ach:ok?"0":"1"}]);
  const [conf]=f.choices("[data-conf]",[{conf:confidence}]);
  f.api.beginAuditQuestion("Fixture",f.api.qbank[0],10,true);
  choice.onclick();conf.onclick();f.document.getElementById("auditSubmit").onclick();
  check(f.requests.length===0); // Existing analytics diagnostics are captured, never printed.
}
function accountFixture(options={}) {
  const session={signed:true,token:"synthetic-session"};
  const f=fixture("ordinary",{...options,configureContext(c){
    c.ACED_API_URL="https://api.example.test";
    c.ACEDAccount={
      isSignedIn:()=>session.signed,signInPending:()=>false,signInNotice:()=>null,
      syncHeld:()=>false,token:()=>session.token,email:()=>"synthetic@example.test",
      ready:()=>Promise.resolve(),signOut:()=>{session.signed=false;session.token=null;return Promise.resolve();},
      signOutEverywhere:()=>{session.signed=false;session.token=null;return Promise.resolve();}
    };
  }});
  f.context.ACEDCore.backend.configure({endpoint:"https://api.example.test",token:session.token});
  return Object.assign(f,{session});
}
async function flush(){for(let i=0;i<80;i++)await Promise.resolve();}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function register(test) {
  const run=(name,fn)=>test(name,async()=>{
    try {await fn();}catch(e){
      const sites=String(e.stack||"").match(/question-id-feedback-tests\.js:\d+:\d+/g)||[];
      throw Error(name+": bounded invariant failed at "+sites.join(","));
    }
  });
  run("FB-T01 fresh and genuine durable audit cycles preserve exact engine IDs",()=>{
    let ordinaryEffects;
    for(const id of ["ordinary","toString","hasOwnProperty","constructor","__proto__","識別"]) {
      const f=fixture(id), prototype=f.evaluate("Object.getOwnPropertyNames(Object.prototype).join('|')");
      const interactions=[];
      const observeNemesis=e=>{e.context.ACEDNemesis={onAudit(module,correct){interactions.push([module,correct]);return null;}};};
      observeNemesis(f);
      const effects=()=>[f.api.mastery.Fixture,f.api.G.money,f.api.G.insight,f.api.G.conviction.Fixture,f.api.G.score];
      const stages=[];
      answer(f);stages.push(effects());answer(f);stages.push(effects());eq(f.api.G._redeemedCount,0);check(!f.memory.has(key));
      answer(f,false);const m=JSON.parse(f.memory.get(key));check(own(m,id));eq(m[id],1);
      stages.push(effects());
      if(!ordinaryEffects)ordinaryEffects=stages;else eq(stages,ordinaryEffects);
      const reloaded=fixture(id,{initial:Object.fromEntries(f.memory)});
      observeNemesis(reloaded);
      answer(reloaded);eq(reloaded.api.G._redeemedCount,1);
      check(!own(JSON.parse(reloaded.memory.get(key)),id));
      answer(reloaded);eq(reloaded.api.G._redeemedCount,1);
      answer(reloaded,false);answer(reloaded);eq(reloaded.api.G._redeemedCount,2);
      eq(JSON.parse(reloaded.memory.get("aced:runtime-fixture:review"))[id].seen,7);
      if(["ordinary","toString","hasOwnProperty"].includes(id))
        eq(JSON.parse(reloaded.memory.get("aced:runtime-fixture:learning_v1")).answers[id].attempts,7);
      eq(interactions,[["Fixture",true],["Fixture",true],["Fixture",false],
        ["Fixture",true],["Fixture",true],["Fixture",false],["Fixture",true]]);
      eq(f.evaluate("Object.getOwnPropertyNames(Object.prototype).join('|')"),prototype);
    }
  });
  run("FB-T02 own marker truthiness and literal inserts preserve unrelated JSON",()=>{
    const other={nested:[null,false,0,{value:"synthetic"}]};
    for(const marker of [false,0,null,"",1,-1,"yes",{},[]]) {
      const f=fixture("toString",{initial:{[key]:{toString:marker,other},
        "aced:other:missedEver":{untouched:1}}});
      const before=f.memory.get(key),writes=f.writes.filter(k=>k===key).length;
      answer(f);
      eq(f.api.G._redeemedCount,marker?1:0);
      const saved=JSON.parse(f.memory.get(key));eq(saved.other,other);
      if(!marker){eq(f.memory.get(key),before);eq(f.writes.filter(k=>k===key).length,writes);}
      answer(f,false);eq(JSON.parse(f.memory.get(key)).toString,1);
      eq(f.memory.get("aced:other:missedEver"),'{"untouched":1}');
    }
    const f=fixture();eq(f.api._qKey({id:12,q:"unused"}),"12");
    eq(f.api._qKey({q:"fallback"}),"fallback");eq(f.api._qKey(null),"");
    const before=f.writes.length;f.api.addMissedEver({});f.api.clearMissedEver({});
    eq(f.writes.length,before);
  });
  run("FB-T03 actual Redemption scoring and unlock use only genuine consumption",async()=>{
    for(const id of ["ordinary","toString","hasOwnProperty","constructor","__proto__","識別"])for(const missed of [false,true]) {
      const f=fixture(id);if(missed)answer(f,false);answer(f);
      eq(f.api.G._redeemedCount,missed?1:0);
      const cards=f.api.G.masterDeck.filter(c=>c.rank===2).slice(0,2);
      // Remove audit-created Conviction for deterministic existing Pair=28 control.
      f.api.G.conviction=Object.create(null);f.api.G.jokers=[f.api.jokers.find(j=>j.id==="redemption")];
      f.api.G.hand=cards;f.api.G.sel=new Set(cards.map(c=>c.id));f.api.G.target=1e9;
      f.api.fastAnimations();await f.api.play();
      eq(f.api.G.score,missed?118:28);
      eq(f.api.unlocked.includes("redemption"),missed);
    }
  });
  run("FB-T04 held raw history preserves bytes and accepts only genuine session events",()=>{
    for(const raw of ["{bad","null","[]","12",'{"ordinary":1,"overflow":1e999}']) {
      const f=fixture("toString",{initial:{[key]:raw}});
      const count=f.writes.filter(k=>k===key).length;
      answer(f);eq(f.api.G._redeemedCount,0);eq(f.memory.get(key),raw);
      answer(f,false);answer(f);answer(f);eq(f.api.G._redeemedCount,1);
      eq(f.memory.get(key),raw);eq(f.writes.filter(k=>k===key).length,count);
    }
  });
  run("FB-T05 failed consume and unknown reads use bounded memory authorities",()=>{
    const f=fixture("toString",{initial:{[key]:{toString:1,other:1}}});
    f.blockWrites();answer(f);answer(f);eq(f.api.G._redeemedCount,1);
    eq(f.memory.get(key),'{"toString":1,"other":1}');
    f.blockWrites(false);answer(f);eq(f.api.G._redeemedCount,1);
    eq(f.memory.get(key),'{"toString":1,"other":1}');
    const reload=fixture("toString",{initial:Object.fromEntries(f.memory)});
    answer(reload);eq(reload.api.G._redeemedCount,1); // Documented reload limit.
    for(const id of ["ordinary","toString"]) {
      const e=fixture(id);e.blockStorage();answer(e);eq(e.api.G._redeemedCount,0);
      answer(e,false);answer(e);answer(e);eq(e.api.G._redeemedCount,1);check(!e.memory.has(key));
      e.memory.set(key,JSON.stringify({[id]:1,other:1}));e.blockStorage(false);
      answer(e);eq(e.api.G._redeemedCount,1);
      e.api.clearMissedEver({id:"other"});check(own(JSON.parse(e.memory.get(key)),id));
      answer(e,false);answer(e);eq(e.api.G._redeemedCount,2);
    }
  });
  run("FB-T04 readable history survives failed probe and latest read failures",()=>{
    const initial={[key]:{toString:1,other:1}};
    const f=fixture("toString",{initial,configureContext(c){
      const set=c.localStorage.setItem;
      c.localStorage.setItem=(k,v)=>{if(k==="__aced_probe__")throw Error("bounded");return set(k,v);};
    }});
    answer(f);answer(f);eq(f.api.G._redeemedCount,1);eq(f.memory.get(key),'{"toString":1,"other":1}');
    for(const corrupt of [false,true]) {
      const e=fixture("toString",{initial});
      check(e.api.wasMissedEver(e.api.qbank[0]));
      if(corrupt){e.memory.set(key,"{bad");check(!e.api.wasMissedEver(e.api.qbank[0]));}
      const bytes=e.memory.get(key);e.blockStorage();
      answer(e);eq(e.api.G._redeemedCount,corrupt?0:1);eq(e.memory.get(key),bytes);
      answer(e,false);answer(e);eq(e.api.G._redeemedCount,corrupt?1:2);eq(e.memory.get(key),bytes);
    }
    const absent=fixture("toString");
    check(!absent.api.wasMissedEver(absent.api.qbank[0])); // Establish actual absence.
    absent.blockStorage();answer(absent);answer(absent,false);answer(absent);answer(absent);
    eq(absent.api.G._redeemedCount,1);check(!absent.memory.has(key));
  });
  run("FB-T02 unsupported JSON and executable hooks hold without invocation",()=>{
    const payloads=[
      '({target:1,other:undefined})','({target:1,other:NaN})','({target:1,other:Infinity})',
      '({target:1,other:1n})','({target:1,other:function(){}})',
      '({target:1,get other(){__hooks++;return 1;}})',
      '({target:1,toJSON(){__hooks++;return {};}})',
      '({target:1,other:[,1]})','(()=>{const x={target:1};x.other=x;return x;})()',
      '(()=>{const x={target:1};x[Symbol("s")]=1;return x;})()',
      '({target:1,other:new Date()})','(()=>{const a=[1];a.extra=1;return {target:1,a};})()'
    ];
    for(const expression of payloads) {
      const f=fixture("target",{initial:{[key]:'{"hook":1}'}});
      f.evaluate(`globalThis.__hooks=0;globalThis.__payload=${expression};
        const __parse=JSON.parse;JSON.parse=function(raw){return raw==='{"hook":1}'?__payload:__parse(raw);};`);
      const prototype=f.evaluate("Object.getOwnPropertyDescriptors(Object.prototype)");
      answer(f);eq(f.api.G._redeemedCount,0);eq(f.memory.get(key),'{"hook":1}');
      answer(f,false);answer(f);answer(f);eq(f.api.G._redeemedCount,1);
      eq(f.evaluate("__hooks"),0);eq(f.memory.get(key),'{"hook":1}');
      eq(f.evaluate("Object.getOwnPropertyDescriptors(Object.prototype)"),prototype);
    }
    const e=fixture("target",{initial:{[key]:'{"target":1}'}});
    e.evaluate("globalThis.__stringify=JSON.stringify;JSON.stringify=function(){throw Error('bounded');};");
    check(!e.api.clearMissedEver({id:"target"}));eq(e.memory.get(key),'{"target":1}');
    e.api.addMissedEver({id:"new-target"});check(e.api.clearMissedEver({id:"new-target"}));
    check(!e.api.clearMissedEver({id:"new-target"}));
    e.evaluate("JSON.stringify=__stringify;");
  });
  run("FB-T05 no-op reads, event precedence, isolated tabs and old-client limits",()=>{
    const f=fixture("toString",{initial:{[key]:"{}"}});
    const writes=f.writes.filter(k=>k===key).length;
    f.api.wasMissedEver(f.api.qbank[0]);f.api.clearMissedEver(f.api.qbank[0]);
    eq(f.writes.filter(k=>k===key).length,writes);
    f.api.addMissedEver(f.api.qbank[0]);const one=f.writes.filter(k=>k===key).length;
    f.api.addMissedEver(f.api.qbank[0]);eq(f.writes.filter(k=>k===key).length,one);
    const saved=Object.fromEntries(f.memory);
    const tabs=[fixture("toString",{initial:saved}),fixture("toString",{initial:saved})];
    for(const t of tabs){answer(t);answer(t);eq(t.api.G._redeemedCount,1);}
    // An old client can reintroduce a consumed durable marker; no cross-client CAS.
    tabs[0].memory.set(key,'{"toString":1}');answer(tabs[0]);eq(tabs[0].api.G._redeemedCount,2);
    for(const id of ["ordinary","toString"]) {
      const e=fixture(id,{initial:{[key]:"{bad"}});
      answer(e,false);answer(e);e.memory.set(key,JSON.stringify({[id]:1,other:1}));
      answer(e);eq(e.api.G._redeemedCount,1);
      e.api.addMissedEver({id:"third"});e.api.clearMissedEver({id:"other"});
      check(own(JSON.parse(e.memory.get(key)),id)); // No overlay flush.
    }
  });
  run("FB-T06 actual audit independent result matrix and no-op repaint",()=>{
    for(const correct of [true,false])for(const [core,coreText] of outcomes)for(const [library,libraryText] of outcomes) {
      const f=fixture(),calls=[];
      f.context.ACEDCore.calibration.record=()=>calls.push("calibration");
      f.context.ACEDCore.review.record=()=>{calls.push("core");return core;};
      f.context.ACEDLibraryRecord=()=>{calls.push("library");return library;};
      f.context.ACEDCore.analytics.track=()=>calls.push("analytics");
      f.context.ACEDCore.sync.push=()=>{calls.push("push");return Promise.resolve({reason:"no-endpoint"});};
      answer(f,correct);
      eq(calls,["calibration","core","library","analytics","push"]);
      check(f.modal().includes("Review: "+coreText));
      check(f.modal().includes("Library recall: "+libraryText));check(f.modal().includes(scopeNote));
      check(!/queued in review|queued for later/i.test(f.document.getElementById("toast").textContent));
      const before=[f.writes.length,f.logs.length,calls.length];
      f.api.renderAudit();f.api.renderAudit();eq([f.writes.length,f.logs.length,calls.length],before);
    }
  });
  run("FB-T06 missing, thrown, legacy, inherited and accessor results stay unconfirmed",()=>{
    let hooks=0;
    const invalid=[undefined,true,false,null,{},[],{outcome:"recorded",persistence:"none",reason:"complete"},
      {outcome:"partial",persistence:"durable",reason:"complete"},
      {...outcomes[0][0],error:true},{...outcomes[0][0],ok:false},
      Object.create(outcomes[0][0]),
      Object.defineProperty({}, "outcome",{get(){hooks++;return "recorded";}})];
    for(const value of invalid)for(const ok of [true,false]) {
      const f=fixture();f.context.ACEDCore.review.record=()=>value;f.context.ACEDLibraryRecord=()=>value;
      answer(f,ok);check(f.modal().includes("Review: recording could not be confirmed."));
      check(f.modal().includes("Library recall: recording could not be confirmed."));
    }
    eq(hooks,0);
    for(const broken of ["core","library","calibration"]) {
      const f=fixture(),calls=[];
      f.context.ACEDCore.calibration.record=()=>{if(broken==="calibration")throw Error("bounded");};
      f.context.ACEDCore.review.record=()=>{calls.push("core");if(broken==="core")throw Error("bounded");return outcomes[0][0];};
      f.context.ACEDLibraryRecord=()=>{calls.push("library");if(broken==="library")throw Error("bounded");return outcomes[0][0];};
      answer(f);check(f.modal().includes("Library recall: recording could not be confirmed."));
      eq(calls,broken==="calibration"?[]:broken==="core"?["core"]:["core","library"]);
    }
    const built=fixture("constructor");answer(built);check(!built.modal().includes("Library recall:"));
    for(const reason of ["serialization-failed","storage-unavailable","raw-state-unavailable"]) {
      const f=fixture(),held={outcome:"held",persistence:"none",reason};
      f.context.ACEDCore.review.record=()=>held;f.context.ACEDLibraryRecord=()=>held;
      answer(f);check(f.modal().includes("Review: "+outcomes[4][1]));
      check(f.modal().includes("Library recall: "+outcomes[4][1]));
    }
  });
  run("FB-T07 actual partial core accepts update without claiming saved correctness",()=>{
    const f=fixture("ordinary",{initial:{"aced:runtime-fixture:review":{ordinary:{}}}});
    answer(f,true);
    const saved=JSON.parse(f.memory.get("aced:runtime-fixture:review")).ordinary;
    eq(Object.keys(saved),["last"]);check(f.modal().includes("Review: "+outcomes[1][1]));
    check(!f.modal().includes("Review: recorded"));f.api.toast("Replacement game toast");
    check(f.modal().includes(scopeNote));
    f.api.beginAuditQuestion("Fixture",f.api.qbank[0],10,true);
    check(!f.modal().includes(scopeNote));
    const learningKey="aced:runtime-fixture:learning_v1";
    for(const memory of [false,true]) {
      const e=fixture("ordinary",{initial:{[learningKey]:{answers:{ordinary:{strength:1}}}}});
      if(memory)e.blockWrites();
      answer(e);
      check(e.modal().includes("Library recall: "+outcomes[memory?3:1][1]));
      const saved=e.context.ACEDLibrary.learning("runtime-fixture");
      check(saved.answers.ordinary.strength>1);
      if(!memory)check(!own(JSON.parse(e.memory.get(learningKey)).answers.ordinary,"attempts"));
    }
  });
  run("FB-T07 shared core-only mixed summaries count submitted and missed updates",()=>{
    for(const kind of ["review","mock","drill"])for(const high of [true,false]) {
      const f=fixture(),choices=f.choices("[data-qc]",[{qc:"0"},{qc:"1"}]);
      let n=0,library=0;
      f.context.ACEDCore.review.record=()=>outcomes[n++][0];
      f.context.ACEDLibraryRecord=()=>{library++;};
      f.api.runQuiz({title:"Synthetic",kind,questions:Array(7).fill(f.api.qbank[0])});
      for(let i=0;i<7;i++) {
        const missed=!high||i===4;
        choices[missed?1:0].onclick();f.document.getElementById("qSubmit").onclick();
        check(f.document.getElementById("qfoot").innerHTML.includes("Review: "+outcomes[i][1]));
        f.document.getElementById("qNext").onclick();
      }
      eq(n,7);eq(library,0);check(f.modal().includes("Review updates for 7 submitted answers:"));
      check(f.modal().includes(high?"Of 1 missed answers:":"Of 7 missed answers:"));
      check(f.modal().includes("2 not recorded"));check(f.modal().includes("1 unconfirmed"));
      const lists=[...f.modal().matchAll(/<ul>([\s\S]*?)<\/ul>/g)].map(m=>
        [...m[1].matchAll(/<li>(\d+) /g)].map(x=>Number(x[1])));
      eq(lists[0],[1,1,1,1,2,1]);eq(lists[0].reduce((a,b)=>a+b,0),7);
      eq(lists[1].reduce((a,b)=>a+b,0),high?1:7);
      check(f.modal().includes(scopeNote));check(!/now queued|progress synced|all progress saved/i.test(f.modal()));
      if(!high)check(f.modal().includes("Keep going. Review recording details are below."));
    }
  });
  run("FB-T07 persistent status uses a stable announcer and targeted continuation focus",()=>{
    const fs=require("node:fs"),path=require("node:path");
    const html=fs.readFileSync(path.resolve(__dirname,"../../study.html"),"utf8");
    eq((html.match(/id="recordingStatusLive"/g)||[]).length,1);
    check(/id="recordingStatusLive"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/.test(html));
    const f=fixture(),[choice]=f.choices("[data-ach]",[{ach:"0"}]),[conf]=f.choices("[data-conf]",[{conf:"MED"}]);
    f.api.beginAuditQuestion("Fixture",f.api.qbank[0],10,true);choice.onclick();conf.onclick();
    f.document.getElementById("auditSubmit").focus();f.document.getElementById("auditSubmit").onclick();
    eq(f.document.activeElement.id,"auditCont");
    check(f.document.getElementById("recordingStatusLive").textContent.includes("Review:"));
    const announcement=f.document.getElementById("recordingStatusLive").textContent;
    f.document.getElementById("mute").focus();f.api.renderAudit();eq(f.document.activeElement.id,"mute");
    eq(f.document.getElementById("recordingStatusLive").textContent,announcement);
  });
  run("FB-T06 locked audit prevents only same-attempt replay, not later real attempts",()=>{
    const f=fixture(),calls=[];
    f.context.ACEDCore.review.record=()=>{calls.push("core");return outcomes[0][0];};
    f.context.ACEDLibraryRecord=()=>{calls.push("library");return outcomes[0][0];};
    answer(f);const money=f.api.G.money,insight=f.api.G.insight,mastery=f.api.mastery.Fixture;
    f.api.submitAudit();eq(calls,["core","library"]);eq([f.api.G.money,f.api.G.insight,f.api.mastery.Fixture],[money,insight,mastery]);
    answer(f);eq(calls,["core","library","core","library"]);
    eq([f.api.G.money-money,f.api.G.insight-insight,f.api.mastery.Fixture-mastery],[12,2,8]);
  });
  run("FB-T08 account eligibility guards are persistent and request-free",()=>{
    const cases=[
      [a=>a.signInPending=()=>true,"Sign-in confirmation is pending."],
      [a=>a.signInNotice=()=>"bounded notice","Sign-in could not be completed here."],
      [a=>a.syncHeld=()=>true,"Manual sync is held by the account guard."],
      [a=>a.syncHeld=()=>undefined,"Manual sync availability could not be confirmed."],
      [a=>a.signInPending=undefined,"Manual sync availability could not be confirmed."],
      [a=>a.syncHeld=()=>{throw Error("bounded");},"Manual sync availability could not be confirmed."],
      [(a,f)=>f.context.ACEDCore.sync.isEnabled=()=>false,"Manual sync is unavailable in this build or session."],
      [(a,f)=>f.context.ACED_API_URL="","Manual sync is unavailable in this build or session."],
      [a=>a.token=()=>null,"Manual sync availability could not be confirmed."]
    ];
    for(const [change,text] of cases) {
      const f=accountFixture(),calls=[];change(f.context.ACEDAccount,f);
      f.context.ACEDCore.sync.push=()=>{calls.push("push");return Promise.resolve({ok:true});};
      f.context.ACEDCore.sync.pull=()=>{calls.push("pull");return Promise.resolve({applied:true});};
      const bytes=Object.fromEntries(f.memory),writes=f.writes.length;
      f.api.openAcctModal();check(f.modal().includes('id="acctStatus"'));
      check(f.document.getElementById("acctStatus").textContent.includes(text));
      check(f.document.getElementById("acctSync").disabled);
      f.document.getElementById("acctSync").onclick();
      eq(calls,[]);eq(f.writes.length,writes);eq(Object.fromEntries(f.memory),bytes);
    }
    const f=accountFixture();f.api.renderAcctBtn();
    check(f.document.getElementById("acctBtn").textContent.startsWith("ACCOUNT"));
    eq(f.document.getElementById("acctBtn").title,"Signed in. Open account and sync status.");
    f.api.openAcctModal();check(f.modal().includes("Sign-in does not confirm that progress was saved or synchronized."));
    f.session.signed=false;f.api.openAcctModal();check(f.modal().includes("Sign in to an account. Progress sync depends on availability."));
  });
  run("FB-T09 manual own-metadata upload and download copy matrices",async()=>{
    const ack="Upload: server acknowledged this sync request.";
    const unknown="Upload: acknowledgment could not be confirmed.";
    const applied="Download: server response applied on this page. Durable saving of all progress was not verified.";
    let hooks=0;
    const uploads=[
      [{ok:true,serverUpdatedAt:1},ack],[{synced:true},unknown],[undefined,unknown],
      [{error:true},"Upload: not confirmed by the server."],
      [{ok:false},"Upload: not confirmed by the server."],
      [{synced:false},"Upload: not confirmed by the server."],
      [{reason:"no-endpoint"},"Upload: not attempted because sync is unavailable."],
      [{ok:true,error:true},unknown],[{ok:true,synced:false},unknown],
      [{ok:true,reason:"no-endpoint"},unknown],[{ok:true,reason:"unexpected"},unknown],
      [Object.create({ok:true}),unknown],
      [Object.defineProperty({},"ok",{get(){hooks++;return true;}}),unknown]
    ];
    const downloads=[
      [{applied:true},applied],[{applied:true,reason:"stale"},"Download: application could not be confirmed."],
      [{applied:true,error:true},"Download: application could not be confirmed."],
      [{applied:false,ok:true},"Download: application could not be confirmed."],
      [{applied:false,reason:null},"Download: no application was confirmed."],
      [{applied:false,reason:{toString(){hooks++;return "stale";}}},"Download: no application was confirmed."],
      [undefined,"Download: application could not be confirmed."],
      [Object.create({applied:true}),"Download: application could not be confirmed."],
      [Object.defineProperty({},"applied",{get(){hooks++;return true;}}),"Download: application could not be confirmed."],
      ...[
        ["no-endpoint","not attempted because sync is unavailable."],["stale","no newer response was applied."],
        ["empty","no usable response was applied."],["pack-mismatch","response was not applied because its pack did not match."],
        ["review-state-held","response was held to preserve local Review history."],
        ["review-serialization-failed","response was held because Review data could not be safely written."],
        ["review-storage-unavailable","response was held because Review storage was unavailable."],
        ["unknown","no application was confirmed."]
      ].map(([reason,text])=>[{applied:false,reason},"Download: "+text])
    ];
    for(const [upload,ut,download,dt] of [
      ...uploads.map(([u,t])=>[u,t,{applied:true},applied]),
      ...downloads.map(([d,t])=>[{ok:true},ack,d,t])
    ]) {
      const f=accountFixture(),calls=[];
      f.context.ACEDCore.sync.push=()=>{calls.push("push");return Promise.resolve(upload);};
      f.context.ACEDCore.sync.pull=()=>{calls.push("pull");return Promise.resolve(download);};
      f.api.openAcctModal();f.document.getElementById("acctSync").onclick();await flush();
      eq(calls,["push","pull"]);eq(f.document.getElementById("acctUpload").textContent,ut);
      eq(f.document.getElementById("acctDownload").textContent,dt);
      check(!/Progress synced|all progress saved/i.test(f.document.getElementById("toast").textContent));
    }
    eq(hooks,0);
  });
  run("FB-T09 actual core POST and pull responses retain narrow acknowledgment semantics",async()=>{
    for(const mode of ["applied","empty","stale","pack-mismatch","held","storage","memory","serialization","upload-error"]) {
      const f=accountFixture({storageBlocked:mode==="storage"}),requests=[];
      if(mode==="held")f.memory.set("aced:runtime-fixture:review","{bad");
      if(mode==="stale")f.context.ACEDCore.store.set("lastSyncApplied",100);
      if(mode==="storage")f.blockStorage(); // Actual core has no known raw predecessor.
      let data={review:{ordinary:{last:9}}};
      if(mode==="serialization")data=JSON.parse('{"review":{"ordinary":{"last":1e999}}}');
      f.context.fetch=(url,init={})=>{
        requests.push(init.method||"GET");
        const post=init.method==="POST";
        if(mode==="memory"&&!post)f.blockWrites();
        const body=post?(mode==="upload-error"?{error:true}:{ok:true,serverUpdatedAt:200}):
          mode==="empty"?{}:{pack:mode==="pack-mismatch"?"other":"runtime-fixture",updatedAt:mode==="stale"?1:200,data};
        return Promise.resolve({json:()=>Promise.resolve(body)});
      };
      f.api.openAcctModal();f.document.getElementById("acctSync").onclick();await flush();
      eq(requests,["POST","GET"]);
      const upload=f.document.getElementById("acctUpload").textContent,download=f.document.getElementById("acctDownload").textContent;
      eq(upload,mode==="upload-error"?"Upload: not confirmed by the server.":"Upload: server acknowledged this sync request.");
      check(download.startsWith("Download: "));
      if(mode==="held")eq(download,"Download: response was held to preserve local Review history.");
      if(mode==="storage")eq(download,"Download: response was held because Review storage was unavailable.");
      if(mode==="serialization")eq(download,"Download: response was held because Review data could not be safely written.");
      if(mode==="applied"||mode==="upload-error"||mode==="memory")check(download.includes("Durable saving of all progress was not verified."));
    }
  });
  run("FB-T09 rejected or thrown requests stop only their existing stage",async()=>{
    for(const stage of ["push","pull"])for(const thrown of [false,true]) {
      const f=accountFixture(),calls=[];
      for(const s of ["push","pull"])f.context.ACEDCore.sync[s]=()=>{
        calls.push(s);if(s===stage){if(thrown)throw Error("bounded");return Promise.reject(Error("bounded"));}
        return Promise.resolve({ok:true});
      };
      f.api.openAcctModal();f.document.getElementById("acctSync").onclick();await flush();
      eq(calls,stage==="push"?["push"]:["push","pull"]);
      eq(f.document.getElementById(stage==="push"?"acctUpload":"acctDownload").textContent,
        stage==="push"?"Upload: request did not complete; acknowledgment could not be confirmed.":
        "Download: request did not complete; application could not be confirmed.");
      if(stage==="push")eq(f.document.getElementById("acctDownload").textContent,"Download: not attempted.");
    }
  });
  run("FB-T10 close/reopen and duplicate clicks retain one operation without modal hijack",async()=>{
    const f=accountFixture(),push=deferred(),pull=deferred(),calls=[];
    f.context.ACEDCore.sync.push=()=>{calls.push("push");return push.promise;};
    f.context.ACEDCore.sync.pull=()=>{calls.push("pull");return pull.promise;};
    f.api.openAcctModal();const click=f.document.getElementById("acctSync").onclick;
    click();click();eq(calls,["push"]);check(f.document.getElementById("acctSync").disabled);
    f.document.getElementById("acctClose").onclick();f.api.openAcctModal();
    f.document.getElementById("acctSync").onclick();eq(calls,["push"]);
    check(f.document.getElementById("acctStatus").textContent.includes("Waiting for an existing manual request"));
    push.resolve({ok:true});await flush();eq(calls,["push","pull"]);
    f.api.showModal("<h2>Synthetic gameplay</h2>");f.document.getElementById("play").focus();
    const live=f.document.getElementById("recordingStatusLive").textContent;
    pull.resolve({applied:true});await flush();
    eq(f.modal(),"<h2>Synthetic gameplay</h2>");eq(f.document.activeElement.id,"play");
    eq(f.document.getElementById("recordingStatusLive").textContent,live);
    f.api.openAcctModal();check(f.document.getElementById("acctDownload").textContent.includes("server response applied"));
    eq(calls,["push","pull"]);
  });
  run("FB-T10 departure suppresses future pull and stale results while preserving busy guard",async()=>{
    for(const departure of ["token","guard","missing-token","local-out","all-out","core","account","pack"]) {
      const f=accountFixture(),push=deferred(),out=deferred(),calls=[];
      f.context.ACEDCore.sync.push=()=>{calls.push("push");return push.promise;};
      f.context.ACEDCore.sync.pull=()=>{calls.push("pull");return Promise.resolve({applied:true});};
      f.context.ACEDAccount.signOutEverywhere=()=>out.promise;
      f.api.openAcctModal();f.document.getElementById("acctSync").onclick();
      if(departure==="token")f.session.token="new-synthetic-session";
      if(departure==="guard")f.context.ACEDAccount.syncHeld=()=>true;
      if(departure==="missing-token")f.context.ACEDAccount.token=undefined;
      if(departure==="local-out")f.document.getElementById("acctOut").onclick();
      if(departure==="all-out")f.document.getElementById("acctAllOut").onclick();
      if(departure==="core")f.context.ACEDCore={...f.context.ACEDCore,sync:{...f.context.ACEDCore.sync}};
      if(departure==="account")f.context.ACEDAccount={...f.context.ACEDAccount};
      if(departure==="pack")f.context.ACED_PACK={...f.context.ACED_PACK};
      f.api.openAcctModal();if(typeof f.document.getElementById("acctSync").onclick==="function")f.document.getElementById("acctSync").onclick();
      eq(calls,["push"]);push.resolve({ok:true});await flush();eq(calls,["push"]);
      check(!f.document.getElementById("acctDownload").textContent.includes("server response applied"));
      out.resolve();await flush();
    }
  });
  run("FB-T10 an issued pull may settle after departure without stale UI success",async()=>{
    const f=accountFixture(),pull=deferred(),calls=[];
    f.context.ACEDCore.sync.push=()=>{calls.push("push");return Promise.resolve({ok:true});};
    f.context.ACEDCore.sync.pull=()=>{calls.push("pull");return pull.promise;};
    f.api.openAcctModal();f.document.getElementById("acctSync").onclick();await flush();
    eq(calls,["push","pull"]);f.session.token="different-session";f.api.openAcctModal();
    check(f.document.getElementById("acctSync").disabled);
    pull.resolve({applied:true});await flush();
    check(!f.document.getElementById("acctDownload").textContent.includes("server response applied"));
    check(!f.document.getElementById("acctSync").disabled);
    eq(calls,["push","pull"]); // No cancellation/retry claim.
    f.document.getElementById("acctSync").onclick();await flush();
    eq(calls,["push","pull","push","pull"]); // A later explicit eligible attempt.
  });
  run("FB-T02 inherited serialization hooks never run on detached missedEver copies",()=>{
    const f=fixture("target",{initial:{[key]:'{"target":1,"other":[1,{"value":2}]}'}});
    f.evaluate(`globalThis.__hookCount=0;
      Object.defineProperty(Object.prototype,"toJSON",{configurable:true,value:function(){__hookCount++;return {};}});
      Object.defineProperty(Array.prototype,"toJSON",{configurable:true,value:function(){__hookCount++;return [];}});
    `);
    try{
      check(f.api.clearMissedEver({id:"target"}));f.api.addMissedEver({id:"__proto__"});
      eq(f.evaluate("__hookCount"),0);
      eq(JSON.parse(f.memory.get(key)),JSON.parse('{"other":[1,{"value":2}],"__proto__":1}'));
    }finally{f.evaluate("delete Object.prototype.toJSON;delete Array.prototype.toJSON;");}
  });
}
module.exports=register;
