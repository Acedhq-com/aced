/* ACED — aced-fx.js  ·  the "game feel" + virality layer
   ============================================================================
   A small, dependency-free presentation module the game pages can call into.
   It is the live replacement for the unwired juice.js draft: it exposes ONLY
   visceral feedback + a share helper, and it deliberately does NOT own any
   daily/streak/XP state (aced-core.js + aced-progress.js own that). So it can
   be loaded next to them with zero conflict.

     ACEDFX.sfx          compact chiptune SFX (its own AudioContext, shared mute)
     ACEDFX.burst        pixel-particle burst at (x,y)
     ACEDFX.crit         floating crit number ("FULL HOUSE!", "+1840")
     ACEDFX.flash        full-screen colour wash
     ACEDFX.shake        screen shake (no-op if the host already shakes)
     ACEDFX.combo        answer-streak engine for the Pop Quiz (hit/miss)
     ACEDFX.teach        one-time coach-mark that names the loop as it's felt
     ACEDFX.ach          achievements: unlock() fires a toast + burst, once
     ACEDFX.grid         spoiler-free Wordle-style result text (the viral share)
     ACEDFX.copy         one-tap clipboard copy with a textarea fallback
     ACEDFX.setMuted / isMuted

   Everything is wrapped so a missing DOM node or a sandboxed browser never
   throws. Respects prefers-reduced-motion (drops motion, keeps text + sound)
   and stays in sync with the game's existing "aced_muted" flag.
   Load AFTER aced-core.js. Safe to load on every page.
   ============================================================================ */
