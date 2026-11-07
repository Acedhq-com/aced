/* ACED — aced-account.js
   ============================================================================
   Thin client glue between the pages and the reference backend (server/). Load
   AFTER aced-core.js. It is a NO-OP until an API URL is configured, so every page
   keeps working exactly as it does today (localStorage-only) when offline/unset.

   Configure once, before this script, on any page that should sync:
     <script>window.ACED_API_URL = "https://api.youraced.app";</script>
     <script src="aced-core.js"></script>
     <script src="aced-account.js"></script>

   API:
     ACEDAccount.isSignedIn()                  -> bool
     ACEDAccount.email()                        -> string | null
     ACEDAccount.signInNotice()                 -> neutral message if a sign-in link was refused on this load, else null
     ACEDAccount.signIn(email)                  -> Promise (sends magic link; dev: opens link)
     ACEDAccount.signInPending()                -> true while an emailed link waits for the user's confirmation
     ACEDAccount.confirmSignIn()                -> Promise<{ok}> (the user's click: redeems the emailed link)
     ACEDAccount.syncHeld()                     -> true if sync was held because this browser's progress belongs to another account
     ACEDAccount.signOut()                      -> Promise; clears the session and revokes it server-side (local play continues)
     ACEDAccount.entitlements()                 -> Promise<string[]>  (owned pack ids)
     ACEDAccount.has(packId)                    -> Promise<bool>
     ACEDAccount.checkout(packId)               -> Promise (redirects to Stripe Checkout)
     ACEDAccount.requireEntitlement(packId,opt) -> Promise<bool>  (redirects to paywall if missing)
     ACEDAccount.signOutEverywhere()            -> Promise (revoke ALL sessions, then drop local)
     ACEDAccount.leaderboardOptIn(handle)       -> Promise (show on the public board as `handle`)
     ACEDAccount.leaderboardOptOut()            -> Promise (hide from the public board)
   ============================================================================ */
