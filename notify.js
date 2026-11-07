/* ACED — notify.js
   Wires every <form data-aced-notify data-source="..."> to the launch list.
   Posts {email, source} to: form's data-endpoint, else window.ACED_CAPTURE_ENDPOINT,
   else window.ACED_API_URL + "/notify". Keeps a local copy via ACEDCore. Honeypot spam guard.
   Load AFTER aced-config.js (+ aced-core.js optional). */
(function () {
  function endpointFor(f){ return f.getAttribute("data-endpoint")||window.ACED_CAPTURE_ENDPOINT||(window.ACED_API_URL?String(window.ACED_API_URL).replace(/\/$/,"")+"/notify":""); }
  function noteFor(f){ var n=f.querySelector(".capnote")||(f.parentNode&&f.parentNode.querySelector(".capnote")); if(!n){n=document.createElement("div");n.className="capnote";n.setAttribute("role","status");n.setAttribute("aria-live","polite");f.appendChild(n);} return n; }
  function wire(form){
    var note=noteFor(form);
    form.addEventListener("submit", function(e){
      e.preventDefault();
      var hp=form.querySelector('input[name="company"]'); if(hp&&hp.value) return;
      var input=form.querySelector('input[type="email"]'); var email=((input&&input.value)||"").trim();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ note.className="capnote"; note.textContent="Enter a valid email and we'll add you to the list."; return; }
      var source=form.getAttribute("data-source")||"home";
      try{ if(window.ACEDCore){ var subs=ACEDCore.store.get("subscribers",[]); subs.push({email:email,source:source,t:Date.now()}); ACEDCore.store.set("subscribers",subs); if(ACEDCore.analytics)ACEDCore.analytics.track("email_captured",{source:source}); } }catch(_){}
      function done(){ note.className="capnote ok"; note.textContent="You're on the list"+(source&&source!=="home"?" for "+source.toUpperCase():"")+". Talk soon."; form.reset(); }
      var endpoint=endpointFor(form);
      if(endpoint){ try{ fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email,source:source})}).then(done).catch(done);}catch(_){done();} } else { done(); }
    });
  }
  function init(){ var fs=document.querySelectorAll("form[data-aced-notify]"); for(var i=0;i<fs.length;i++) wire(fs[i]); }
  if(document.readyState!=="loading") init(); else document.addEventListener("DOMContentLoaded", init);
})();