(function () {
  "use strict";

  var PALETTE = {
    green: "#22ff66", amber: "#ffb627", cyan: "#5cffea", gold: "#ffd23f",
    money: "#9be36b", red: "#ff5238", magenta: "#ff5cb8", white: "#d8f5d8"
  };

  /* ---- environment guards ------------------------------------------------ */
  var REDUCE = false;
  try { REDUCE = window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches; } catch (e) {}
  function ls() { try { return window["local" + "Storage"]; } catch (e) { return null; } }
  function lsGet(k) { var s = ls(); if (!s) return null; try { return s.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { var s = ls(); if (!s) return; try { s.setItem(k, v); } catch (e) {} }

  /* ---- mute (shares the game's existing aced_muted key) ------------------ */
  var _muted = lsGet("aced_muted") === "1";
  function setMuted(v) { _muted = !!v; lsSet("aced_muted", _muted ? "1" : "0"); }
  function isMuted() { return _muted; }

  /* ---- audio (own context; tiny chiptune synth) -------------------------- */
  var _ctx = null, MASTER = 0.32;
  function ac() {
    if (_muted) return null;
    if (!_ctx) { try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (_ctx.state === "suspended") { try { _ctx.resume(); } catch (e) {} }
    return _ctx;
  }

  // iOS/Safari autoplay unlock: an AudioContext only starts from inside a real user
  // gesture. On the first tap/click we instantiate + resume it and play a 1-sample
  // silent buffer, so sfx fired later from setTimeout/promises (end-of-run boom,
  // async DB saves) aren't silently blocked. Primes even when muted so a later
  // unmute has a live context; the buffer is inaudible.
  (function () {
    var done = false;
    function unlock() {
      if (done) return; done = true;
      try {
        if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (_ctx.state === "suspended") _ctx.resume();
        var b = _ctx.createBuffer(1, 1, 22050), s = _ctx.createBufferSource();
        s.buffer = b; s.connect(_ctx.destination); s.start(0);
      } catch (e) {}
      document.removeEventListener("touchend", unlock, true);
      document.removeEventListener("click", unlock, true);
    }
    document.addEventListener("touchend", unlock, true);
    document.addEventListener("click", unlock, true);
  })();
  function tone(freq, dur, type, vol, atk, rel) {
    var c = ac(); if (!c) return;
    type = type || "square"; vol = vol == null ? 0.2 : vol; atk = atk || 0.005; rel = rel || 0.05;
    var t0 = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol * MASTER, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + rel);
    o.onended = function () { try { o.disconnect(); g.disconnect(); } catch (e) {} };
  }
  function sweep(f1, f2, dur, type, vol) {
    var c = ac(); if (!c) return;
    type = type || "sawtooth"; vol = vol == null ? 0.18 : vol;
    var t0 = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f1, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol * MASTER, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
    o.onended = function () { try { o.disconnect(); g.disconnect(); } catch (e) {} };
  }
  function noise(dur, vol, hp) {
    var c = ac(); if (!c) return;
    vol = vol == null ? 0.14 : vol; hp = hp || 1000;
    var t0 = c.currentTime, n = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0), i;
    for (i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = c.createBufferSource(); src.buffer = buf;
    var filt = c.createBiquadFilter(); filt.type = "highpass"; filt.frequency.value = hp;
    var g = c.createGain(); g.gain.value = vol * MASTER;
    src.connect(filt); filt.connect(g); g.connect(c.destination);
    src.start(t0); src.stop(t0 + dur + 0.05);
    src.onended = function () { try { src.disconnect(); filt.disconnect(); g.disconnect(); } catch (e) {} };
  }
  function seq(notes, step, dur, type, vol) {
    notes.forEach(function (f, i) { setTimeout(function () { tone(f, dur || 0.11, type || "square", vol == null ? 0.22 : vol); }, i * (step || 60)); });
  }
  var sfx = {
    select: function () { tone(820, 0.05, "square", 0.10); },
    tick:   function () { tone(760, 0.03, "square", 0.07); },
    chips:  function (n) { var b = 600 + Math.min(800, (n || 0) * 4); tone(b, 0.05, "triangle", 0.16); setTimeout(function () { tone(b * 1.5, 0.05, "triangle", 0.14); }, 35); },
    big:    function () { seq([523, 659, 784, 1046], 70, 0.12, "triangle", 0.16); },
    boom:   function () { seq([392, 523, 659, 784, 1046, 1318], 60, 0.13, "triangle", 0.18); setTimeout(function () { noise(0.4, 0.12, 1500); }, 80); },
    coin:   function () { tone(880, 0.05, "square", 0.12); setTimeout(function () { tone(1170, 0.07, "square", 0.12); }, 50); },
    correct:function () { tone(660, 0.08, "square", 0.22); setTimeout(function () { tone(990, 0.10, "square", 0.20); }, 70); },
    wrong:  function () { sweep(220, 80, 0.35, "sawtooth", 0.22); noise(0.18, 0.10, 600); },
    combo:  function (tier) { var base = 440 * Math.pow(1.32, tier || 1); tone(base, 0.07, "square", 0.20); setTimeout(function () { tone(base * 1.25, 0.07, "square", 0.20); }, 70); if ((tier || 0) >= 3) setTimeout(function () { tone(base * 1.5, 0.10, "square", 0.22); }, 150); },
    achieve:function () { seq([784, 988, 1319, 1568], 90, 0.12, "triangle", 0.24); },
    lose:   function () { [330, 247, 196, 147].forEach(function (f, i) { setTimeout(function () { tone(f, 0.2, "sawtooth", 0.18); }, i * 120); }); }
  };

  /* ---- a single fixed overlay we draw particles + pops into -------------- */
  var _layer = null;
  /* ---- DOM allowlist sanitizer (no regex) --------------------------------
     Parses untrusted HTML in an inert document, then walks the tree and keeps
     ONLY safe inline formatting tags (no attributes at all). Everything else
     — scripts, event handlers, javascript:/data: URLs, unknown tags — is
     dropped, while their text content is preserved. Returns a DocumentFragment
     safe to append. Robust where regex filtering is not. */
  var SAFE_TAGS = { B:1, I:1, EM:1, STRONG:1, U:1, BR:1, SPAN:1, SMALL:1 };
  function sanitizeToFragment(html) {
    var frag = document.createDocumentFragment();
    var tpl;
    try {
      // <template> parses HTML inertly — no scripts run, no resources load.
      tpl = document.createElement("template");
      tpl.innerHTML = String(html == null ? "" : html);
    } catch (e) {
      frag.appendChild(document.createTextNode(String(html == null ? "" : html)));
      return frag;
    }
    function clean(node, out) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var c = node.childNodes[i];
        if (c.nodeType === 3) {                       // text node — always safe
          out.appendChild(document.createTextNode(c.nodeValue));
        } else if (c.nodeType === 1) {                // element
          if (SAFE_TAGS[c.tagName]) {
            var safe = document.createElement(c.tagName.toLowerCase());
            clean(c, safe);                           // recurse; copy NO attributes
            out.appendChild(safe);
          } else {
            clean(c, out);                            // drop tag, keep its text
          }
        }
        // comments / others: ignored
      }
    }
    clean(tpl.content, frag);
    return frag;
  }

  function layer() {
    if (_layer && document.body.contains(_layer)) return _layer;
    _layer = document.createElement("div");
    _layer.id = "aced-fx-layer";
    _layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9000;overflow:hidden";
    (document.body || document.documentElement).appendChild(_layer);
    return _layer;
  }

  /* ---- pixel particle burst (rAF physics, capped, self-cleaning) --------- */
  // Static device heuristic: cap particles lower on low-core / small-screen devices
  // to avoid frame drops during big bursts (e.g. a perfect clear). Decided once at load
  // — no per-frame FPS probing, so it can't oscillate or add loop cost.
  var _live = [], _raf = 0, MAXP = (function () {
    try {
      var lowCore = (navigator.hardwareConcurrency || 8) <= 4;
      var smallScreen = Math.min(screen.width || 9999, screen.height || 9999) <= 480;
      return (lowCore || smallScreen) ? 90 : 220;
    } catch (e) { return 220; }
  })();
  function tickParticles(now) {
    var L = layer(), i, p, alive = 0;
    for (i = 0; i < _live.length; i++) {
      p = _live[i]; if (!p) continue;
      var t = (now - p.t0) / p.life;
      if (t >= 1) { if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el); _live[i] = null; continue; }
      alive++;
      p.vy += 0.45;                       // gravity
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.985;
      p.el.style.transform = "translate(" + p.x.toFixed(1) + "px," + p.y.toFixed(1) + "px) rotate(" + (p.r += p.vr).toFixed(0) + "deg)";
      p.el.style.opacity = (1 - t * t).toFixed(3);
    }
    if (alive) { _raf = requestAnimationFrame(tickParticles); }
    else { _live = []; _raf = 0; }
  }
  function burst(x, y, opts) {
    if (REDUCE) return;
    opts = opts || {};
    var n = Math.min(opts.count || 22, 80);
    var colors = opts.colors || [PALETTE.green, PALETTE.gold, PALETTE.cyan, PALETTE.money];
    var spread = opts.spread || 7, size = opts.size || 7, life = opts.life || 850;
    if (x == null) x = window.innerWidth / 2; if (y == null) y = window.innerHeight / 2;
    if (_live.length > MAXP) return;
    var L = layer(), i;
    for (i = 0; i < n; i++) {
      var el = document.createElement("div");
      var col = colors[(Math.random() * colors.length) | 0];
      var s = size * (0.6 + Math.random() * 0.8);
      el.style.cssText = "position:absolute;left:0;top:0;width:" + s.toFixed(1) + "px;height:" + s.toFixed(1) +
        "px;background:" + col + ";box-shadow:0 0 6px " + col + ";will-change:transform,opacity";
      L.appendChild(el);
      var ang = Math.random() * Math.PI * 2, spd = (Math.random() * spread) + spread * 0.35;
      _live.push({ el: el, x: x, y: y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - spread * 0.6,
        r: Math.random() * 360, vr: (Math.random() * 2 - 1) * 16, t0: performance.now(), life: life * (0.7 + Math.random() * 0.6) });
    }
    if (!_raf) _raf = requestAnimationFrame(tickParticles);
  }

  /* ---- floating crit number / callout ------------------------------------ */
  function crit(text, x, y, color) {
    color = color || PALETTE.gold;
    if (x == null) x = window.innerWidth / 2; if (y == null) y = window.innerHeight * 0.4;
    var L = layer(), el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = "position:absolute;left:" + x + "px;top:" + y + "px;" +
      "font-family:'Press Start 2P',monospace;font-size:clamp(20px,5vw,40px);color:" + color + ";" +
      "text-shadow:0 0 16px " + color + ",0 0 34px " + color + ";white-space:nowrap;" +
      "transform:translate(-50%,-50%) scale(" + (REDUCE ? 1 : 0.4) + ");opacity:" + (REDUCE ? 1 : 0) + ";" +
      (REDUCE ? "" : "transition:transform 560ms cubic-bezier(.18,.89,.32,1.28),opacity 620ms;");
    L.appendChild(el);
    if (REDUCE) { setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 900); return; }
    requestAnimationFrame(function () {
      el.style.transform = "translate(-50%,-50%) scale(1.12)";
      el.style.opacity = "1";
      setTimeout(function () { el.style.transform = "translate(-50%,-160%) scale(1)"; el.style.opacity = "0"; }, 520);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1180);
    });
  }

  /* ---- full-screen colour wash ------------------------------------------- */
  var _flashEl = null;
  function flash(color, opacity) {
    if (REDUCE) return;
    color = color || "#fff"; opacity = opacity == null ? 0.32 : opacity;
    if (!_flashEl || !document.body.contains(_flashEl)) {
      _flashEl = document.createElement("div");
      _flashEl.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:8999;mix-blend-mode:screen;opacity:0;transition:opacity 90ms";
      (document.body || document.documentElement).appendChild(_flashEl);
    }
    _flashEl.style.background = color; _flashEl.style.opacity = String(opacity);
    setTimeout(function () { if (_flashEl) _flashEl.style.opacity = "0"; }, 60);
  }

  /* ---- screen shake (the host game may already do this; harmless overlap) - */
  var _shT = 0, _shMag = 0, _shRaf = 0;
  function shake(mag, dur) {
    if (REDUCE) return;
    _shMag = Math.max(_shMag, mag || 8); _shT = Math.max(_shT, dur || 280);
    if (_shRaf) return;
    var start = performance.now();
    (function step(now) {
      var dt = now - start;
      if (dt >= _shT) { document.body.style.transform = ""; _shRaf = 0; _shT = 0; _shMag = 0; return; }
      var m = _shMag * (1 - dt / _shT);
      document.body.style.transform = "translate(" + ((Math.random() * 2 - 1) * m).toFixed(1) + "px," + ((Math.random() * 2 - 1) * m).toFixed(1) + "px)";
      _shRaf = requestAnimationFrame(step);
    })(start);
  }

  /* ---- answer-streak combo engine (the Audit Moment "good-way" hook) ------
     Rewards *consecutive correct recalls* with escalating feedback. The bonus
     it returns is meant to scale MASTERY / learning feedback — never run score
     or anything purchasable — so the dopamine is tied to knowing the material,
     not to grinding. Tiers are named in plain game voice. */
  var COMBO_TIERS = [
    { at: 2,  name: "CLEAN",                color: PALETTE.green,   bonus: 1.0 },
    { at: 3,  name: "ON A ROLL",            color: PALETTE.green,   bonus: 1.15 },
    { at: 5,  name: "LOCKED IN",            color: PALETTE.cyan,    bonus: 1.3 },
    { at: 7,  name: "SHARP",                color: PALETTE.amber,   bonus: 1.5 },
    { at: 10, name: "UNSTOPPABLE",          color: PALETTE.gold,    bonus: 1.8 },
    { at: 15, name: "BULLETPROOF",          color: PALETTE.magenta, bonus: 2.2 }
  ];
  var _combo = { n: 0, best: 0 };
  try { _combo.best = parseInt(lsGet("acedfx_best_combo") || "0", 10) || 0; } catch (e) {}
  function comboTier(n) { var t = null, i; for (i = 0; i < COMBO_TIERS.length; i++) if (n >= COMBO_TIERS[i].at) t = COMBO_TIERS[i]; return t; }
  var combo = {
    get: function () { return _combo.n; },
    best: function () { return _combo.best; },
    bonus: function () { var t = comboTier(_combo.n); return t ? t.bonus : 1.0; },
    /* call on a correct audit answer; pass an optional anchor element for pops */
    hit: function (anchor) {
      _combo.n++;
      if (_combo.n > _combo.best) { _combo.best = _combo.n; lsSet("acedfx_best_combo", String(_combo.best)); }
      var prev = comboTier(_combo.n - 1), now = comboTier(_combo.n);
      var rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
      var cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      var cy = rect ? rect.top : window.innerHeight * 0.4;
      paintPill();
      if (now && now !== prev) {                 // crossed into a new tier — big moment
        var lvl = COMBO_TIERS.indexOf(now) + 1;
        sfx.combo(lvl);
        crit(now.name, window.innerWidth / 2, window.innerHeight * 0.35, now.color);
        burst(window.innerWidth / 2, window.innerHeight * 0.35, { count: 18 + lvl * 8, colors: [now.color, PALETTE.gold, PALETTE.cyan] });
        flash(now.color, 0.22); shake(5 + lvl, 240);
      } else {
        sfx.correct();
        crit("×" + _combo.n, cx, cy, PALETTE.green);
        burst(cx, cy, { count: 14, colors: [PALETTE.green, PALETTE.money] });
      }
      return { n: _combo.n, tier: now ? now.name : null, bonus: this.bonus() };
    },
    miss: function () {
      var broken = _combo.n;
      if (_combo.n >= 3) { crit("STREAK BROKEN", window.innerWidth / 2, window.innerHeight * 0.4, PALETTE.red); flash(PALETTE.red, 0.2); }
      _combo.n = 0; paintPill();
      return { broken: broken };
    },
    reset: function () { _combo.n = 0; paintPill(); },
    /* optional on-screen pill; render an element with id="acedfx-combo" to show it */
    mount: function () { paintPill(); }
  };
  function paintPill() {
    var el = document.getElementById("acedfx-combo"); if (!el) return;
    if (_combo.n < 2) { el.style.opacity = "0"; el.textContent = ""; return; }
    var t = comboTier(_combo.n);
    el.textContent = "\uD83D\uDD25 " + _combo.n + "\u00d7 " + (t ? t.name : "");
    el.style.color = t ? t.color : PALETTE.green;
    el.style.opacity = "1";
    if (!REDUCE) { el.style.transform = "scale(1.18)"; setTimeout(function () { el.style.transform = "scale(1)"; }, 130); }
  }

  /* ---- achievements ------------------------------------------------------- */
  var ACH = [
    { id: "first_run",    name: "FIRST CONTACT",      desc: "Start your first run." },
    { id: "first_close",  name: "FIRST CLEAR",        desc: "Clear your first round." },
    { id: "first_boss",   name: "BOSS HUNTER",        desc: "Survive your first boss." },
    { id: "combo_5",      name: "FIVE STREAK",        desc: "5 correct answers in a row." },
    { id: "combo_10",     name: "TEN STREAK",         desc: "10 correct answers in a row." },
    { id: "flawless",     name: "FLAWLESS ROUND",     desc: "Clear a round with no missed quiz." },
    { id: "calibrated",   name: "WELL-CALIBRATED",    desc: "Reach a B+ calibration grade." },
    { id: "ready_60",     name: "ON TRACK",          desc: "Reach 60% topic game progress." },
    { id: "streak_7",     name: "SEVEN-DAY STREAK",  desc: "A 7-day Daily Run streak." },
    { id: "daily",        name: "DAILY GRIND",        desc: "Complete a Daily Run." },
    { id: "share",        name: "WORD OF MOUTH",      desc: "Share a result." },
    { id: "first_partner",name: "RUN COMPLETE",      desc: "Finish a full run." }
  ];
  function achStore() { try { return JSON.parse(lsGet("acedfx_ach") || "{}"); } catch (e) { return {}; } }
  var ach = {
    list: ACH,
    has: function (id) { return !!achStore()[id]; },
    unlocked: function () { return achStore(); },
    count: function () { var s = achStore(), c = 0, k; for (k in s) if (s.hasOwnProperty(k)) c++; return c; },
    unlock: function (id) {
      var s = achStore(); if (s[id]) return false;
      s[id] = Date.now(); lsSet("acedfx_ach", JSON.stringify(s));
      var a = null, i; for (i = 0; i < ACH.length; i++) if (ACH[i].id === id) a = ACH[i];
      if (a) {
        sfx.achieve();
        toast("\uD83C\uDFC6 " + a.name + " \u2014 " + a.desc, PALETTE.gold);
        crit("ACHIEVEMENT", window.innerWidth / 2, window.innerHeight * 0.2, PALETTE.gold);
        burst(window.innerWidth / 2, window.innerHeight * 0.2, { count: 40, colors: [PALETTE.gold, PALETTE.amber, PALETTE.cyan] });
        try { if (window.ACEDCore) ACEDCore.analytics.track("achievement_unlocked", { id: id }); } catch (e) {}
      }
      return true;
    }
  };

  /* ---- lightweight toast (its own stack; independent of the game's) ------- */
  function toast(text, color) {
    var L = layer(), el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = "position:absolute;left:50%;bottom:6%;transform:translate(-50%,12px);" +
      "max-width:min(92vw,560px);padding:11px 16px;background:#0a160a;border:1px solid " + (color || PALETTE.green) + ";" +
      "color:" + (color || PALETTE.white) + ";font-family:'VT323',ui-monospace,monospace;font-size:19px;line-height:1.25;" +
      "box-shadow:0 0 18px rgba(0,0,0,.6);opacity:0;transition:opacity 180ms,transform 180ms;text-align:center";
    L.appendChild(el);
    requestAnimationFrame(function () { el.style.opacity = "1"; el.style.transform = "translate(-50%,0)"; });
    setTimeout(function () { el.style.opacity = "0"; el.style.transform = "translate(-50%,12px)"; }, 2800);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3050);
  }

  /* ---- teaching coach-mark (the onboarding "name the thing" beat) ---------
     A one-time contextual tooltip anchored to an element, in the same visual
     language as the toast. It teaches the core loop the instant the player
     feels it (e.g. "that's chips x mult", right as the score lands), instead
     of front-loading rules. Under reduced-motion it appears without the slide.
     Returns a Promise that resolves once it has faded, so first-run code can
     `await ACEDFX.teach(...)` to hold a beat before the next thing. */
  function teach(anchor, html, opts) {
    return new Promise(function (resolve) {
      try {
        opts = opts || {};
        var color = opts.color || PALETTE.cyan;
        var hold = opts.hold == null ? 1900 : opts.hold;
        var below = opts.place === "below";
        var off = REDUCE ? "0" : (below ? "-6px" : "6px");
        var L = layer(), el = document.createElement("div");
        el.setAttribute("role", "status");
        // Render with a DOM-based allowlist sanitizer (NOT regex). teach() text is
        // hardcoded today, but community/AI packs could route untrusted strings here.
        // sanitizeToFragment parses the input, keeps only safe formatting tags
        // (<b>,<i>,<em>,<strong>,<br>,<u>,<span>), drops everything else (scripts,
        // event handlers, javascript: URLs, unknown tags) — closes the CodeQL
        // "incomplete sanitization / bad HTML filtering / URL scheme" findings.
        if (typeof html === "string") {
          el.appendChild(sanitizeToFragment(html));
        } else if (html instanceof Node) {
          el.appendChild(html);
        }
        el.style.cssText = "position:absolute;max-width:min(86vw,320px);padding:9px 13px;" +
          "background:#001016;border:1px solid " + color + ";color:" + color + ";" +
          "font-family:'VT323',ui-monospace,monospace;font-size:18px;line-height:1.25;" +
          "border-radius:6px;box-shadow:0 0 18px rgba(0,0,0,.55);text-align:center;z-index:9001;" +
          "opacity:0;transform:translateY(" + off + ");transition:opacity 200ms ease,transform 200ms ease;pointer-events:none";
        L.appendChild(el);
        var r = (anchor && anchor.getBoundingClientRect) ? anchor.getBoundingClientRect() : null;
        var w = el.offsetWidth, h = el.offsetHeight;
        var cx = r ? (r.left + r.width / 2) : (window.innerWidth / 2);
        var top = r ? (below ? r.bottom + 12 : r.top - h - 12) : (window.innerHeight * 0.62);
        top = Math.max(8, Math.min(window.innerHeight - h - 8, top));
        var left = Math.max(8, Math.min(window.innerWidth - w - 8, cx - w / 2));
        el.style.left = left + "px"; el.style.top = top + "px";
        requestAnimationFrame(function () { el.style.opacity = "1"; el.style.transform = "translateY(0)"; });
        setTimeout(function () {
          el.style.opacity = "0"; el.style.transform = "translateY(" + off + ")";
          setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); resolve(true); }, 240);
        }, hold);
      } catch (e) { resolve(false); }
    });
  }

  /* ---- spoiler-free share grid (the free distribution flywheel) ----------
     Produces a short, copy-pasteable block that renders inline in Discord,
     Reddit, iMessage, WhatsApp, Slack — anywhere text goes. No question text,
     no answers: just a Wordle-style row of how the run went, plus the URL.
       result square legend:
         correct + backed it (MED/HIGH) ........ green
         correct but hedged (LOW) .............. yellow
         missed ................................ black
   */
  var SQ = { hit: "\uD83D\uDFE9", hedge: "\uD83D\uDFE8", miss: "\u2B1B" }; // 🟩 🟨 ⬛
  function squaresFrom(results) {
    return (results || []).map(function (r) {
      if (!r || !r.correct) return SQ.miss;
      var c = (r.confidence || "").toUpperCase();
      return (c === "LOW") ? SQ.hedge : SQ.hit;
    }).join("");
  }
  function grid(opts) {
    opts = opts || {};
    var section = opts.section || "ACED";
    var label = opts.label || "Daily Run";
    var url = opts.url || "acedhq.com";
    var squares = opts.squares || (opts.results ? squaresFrom(opts.results) : "");
    var lines = [];
    lines.push("ACED \u2014 " + section + " " + label);
    if (squares) lines.push(squares);
    var meta = [];
    var progress=Object.getOwnPropertyDescriptor(opts,"readiness");
    if(progress)meta.push(Object.prototype.hasOwnProperty.call(progress,"value")&&typeof progress.value==="number"&&isFinite(progress.value)?
      "GAME PROGRESS "+Math.round(progress.value)+"%":"Game progress not available.");
    if (opts.calib) meta.push("CONFIDENCE BETS " + opts.calib);
    if (opts.streak) meta.push("\uD83D\uDD25 " + opts.streak + "-day");
    if (meta.length) lines.push(meta.join(" \u00b7 "));
    if (opts.score != null) lines.push("Score " + Number(opts.score).toLocaleString());
    lines.push(url);
    return lines.join("\n");
  }

  /* one-tap copy: Clipboard API with a hidden-textarea fallback (older Safari) */
  function copy(text) {
    return new Promise(function (resolve) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(fallback(text)); });
          return;
        }
      } catch (e) {}
      resolve(fallback(text));
    });
    function fallback(t) {
      try {
        var ta = document.createElement("textarea");
        ta.value = t; ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand && document.execCommand("copy");
        document.body.removeChild(ta); return !!ok;
      } catch (e) { return false; }
    }
  }

  window.ACEDFX = {
    version: 2,
    palette: PALETTE,
    sfx: sfx,
    burst: burst, crit: crit, flash: flash, shake: shake, toast: toast, teach: teach,
    combo: combo, ach: ach,
    grid: grid, squaresFrom: squaresFrom, copy: copy,
    setMuted: setMuted, isMuted: isMuted,
    reduced: function () { return REDUCE; }
  };
})();