(function () {
  "use strict";
  var API = (typeof window !== "undefined" && window.ACED_API_URL) || null;
  var TOKEN_KEY = "aced_session";

  function ls() { try { return window["local" + "Storage"]; } catch (e) { return null; } }
  function getTok() { var s = ls(); try { return s ? s.getItem(TOKEN_KEY) : null; } catch (e) { return null; } }
  function setTok(t) { var s = ls(); try { if (!s) return; if (t) s.setItem(TOKEN_KEY, t); else s.removeItem(TOKEN_KEY); } catch (e) {} }
  function packId() { try { return (new URLSearchParams(location.search).get("pack") || "world-capitals").replace(/[^a-z0-9._-]/gi, ""); } catch (e) { return "world-capitals"; } }

  // Sign-in state (login-CSRF / session-fixation guard). signIn() stores a random one-time
  // state in THIS browser and sends it with the link request; the server echoes it back in
  // the fragment. A fragment token is accepted only with a matching, unexpired state, so a
  // link crafted for another account cannot sign this browser in. localStorage (not
  // sessionStorage) so the emailed link still works when it opens in a new tab.
  var AUTH_STATE_KEY = "aced_auth_state";
  var AUTH_STATE_TTL_MS = 15 * 60 * 1000;      // matches the server's magic-link lifetime
  var AUTH_STATE_MAX = 5;                      // matches the per-email link limit per hour
  var JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  function readStates() {
    var s = ls(), now = Date.now(), list;
    try { list = JSON.parse((s && s.getItem(AUTH_STATE_KEY)) || "[]"); } catch (e) { list = []; }
    if (!Array.isArray(list)) return [];
    return list.filter(function (x) { return x && typeof x.s === "string" && Number(x.exp) > now; });
  }
  function writeStates(list) {
    var s = ls(); if (!s) return;
    try { if (list.length) s.setItem(AUTH_STATE_KEY, JSON.stringify(list.slice(-AUTH_STATE_MAX))); else s.removeItem(AUTH_STATE_KEY); } catch (e) {}
  }
  function newAuthState() {
    var c = (typeof window !== "undefined" && window.crypto) || (typeof crypto !== "undefined" ? crypto : null);
    if (!c || !c.getRandomValues) return null;
    var b = new Uint8Array(32), str = "", i;
    c.getRandomValues(b);
    for (i = 0; i < b.length; i++) str += String.fromCharCode(b[i]);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function sameString(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    var d = 0, i; for (i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  }

  // Shown when a sign-in link cannot be completed in this browser. Deliberately the same
  // for every cause (other browser, expired, forged, malformed) and free of any token,
  // state or address, so it reveals nothing about whether a link, account or email exists.
  var SIGNIN_REFUSED_MESSAGE = "This sign-in link can't be used in this browser. " +
    "Open it in the same browser where you requested it, or request a new sign-in link.";
  var signInRefused = false;
  function showSignInNotice() {
    if (typeof document === "undefined" || !document || !document.createElement) return;
    function render() {
      try {
        if (!document.body || document.getElementById("aced-signin-notice")) return;
        var box = document.createElement("div");
        box.id = "aced-signin-notice";
        box.setAttribute("role", "alert");
        box.style.cssText = "position:fixed;top:12px;left:12px;right:12px;margin:0 auto;max-width:560px;z-index:2147483647;" +
          "box-sizing:border-box;display:flex;gap:12px;align-items:flex-start;padding:12px 14px;" +
          "background:#111;color:#fff;border:2px solid #ffb627;border-radius:8px;font:15px/1.4 system-ui,sans-serif";
        var text = document.createElement("span");
        text.textContent = SIGNIN_REFUSED_MESSAGE;
        var close = document.createElement("button");
        close.type = "button";
        close.textContent = "Dismiss";
        close.setAttribute("aria-label", "Dismiss sign-in message");
        close.style.cssText = "flex:none;font:inherit;color:#111;background:#ffb627;border:0;border-radius:4px;padding:4px 10px;cursor:pointer";
        close.onclick = function () { try { if (box.parentNode) box.parentNode.removeChild(box); } catch (e) {} };
        box.appendChild(text);
        box.appendChild(close);
        document.body.insertBefore(box, document.body.firstChild);
      } catch (e) {}
    }
    if (document.body) render();
    else if (document.addEventListener) document.addEventListener("DOMContentLoaded", render);
  }

  // 1) Capture a token handed back in the URL fragment by the pre-Phase-A /auth/verify, then clean the URL.
  //    The server no longer issues #token= links (see step 1b); this path stays state-bound.
  //    The fragment is ALWAYS scrubbed; the token is kept only if its state matches a
  //    pending sign-in from this browser. A rejected token never replaces a current session,
  //    suppresses sync for this page load, and shows the neutral notice above.
  (function captureFragmentToken() {
    try {
      if (location.hash && location.hash.indexOf("token=") >= 0) {
        var params = new URLSearchParams(location.hash.slice(1));
        var tok = params.get("token"), st = params.get("state");
        try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
        var pending = readStates(), match = false, i;
        for (i = 0; i < pending.length; i++) { if (sameString(st, pending[i].s)) match = true; }
        if (match && tok && JWT_SHAPE.test(tok)) {
          setTok(tok);
          writeStates([]);                       // single use: clear every pending sign-in
        } else {
          writeStates(pending);                  // prune expired entries only
          signInRefused = true;
          showSignInNotice();
        }
      }
    } catch (e) {}
  })();

  // Guard every network call with a timeout so a cold/hung backend (Render free
  // tier can cold-start ~15-20s) can't leave a request pending forever. Uses
  // AbortController when available and always clears the timer.
  var API_TIMEOUT_MS = 20000;
  function fetchT(url, init, ms) {
    init = init || {};
    var ac = (typeof AbortController !== "undefined") ? new AbortController() : null;
    if (ac) init.signal = ac.signal;
    var timer = setTimeout(function () { try { if (ac) ac.abort(); } catch (e) {} }, ms || API_TIMEOUT_MS);
    return fetch(url, init).then(
      function (r) { clearTimeout(timer); return r; },
      function (err) { clearTimeout(timer); throw err; }
    );
  }

  // 1b) Scanner-safe sign-in. The emailed link is APP_URL/#signin=<one-time token>. A fragment
  //     never reaches a server, so fetching or previewing the link authenticates nothing and
  //     consumes nothing. On load the fragment is scrubbed at once and the code is kept in
  //     memory only. Nothing is sent until the user confirms in this browser; the redeem
  //     request carries this browser's pending states, which the server checks against the
  //     state recorded when the link was requested. Without a pending state (another browser,
  //     a link preview, an automated fetch) the link is refused locally with the neutral notice.
  var SIGNIN_CODE_RE = /^[a-f0-9]{48}$/;
  var pendingCode = null;
  function removeConfirm() {
    try { var el = document.getElementById("aced-signin-confirm"); if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
  }
  function showConfirm() {
    if (typeof document === "undefined" || !document || !document.createElement) return;
    function render() {
      try {
        if (!pendingCode || !document.body || document.getElementById("aced-signin-confirm")) return;
        var box = document.createElement("div");
        box.id = "aced-signin-confirm";
        box.setAttribute("role", "dialog");
        box.setAttribute("aria-label", "Confirm sign-in");
        box.style.cssText = "position:fixed;top:12px;left:12px;right:12px;margin:0 auto;max-width:560px;z-index:2147483647;" +
          "box-sizing:border-box;display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:12px 14px;" +
          "background:#111;color:#fff;border:2px solid #4dff9e;border-radius:8px;font:15px/1.4 system-ui,sans-serif";
        var text = document.createElement("span");
        text.textContent = "Finish signing in to ACED in this browser?";
        var yes = document.createElement("button");
        yes.type = "button";
        yes.textContent = "Sign in";
        yes.style.cssText = "flex:none;font:inherit;color:#111;background:#4dff9e;border:0;border-radius:4px;padding:4px 12px;cursor:pointer";
        yes.onclick = function () { ACEDAccount.confirmSignIn(); };
        var no = document.createElement("button");
        no.type = "button";
        no.textContent = "Cancel";
        no.style.cssText = "flex:none;font:inherit;color:#fff;background:transparent;border:1px solid #888;border-radius:4px;padding:4px 12px;cursor:pointer";
        no.onclick = function () { pendingCode = null; removeConfirm(); activate(); };
        box.appendChild(text);
        box.appendChild(yes);
        box.appendChild(no);
        document.body.insertBefore(box, document.body.firstChild);
        try { if (yes.focus) yes.focus(); } catch (e) {}
      } catch (e) {}
    }
    if (document.body) render();
    else if (document.addEventListener) document.addEventListener("DOMContentLoaded", render);
  }
  function refuseSignIn() {
    pendingCode = null;
    removeConfirm();
    signInRefused = true;
    showSignInNotice();
  }
  function captureSignInCode() {
    try {
      if (!location.hash || location.hash.indexOf("signin=") < 0) return;
      var code = new URLSearchParams(location.hash.slice(1)).get("signin");
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
      if (API && code && SIGNIN_CODE_RE.test(code) && readStates().length) {
        pendingCode = code;
        showConfirm();
      } else {
        refuseSignIn();
      }
    } catch (e) {}
  }
  captureSignInCode();

  // Account-switch guard. Local progress belongs to whichever account first synced it in
  // this browser. If a different account signs in here, sync is held (nothing pushed,
  // nothing pulled), so one account's progress is never uploaded into another and no local
  // history is overwritten. Tokens whose account can't be read locally keep the old behaviour;
  // the server rejects such tokens anyway.
  var SYNC_OWNER_KEY = "aced_sync_owner";
  var syncHeld = false;
  function sessionSub(t) {
    try {
      var p = String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      while (p.length % 4) p += "=";
      var o = JSON.parse(atob(p));
      return o && typeof o.sub === "string" && o.sub ? o.sub : null;
    } catch (e) { return null; }
  }
  function ownerAllowsSync(tok) {
    var sub = sessionSub(tok), s = ls(), owner = null;
    if (!sub) return true;
    try { owner = s ? s.getItem(SYNC_OWNER_KEY) : null; } catch (e) { owner = null; }
    if (!owner) { try { if (s) s.setItem(SYNC_OWNER_KEY, sub); } catch (e) {} return true; }
    return owner === sub;
  }
  function resetBackend() {
    try { if (window.ACEDCore && ACEDCore.backend) ACEDCore.backend.configure({ endpoint: null, token: null }); } catch (e) {}
  }

  function api(path, opts) {
    if (!API) return Promise.reject(new Error("no-api"));
    opts = opts || {};
    var headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    var tok = getTok(); if (tok) headers.Authorization = "Bearer " + tok;
    return fetchT(API + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      if (r.status === 401) { setTok(null); }       // stale session — drop it, fall back to local
      return r.json().catch(function () { return {}; });
    });
  }

  // 2) If we have a session + API + the core's backend, configure it and hydrate.
  //    push-then-pull: send local progress first so anything earned offline is merged
  //    (mastery/streak take the max server-side), then pull the merged result back.
  var ready = Promise.resolve();
  //    A refused sign-in link skips this entirely for the current page load: no backend is
  //    configured and nothing is uploaded, even if an earlier valid session is still stored.
  //    The same holds while an emailed link waits for confirmation, and when the session
  //    belongs to a different account than this browser's progress (account switch).
  function activate() {
    if (signInRefused || pendingCode) return;
    if (!API || !getTok() || !window.ACEDCore || !ACEDCore.backend) return;
    if (!ownerAllowsSync(getTok())) { syncHeld = true; return; }
    try {
      ACEDCore.backend.configure({ endpoint: API, token: getTok() });
      if (ACEDCore.sync && ACEDCore.sync.isEnabled && ACEDCore.sync.isEnabled()) {
        ready = ACEDCore.sync.push()
          .then(function () { return ACEDCore.sync.pull(); })
          .then(function (r) { try { if (r && r.applied && window.ACEDFX) ACEDFX.toast && ACEDFX.toast("Progress synced.", ACEDFX.palette.cyan); } catch (e) {} })
          .catch(function () {});
      }
    } catch (e) {}
  }
  activate();

  var ACEDAccount = {
    ready: function () { return ready; },
    isSignedIn: function () { return !!getTok(); },
    signInNotice: function () { return signInRefused ? SIGNIN_REFUSED_MESSAGE : null; },   // neutral text, or null
    signInPending: function () { return !!pendingCode; },
    syncHeld: function () { return syncHeld; },
    // The intentional browser action that completes an emailed sign-in. Sends the one-time
    // code with this browser's pending states; on success the session is stored and sync
    // starts. Any refusal keeps the existing session, uploads nothing and shows the neutral
    // notice. The redeem request never carries the existing session token.
    confirmSignIn: function () {
      var code = pendingCode;
      if (!code) return Promise.resolve({ ok: false });
      pendingCode = null;
      removeConfirm();
      var states = readStates().map(function (x) { return x.s; });
      if (!API || !states.length) { refuseSignIn(); return Promise.resolve({ ok: false }); }
      return fetchT(API + "/auth/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: code, states: states })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (b) {
          if (r.status === 200 && b && typeof b.session === "string" && JWT_SHAPE.test(b.session)) {
            setTok(b.session);
            writeStates([]);                     // single use: clear every pending sign-in
            activate();
            return { ok: true };
          }
          refuseSignIn();
          return { ok: false };
        });
      }, function () { refuseSignIn(); return { ok: false }; });
    },
    token: function () { return getTok(); },   // leagues.js authHeader() reads this
    email: function () { try { var t = getTok(); if (!t) return null; var p = JSON.parse(atob(t.split(".")[1])); return p.email || null; } catch (e) { return null; } },

    signIn: function (email) {
      if (!API) return Promise.reject(new Error("Sync isn't configured on this build."));
      var state = newAuthState();
      if (!state) return Promise.reject(new Error("This browser can't sign in securely."));
      var pending = readStates(); pending.push({ s: state, exp: Date.now() + AUTH_STATE_TTL_MS }); writeStates(pending);
      return api("/auth/request", { method: "POST", body: { email: String(email || "").trim(), state: state } })
        .then(function (res) {
          if (res && res.devLink) {                                   // local dev convenience
            try { location.href = res.devLink; } catch (e) {}
            captureSignInCode();                                      // same-page link: no reload happens
          }
          return res;
        });
    },
    // Drops the local session at once (local play continues, no further sync) and asks the
    // server to revoke it, so a copied token can't be replayed after sign-out.
    signOut: function () {
      var t = getTok();
      setTok(null);
      resetBackend();
      if (!API || !t) return Promise.resolve({ ok: true, revoked: false });
      return fetchT(API + "/auth/signout", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t } })
        .then(function (r) { return { ok: true, revoked: r.status === 200 }; }, function () { return { ok: true, revoked: false }; });
    },

    // GET /entitlements is Bearer-only server-side, so an anonymous call can never succeed —
    // it just burns a round trip and logs a network/CORS error on every signed-out page load.
    // Resolve empty locally instead, matching what the failed request already fell back to.
    entitlements: function () {
      if (!API || !getTok()) return Promise.resolve([]);
      return api("/entitlements").then(function (r) { return (r && r.packs) || []; }).catch(function () { return []; });
    },
    has: function (pid) { return this.entitlements().then(function (list) { return list.indexOf(pid || packId()) >= 0; }); },

    checkout: function (pid) {
      if (!API) return Promise.reject(new Error("Billing isn't configured on this build."));
      if (!getTok()) return Promise.reject(new Error("Sign in first."));
      return api("/billing/checkout", { method: "POST", body: { pack: pid || packId() } })
        .then(function (r) { if (r && r.url) location.href = r.url; else throw new Error((r && r.error) || "checkout failed"); });
    },

    // Revoke every session for this account (e.g. lost device), then clear the local
    // token so this device falls back to local-only play immediately.
    signOutEverywhere: function () {
      if (!API || !getTok()) { setTok(null); resetBackend(); return Promise.resolve({ ok: true }); }
      return api("/auth/signout-all", { method: "POST" }).then(function (r) { setTok(null); resetBackend(); return r; });
    },
    // Opt IN to the public leaderboard under a display handle (2-24 chars; the server
    // sanitizes). Until this is called the user is invisible on the board.
    leaderboardOptIn: function (handle) {
      if (!API) return Promise.reject(new Error("Sync isn't configured on this build."));
      if (!getTok()) return Promise.reject(new Error("Sign in first."));
      return api("/leaderboard/optin", { method: "POST", body: { handle: String(handle || "").trim() } });
    },
    // Opt OUT — remove the handle and disappear from the public board.
    leaderboardOptOut: function () {
      if (!API) return Promise.resolve({ ok: true });
      if (!getTok()) return Promise.reject(new Error("Sign in first."));
      return api("/leaderboard/optout", { method: "POST" });
    },

    /* Gate a paid pack. Resolves true if entitled; otherwise redirects to `opt.redirect`
       (default the landing paywall) and resolves false. Free packs/no-API => always true. */
    requireEntitlement: function (pid, opt) {
      opt = opt || {};
      if (!API) return Promise.resolve(true);                 // unconfigured build stays fully open
      pid = pid || packId();
      var self = this;
      return self.entitlements().then(function (list) {
        if (list.indexOf(pid) >= 0) return true;
        var dest = opt.redirect || ("/?upgrade=" + pid);
        if (!opt.noRedirect) { try { location.href = dest; } catch (e) {} }
        return false;
      });
    }
  };

  if (typeof window !== "undefined") window.ACEDAccount = ACEDAccount;
})();
