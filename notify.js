/* ACED notify.js
   Wires every <form data-aced-notify data-source="..."> to the launch list.
   Posts {email, source} to: form's data-endpoint, else window.ACED_CAPTURE_ENDPOINT,
   else window.ACED_API_URL + "/notify". No local address buffer. Honeypot spam guard.
   Load AFTER aced-config.js (+ aced-core.js optional). */
(function () {
  var DEADLINE_MS = 10000; // TUNABLE: total client confirmation deadline, not a delivery guarantee.
  var bound = "__acedNotifyBoundV1", owner = "__acedNotifyNoteOwnerV1";
  var text = {
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
  function endpointFor(f){ return f.getAttribute("data-endpoint")||window.ACED_CAPTURE_ENDPOINT||(window.ACED_API_URL?String(window.ACED_API_URL).replace(/\/$/,"")+"/notify":""); }
  function noteFor(form, input) {
    var note = form.querySelector(".capnote"), parent = form.parentNode;
    if (!note && parent && parent.querySelectorAll("form").length === 1 &&
        parent.querySelectorAll(".capnote").length === 1) note = parent.querySelector(".capnote");
    if (!note || (note[owner] && note[owner] !== form)) {
      note = document.createElement("div"); note.className = "capnote"; form.appendChild(note);
    }
    Object.defineProperty(note, owner, { value: form });
    var all = document.querySelectorAll("[id]"), count = 0, i, id = note.id;
    if (id) for (i = 0; i < all.length; i++) if (all[i].id === id) count++;
    if (!id || count !== 1) {
      i = 1;
      do { id = "aced-notify-status-" + i++; } while (document.getElementById(id));
      if (input && note.id) {
        input.setAttribute("aria-describedby", (input.getAttribute("aria-describedby") || "").split(/\s+/)
          .filter(function (token) { return token && token !== note.id; }).join(" "));
      }
      note.id = id;
    }
    note.setAttribute("role", "status");
    note.setAttribute("aria-live", "polite");
    note.setAttribute("aria-atomic", "true");
    return note;
  }
  function supportedAck(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return false;
    var ok = Object.getOwnPropertyDescriptor(body, "ok");
    var error = Object.getOwnPropertyDescriptor(body, "error");
    return !!ok && Object.prototype.hasOwnProperty.call(ok, "value") && ok.value === true &&
      (!error || (Object.prototype.hasOwnProperty.call(error, "value") && !error.value));
  }
  function wire(form){
    if (Object.prototype.hasOwnProperty.call(form, bound)) return;
    Object.defineProperty(form, bound, { value: true });
    var input = form.querySelector('input[type="email"]'), note = noteFor(form, input);
    var button = form.querySelector('[type="submit"]') || form.querySelector("button");
    var current = null, revision = 0, result = false;
    if (input) {
      var described = (input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      if (described.indexOf(note.id) === -1) described.push(note.id);
      input.setAttribute("aria-describedby", described.join(" "));
    }
    function live() {
      return form.isConnected !== false && note.isConnected !== false &&
        form.querySelector('input[type="email"]') === input && note[owner] === form;
    }
    function show(message, success) {
      if (!live()) return;
      note.classList.remove("ok");
      if (success) note.classList.add("ok");
      note.textContent = message;
    }
    function changed(op) {
      return revision !== op.revision || !input || input.value !== op.raw ||
        (form.getAttribute("data-source") || "home") !== op.source || endpointFor(form) !== op.endpoint;
    }
    function restore(op) {
      if (!button) return;
      if (button.getAttribute("aria-disabled") === "true") {
        if (op.disabled === null) button.removeAttribute("aria-disabled");
        else button.setAttribute("aria-disabled", op.disabled);
      }
      if (button.getAttribute("aria-busy") === "true") {
        if (op.busy === null) button.removeAttribute("aria-busy");
        else button.setAttribute("aria-busy", op.busy);
      }
      if (button.textContent === "SUBMITTING...") button.textContent = op.label;
    }
    function finish(op, state) {
      if (current !== op) return;
      if (Date.now() >= op.deadline) state = "expired";
      var edited = changed(op), visible = live(), source = op.source;
      current = null; clearTimeout(op.timer); restore(op); result = true;
      if (state === "expired" && op.controller) {
        try { op.controller.abort(); } catch (_) {}
      }
      show(edited ? (state === "confirmed" ? text.earlierConfirmed : text.earlierUnconfirmed) : text[state],
        state === "confirmed" && !edited);
      if (visible && state === "confirmed" &&
          ["home", "lsat", "mcat", "nclex", "bar-exam", "usmle"].indexOf(source) !== -1) {
        try {
          if (window.ACEDCore && window.ACEDCore.analytics &&
              typeof window.ACEDCore.analytics.track === "function") {
            window.ACEDCore.analytics.track("email_captured", { source: source });
          }
        } catch (_) {}
      }
      // Late promises can retain the operation, but not its request snapshot.
      op.raw = op.email = op.source = op.endpoint = op.controller = op.label = null;
    }
    function edited() {
      revision++;
      if (input) input.removeAttribute("aria-invalid");
      if (current) show(text.editedPending, false);
      else if (result) show(text.draft, false);
    }
    if (input) input.addEventListener("input", edited);
    form.addEventListener("reset", edited);
    form.addEventListener("submit", function(e){
      e.preventDefault();
      if (current || !live()) return;
      show("", false); result = false;
      var hp=form.querySelector('input[name="company"]'); if(hp&&hp.value) return;
      if (!input) { result = true; show(text.unavailable, false); return; }
      var email = (input.value || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        result = true; show(text.invalid, false); input.setAttribute("aria-invalid", "true"); input.focus(); return;
      }
      input.removeAttribute("aria-invalid");
      var endpoint = endpointFor(form);
      if (!endpoint || typeof window.fetch !== "function") {
        result = true; show(text.unavailable, false); return;
      }
      var op = {
        raw: input.value, email: email, source: form.getAttribute("data-source") || "home",
        endpoint: endpoint, revision: revision, deadline: Date.now() + DEADLINE_MS,
        disabled: button ? button.getAttribute("aria-disabled") : null,
        busy: button ? button.getAttribute("aria-busy") : null, label: button ? button.textContent : null,
        controller: null, timer: null
      };
      if (typeof window.AbortController === "function") {
        try { op.controller = new window.AbortController(); } catch (_) {}
      }
      current = op;
      if (button) {
        button.setAttribute("aria-disabled", "true"); button.setAttribute("aria-busy", "true");
        button.textContent = "SUBMITTING...";
      }
      show(text.pending, false);
      op.timer = setTimeout(function () { finish(op, "expired"); }, DEADLINE_MS);
      var request = { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: op.email, source: op.source }) };
      if (op.controller) request.signal = op.controller.signal;
      try {
        Promise.resolve(window.fetch(endpoint, request)).then(function (response) {
          if (current !== op) return;
          if (Date.now() >= op.deadline) { finish(op, "expired"); return; }
          if (response && response.status === 429) { finish(op, "limited"); return; }
          if (!response || response.ok !== true || !Number.isInteger(response.status) ||
              response.status < 200 || response.status > 299 || typeof response.json !== "function") {
            finish(op, "unconfirmed"); return;
          }
          return Promise.resolve(response.json()).then(function (body) {
            if (current === op) finish(op, supportedAck(body) ? "confirmed" : "unconfirmed");
          }, function () { finish(op, "unconfirmed"); });
        }).catch(function () { finish(op, "unconfirmed"); });
      } catch (_) { finish(op, "unconfirmed"); }
    });
  }
  function init(){ var fs=document.querySelectorAll("form[data-aced-notify]"); for(var i=0;i<fs.length;i++) wire(fs[i]); }
  if(document.readyState!=="loading") init(); else document.addEventListener("DOMContentLoaded", init);
})();
