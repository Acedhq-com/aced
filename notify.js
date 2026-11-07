/* Shared launch-update request UI. No address buffer, delivery claim or replay.
   The endpoint, POST payload and honeypot contract are intentionally unchanged. */
(function () {
  "use strict";
  var bound="__acedNotifyBoundV2", owner="__acedNotifyOwnerV2", DEADLINE=10000;
  var copy={
    invalid:"Enter a valid email address. No request was started for this submission.",
    unavailable:"Updates are not connected on this page. No request was started. Your email is unchanged.",
    pending:"Submitting your update request. Confirmation is pending.",
    edited:"Request in progress for the submitted value. Your current edits have not been submitted.",
    accepted:"Your update request was accepted. Thanks for your interest in ACED.",
    earlierAccepted:"An earlier submission was accepted. Your current form has changed and has not been submitted.",
    unconfirmed:"Request not confirmed. It may have reached the service. Your email is unchanged. You can submit again.",
    earlierUnconfirmed:"An earlier submission could not be confirmed. Your current form has changed and has not been submitted.",
    timeout:"Confirmation timed out. This request may still have reached the service. Your email is unchanged. You can submit again.",
    limited:"Request not confirmed. The service is limiting requests. It may have received this one. Wait before submitting again.",
    draft:"Email changed. Submit to request updates for this value."
  };
  function endpointFor(f){return f.getAttribute("data-endpoint")||window.ACED_CAPTURE_ENDPOINT||(window.ACED_API_URL?String(window.ACED_API_URL).replace(/\/$/,"")+"/notify":"");}
  function styles(){
    if(document.querySelectorAll("style[data-aced-notify-style]").length)return;
    var s=document.createElement("style");s.setAttribute("data-aced-notify-style","v2");
    // Static component-owned selectors only. Never interpolate response/configuration.
    s.textContent=[
      "form[data-aced-notify-form],[data-aced-notify-row]{min-width:0;max-width:100%;flex-wrap:wrap}",
      "form[data-aced-notify-form] input[data-aced-notify-email]{box-sizing:border-box;min-width:0;max-width:100%;min-height:44px;border-color:#5cffea}",
      "form[data-aced-notify-form] button[data-aced-notify-submit]{box-sizing:border-box;min-width:44px;max-width:100%;min-height:44px;white-space:normal;overflow-wrap:anywhere}",
      "form[data-aced-notify-form] label{color:#d8f5d8}",
      "form[data-aced-notify-form] input[data-aced-notify-email]:focus-visible,form[data-aced-notify-form] button[data-aced-notify-submit]:focus-visible{outline:2px solid #5cffea;outline-offset:2px}",
      "[data-aced-notify-status].capnote{color:#d8f5d8;max-width:100%;overflow-wrap:anywhere}",
      "[data-aced-notify-status].capnote.ok{color:#9be36b}",
      "@media(max-width:480px){[data-aced-notify-row]{flex-direction:column;align-items:stretch}form[data-aced-notify-form] input[data-aced-notify-email],form[data-aced-notify-form] button[data-aced-notify-submit]{width:100%}}"
    ].join("\n");(document.head||document.body).appendChild(s);
  }
  function noteFor(form,input){
    var n=form.querySelector(".capnote"),p=form.parentNode;
    if(!n&&p&&p.querySelectorAll("form").length===1&&p.querySelectorAll(".capnote").length===1)n=p.querySelector(".capnote");
    if(!n||(n[owner]&&n[owner]!==form)){n=document.createElement("div");n.className="capnote";form.appendChild(n);}
    Object.defineProperty(n,owner,{value:form});
    var all=document.querySelectorAll("[id]"),count=0,id=n.id,i;
    if(id)for(i=0;i<all.length;i++)if(all[i].id===id)count++;
    if(!id||count!==1){i=1;do{id="aced-notify-status-"+i++;}while(document.getElementById(id));n.id=id;}
    n.setAttribute("role","status");n.setAttribute("aria-live","polite");n.setAttribute("aria-atomic","true");
    n.setAttribute("data-aced-notify-status","");
    if(input){var tokens=(input.getAttribute("aria-describedby")||"").split(/\s+/).filter(Boolean);if(tokens.indexOf(id)<0)tokens.push(id);input.setAttribute("aria-describedby",tokens.join(" "));}
    return n;
  }
  // Inspect descriptors before reading values. JSON acknowledgement test doubles
  // must not gain execution through getters, prototypes, symbols or thenables.
  function inertJSON(value,seen){
    if(value===null||typeof value==="string"||typeof value==="boolean")return true;
    if(typeof value==="number")return Number.isFinite(value);
    if(!value||typeof value!=="object"||seen.indexOf(value)>=0)return false;
    var proto=Object.getPrototypeOf(value),array=Array.isArray(value);
    if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)return false;
    seen.push(value);
    var keys=Reflect.ownKeys(value),ok=true;
    for(var i=0;i<keys.length&&ok;i++){
      var k=keys[i],d=Object.getOwnPropertyDescriptor(value,k);
      if(typeof k!=="string"||!d||!Object.prototype.hasOwnProperty.call(d,"value")){ok=false;break;}
      if(array&&k==="length")continue;
      if(!d.enumerable||!inertJSON(d.value,seen))ok=false;
    }
    if(array)for(i=0;i<value.length&&ok;i++)if(!Object.prototype.hasOwnProperty.call(value,String(i)))ok=false;
    seen.pop();return ok;
  }
  function accepted(body){
    try{
      if(!body||typeof body!=="object"||Array.isArray(body)||!inertJSON(body,[]))return false;
      var d=Object.getOwnPropertyDescriptor(body,"ok");
      return !!d&&Object.prototype.hasOwnProperty.call(d,"value")&&d.value===true;
    }catch(_){return false;}
  }
  // Brand-check with the native intrinsic instead of Promise.resolve(), which
  // would execute an arbitrary thenable before an acknowledgement was checked.
  function nativePromise(value,yes,no){
    try{Promise.prototype.then.call(value,yes,no);return true;}catch(_){return false;}
  }
  function wire(form){
    if(Object.prototype.hasOwnProperty.call(form,bound))return;
    Object.defineProperty(form,bound,{value:true});
    var input=form.querySelector('input[type="email"]'),button=form.querySelector('[type="submit"]')||form.querySelector("button");
    var note=noteFor(form,input),current=null,revision=0,result=false;
    form.setAttribute("data-aced-notify-form","");if(input)input.setAttribute("data-aced-notify-email","");if(button)button.setAttribute("data-aced-notify-submit","");
    var row=form.classList.contains("formrow")?form:form.querySelector(".formrow");
    if(row&&input&&row.contains(input)&&(!button||row.contains(button)))row.setAttribute("data-aced-notify-row","");
    function live(){return form.isConnected!==false&&note.isConnected!==false&&form.querySelector('input[type="email"]')===input&&note[owner]===form;}
    function show(message,ok){if(!live())return;note.classList.remove("ok");if(ok)note.classList.add("ok");if(note.textContent!==message)note.textContent=message;}
    function changed(op){return revision!==op.revision||!input||input.value!==op.raw||(form.getAttribute("data-source")||"home")!==op.source||endpointFor(form)!==op.endpoint;}
    function finish(op,state){
      if(current!==op)return;
      if(Date.now()>=op.deadline)state="timeout";
      var edited=changed(op),visible=live(),source=op.source;
      current=null;clearTimeout(op.timer);result=true;
      if(button)button.disabled=op.disabled;
      if(form.getAttribute("aria-busy")==="true"){if(op.busy===null)form.removeAttribute("aria-busy");else form.setAttribute("aria-busy",op.busy);}
      show(edited?(state==="accepted"?copy.earlierAccepted:copy.earlierUnconfirmed):copy[state],state==="accepted"&&!edited);
      if(state==="timeout"&&op.controller){try{op.controller.abort();}catch(_){}}
      if(visible&&!edited&&state==="accepted"&&["home","lsat","mcat","nclex","bar-exam","usmle"].indexOf(source)>=0){
        try{if(window.ACEDCore&&window.ACEDCore.analytics&&typeof window.ACEDCore.analytics.track==="function")window.ACEDCore.analytics.track("email_captured",{source:source});}catch(_){}
      }
      op.raw=op.source=op.endpoint=op.controller=null;
    }
    function edit(){revision++;if(input)input.removeAttribute("aria-invalid");if(current)show(copy.edited,false);else if(result)show(copy.draft,false);}
    if(input){input.addEventListener("input",edit);input.addEventListener("change",edit);}
    form.addEventListener("reset",edit);
    form.addEventListener("submit",function(e){
      e.preventDefault();if(current||!live())return;
      var hp=form.querySelector('input[name="company"]');if(hp&&hp.value)return;
      result=false;show("",false);
      var email=input?(input.value||"").trim():"";
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){result=true;show(copy.invalid,false);if(input){input.setAttribute("aria-invalid","true");input.focus();}return;}
      input.removeAttribute("aria-invalid");
      var endpoint=endpointFor(form);
      if(!endpoint||typeof window.fetch!=="function"){result=true;show(copy.unavailable,false);return;}
      var op={raw:input.value,source:form.getAttribute("data-source")||"home",endpoint:endpoint,revision:revision,deadline:Date.now()+DEADLINE,disabled:button?button.disabled:false,busy:form.getAttribute("aria-busy"),controller:null,timer:null};
      if(typeof window.AbortController==="function"){try{op.controller=new window.AbortController();}catch(_){}}
      current=op;if(button)button.disabled=true;form.setAttribute("aria-busy","true");show(copy.pending,false);
      op.timer=setTimeout(function(){finish(op,"timeout");},DEADLINE);
      var request={method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email,source:op.source})};
      if(op.controller)request.signal=op.controller.signal;
      function rejected(){finish(op,"unconfirmed");}
      function responseReady(response){
        if(current!==op)return;if(Date.now()>=op.deadline){finish(op,"timeout");return;}
        try{
          if(response&&response.status===429){finish(op,"limited");return;}
          if(!response||response.ok!==true||!Number.isInteger(response.status)||response.status<200||response.status>299||typeof response.json!=="function"){rejected();return;}
          var body=response.json();
          function bodyReady(value){if(current===op)finish(op,accepted(value)?"accepted":"unconfirmed");}
          if(!nativePromise(body,bodyReady,rejected))bodyReady(body);
        }catch(_){rejected();}
      }
      try{if(!nativePromise(window.fetch(endpoint,request),responseReady,rejected))rejected();}catch(_){rejected();}
    });
  }
  function init(){var forms=document.querySelectorAll("form[data-aced-notify]");if(forms.length)styles();for(var i=0;i<forms.length;i++)wire(forms[i]);}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
