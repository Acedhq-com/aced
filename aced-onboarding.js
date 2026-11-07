/*!
 * aced-onboarding.js — first-run "how a close works" overlay for ACED
 * -------------------------------------------------------------------
 * Additive progressive enhancement. Include ONCE per page you want it on:
 *
 *     <script src="aced-onboarding.js" defer></script>
 *
 * By default it shows the first time a browser lands on the page, then never
 * again (localStorage). It rewrites nothing and depends on nothing.
 *
 *   • Auto-show once ...... on by default; disable with data-auto="false"
 *                           on the script tag, or window.ACED_ONBOARDING_OPTS.
 *   • Re-open any time .... call  ACEDOnboarding.show()  (wire a "How to play"
 *                           button to it).
 *   • Force / reset ....... ?tutorial=1  shows it,  ?tutorial=reset  clears the
 *                           "seen" flag (handy for testing).
 *
 * Styling reads your CRT theme vars (var(--crt-green) etc.) with hard fallbacks,
 * so it looks right whether or not theme.css has loaded first.
 */
(function () {
  'use strict';
  if (window.ACEDOnboarding) return;               // never double-init

  // Capture the executing <script> now so we can read its data-* attributes.
  var THIS_SCRIPT = document.currentScript || null;

  var DEFAULTS = {
    autoShow: true,
    storageKey: 'aced_onboarding_v2',              // bump the suffix to re-show after a copy change
    title: 'HOW A RUN WORKS',
    subtitle: 'Play the casual game, with optional question practice between rounds.',
    sessionName: 'aced_onboarding.session',
    steps: [
      {
        label: 'STEP 1 \u00b7 THE ROUND', color: 'green',
        body: 'Each round has a score target. Play poker hands for chips \u00d7 multiplier \u2014 jokers bend the math. Beat the target to advance.'
      },
      {
        label: 'STEP 2 \u00b7 POP QUIZ', color: 'amber',
        body: 'After clearing a round, you can choose optional question practice. Call your confidence \u2014 LOW / MED / HIGH \u2014 before answering. Confidence changes this question\u2019s game rewards and risk.'
      },
      {
        label: 'STEP 3 \u00b7 THE SHOP', color: 'amber',
        body: 'Between rounds you cash out and shop: spend chips on jokers that bend scoring, grab a voucher, or reroll for new options. The right buys compound \u2014 they can turn a losing board into a blowout.'
      },
      {
        label: 'STEP 4 \u00b7 GAME PROGRESS', color: 'cyan',
        body: 'Game progress increases through cards, answers and game rewards. It is not a measure of recall or a prediction of test performance. Questions are optional; full casual-game access remains available. See recording details for submitted answers.'
      }
    ],
    primaryLabel: 'START MY FIRST RUN',
    skipLabel: 'skip',
    // Set to '' to hide the footer nudge.
    cheatSheetUrl: '',
    cheatSheetLabel: ''
  };

  // ---- merge options: window global wins, then script data-*, then defaults ----
  var CFG = {};
  (function mergeOpts() {
    var k;
    for (k in DEFAULTS) if (DEFAULTS.hasOwnProperty(k)) CFG[k] = DEFAULTS[k];
    if (THIS_SCRIPT) {
      if (THIS_SCRIPT.getAttribute('data-auto') === 'false') CFG.autoShow = false;
      var ds = THIS_SCRIPT.getAttribute('data-storage-key');
      if (ds) CFG.storageKey = ds;
    }
    var g = window.ACED_ONBOARDING_OPTS;
    if (g && typeof g === 'object') for (k in g) if (g.hasOwnProperty(k)) CFG[k] = g[k];
  })();

  // ---- storage (never throw; blocked storage just means it shows this load) ----
  function seen() {
    try { return localStorage.getItem(CFG.storageKey) === '1'; } catch (e) { return false; }
  }
  function markSeen() {
    try { localStorage.setItem(CFG.storageKey, '1'); } catch (e) {}
  }
  function reset() {
    try { localStorage.removeItem(CFG.storageKey); } catch (e) {}
  }

  // ---- one-time <style> injection, namespaced to avoid collisions ----
  function injectStyles() {
    if (document.getElementById('aced-ob-style')) return;
    var css =
      '.aced-ob-back{position:fixed;inset:0;z-index:2147483000;display:flex;' +
      'align-items:center;justify-content:center;padding:16px;box-sizing:border-box;' +
      'background:rgba(0,0,0,.82);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);' +
      'opacity:0;transition:opacity .18s ease;font-family:"VT323",monospace}' +
      '.aced-ob-back.aced-ob-in{opacity:1}' +
      '.aced-ob-back::before{content:"";position:absolute;inset:0;pointer-events:none;' +
      'background:repeating-linear-gradient(0deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) 2px,rgba(0,0,0,.18) 3px);' +
      'mix-blend-mode:multiply}' +
      '.aced-ob-panel{position:relative;width:100%;max-width:460px;max-height:90vh;overflow:auto;' +
      'box-sizing:border-box;padding:18px 20px 20px;border:1px solid var(--crt-green-dim,#1c8a0a);' +
      'background:linear-gradient(180deg,var(--panel,#0c170c) 0%,var(--panel-2,#08110a) 100%);' +
      'box-shadow:0 0 22px rgba(57,255,20,.28),inset 0 0 40px rgba(0,0,0,.5);' +
      'transform:translateY(6px) scale(.99);transition:transform .18s ease}' +
      '.aced-ob-back.aced-ob-in .aced-ob-panel{transform:none}' +
      '.aced-ob-bar{display:flex;align-items:center;justify-content:space-between;' +
      'font-family:"Press Start 2P",monospace;font-size:7px;letter-spacing:1px;' +
      'color:var(--crt-grey,#5a6a55);border-bottom:1px dashed var(--border,#1f3a1f);' +
      'padding-bottom:8px;margin-bottom:12px}' +
      '.aced-ob-cur{color:var(--crt-green,#39ff14);animation:aced-ob-blink 1s steps(1) infinite}' +
      '@keyframes aced-ob-blink{50%{opacity:0}}' +
      '.aced-ob-close{position:absolute;top:10px;right:10px;font-family:"Press Start 2P",monospace;' +
      'font-size:10px;line-height:1;color:var(--crt-grey,#5a6a55);background:transparent;border:0;' +
      'cursor:pointer;padding:4px}' +
      '.aced-ob-close:hover{color:var(--crt-red,#ff3b3b)}' +
      '.aced-ob-title{font-family:"Press Start 2P",monospace;font-size:13px;letter-spacing:1px;' +
      'color:var(--crt-green,#39ff14);text-shadow:0 0 8px var(--crt-green,#39ff14);margin:0 0 6px}' +
      '.aced-ob-sub{font-size:17px;color:var(--crt-grey,#5a6a55);line-height:1.2;margin:0 0 12px}' +
      '.aced-ob-step{border-top:1px dashed var(--border,#1f3a1f);padding:11px 0 2px}' +
      '.aced-ob-step:first-of-type{border-top:0}' +
      '.aced-ob-lbl{display:inline-block;font-family:"Press Start 2P",monospace;font-size:8px;' +
      'letter-spacing:1px;margin-bottom:6px}' +
      '.aced-ob-lbl.green{color:var(--crt-green,#39ff14);text-shadow:0 0 4px var(--crt-green,#39ff14)}' +
      '.aced-ob-lbl.amber{color:var(--crt-amber,#ffb000);text-shadow:0 0 4px var(--crt-amber,#ffb000)}' +
      '.aced-ob-lbl.cyan{color:var(--crt-cyan,#00e6ff);text-shadow:0 0 4px var(--crt-cyan,#00e6ff)}' +
      '.aced-ob-body{font-size:18px;line-height:1.28;color:var(--crt-green,#39ff14);opacity:.92;margin:0}' +
      '.aced-ob-actions{display:flex;align-items:center;gap:14px;margin-top:16px}' +
      '.aced-ob-go{font-family:"Press Start 2P",monospace;font-size:10px;letter-spacing:1px;' +
      'background:#0a160a;color:var(--crt-green,#39ff14);border:1px solid var(--crt-green-dim,#1c8a0a);' +
      'padding:10px 14px;cursor:pointer;text-shadow:0 0 4px var(--crt-green,#39ff14)}' +
      '.aced-ob-go:hover{background:#0f2a14;border-color:var(--crt-green,#39ff14);' +
      'box-shadow:0 0 8px var(--crt-green,#39ff14)}' +
      '.aced-ob-skip{font-family:"Press Start 2P",monospace;font-size:8px;letter-spacing:1px;' +
      'color:var(--crt-grey,#5a6a55);background:transparent;border:0;cursor:pointer;text-decoration:underline}' +
      '.aced-ob-skip:hover{color:var(--crt-amber,#ffb000)}' +
      '.aced-ob-foot{margin-top:14px;padding-top:10px;border-top:1px dashed var(--border,#1f3a1f);font-size:16px}' +
      '.aced-ob-foot a{color:var(--crt-cyan,#00e6ff);text-decoration:none}' +
      '.aced-ob-foot a:hover{text-shadow:0 0 6px var(--crt-cyan,#00e6ff)}' +
      '@media (prefers-reduced-motion: reduce){' +
      '.aced-ob-back,.aced-ob-panel{transition:none}.aced-ob-cur{animation:none}}';
    var s = document.createElement('style');
    s.id = 'aced-ob-style';
    s.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(s);
  }

  // ---- tiny escaping helper (defense in depth for configurable copy) ----
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var backEl = null, lastFocus = null, keyHandler = null;

  function focusables() {
    if (!backEl) return [];
    return Array.prototype.slice.call(
      backEl.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')
    ).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
  }

  function show() {
    try {
      if (backEl) return;
      injectStyles();
      lastFocus = document.activeElement;

      var stepsHTML = (CFG.steps || []).map(function (st) {
        var c = (st.color === 'amber' || st.color === 'cyan') ? st.color : 'green';
        return '<div class="aced-ob-step">' +
                 '<span class="aced-ob-lbl ' + c + '">' + esc(st.label) + '</span>' +
                 '<p class="aced-ob-body">' + esc(st.body) + '</p>' +
               '</div>';
      }).join('');

      var footHTML = CFG.cheatSheetUrl
        ? '<div class="aced-ob-foot"><a href="' + esc(CFG.cheatSheetUrl) + '">' +
            esc(CFG.cheatSheetLabel) + '</a></div>'
        : '';

      backEl = document.createElement('div');
      backEl.className = 'aced-ob-back';
      backEl.setAttribute('role', 'dialog');
      backEl.setAttribute('aria-modal', 'true');
      backEl.setAttribute('aria-labelledby', 'aced-ob-title');
      backEl.innerHTML =
        '<div class="aced-ob-panel">' +
          '<div class="aced-ob-bar"><span>' + esc(CFG.sessionName) +
            ' <span class="aced-ob-cur">\u258b</span></span><span>ACED_</span></div>' +
          '<button class="aced-ob-close" type="button" aria-label="Close">\u00d7</button>' +
          '<h2 class="aced-ob-title" id="aced-ob-title">' + esc(CFG.title) + '</h2>' +
          '<p class="aced-ob-sub">' + esc(CFG.subtitle) + '</p>' +
          stepsHTML +
          '<div class="aced-ob-actions">' +
            '<button class="aced-ob-go" type="button">' + esc(CFG.primaryLabel) + '</button>' +
            '<button class="aced-ob-skip" type="button">' + esc(CFG.skipLabel) + '</button>' +
          '</div>' +
          footHTML +
        '</div>';

      document.body.appendChild(backEl);
      // force reflow so the fade-in transition runs
      void backEl.offsetWidth;
      backEl.classList.add('aced-ob-in');

      var goBtn = backEl.querySelector('.aced-ob-go');
      var skipBtn = backEl.querySelector('.aced-ob-skip');
      var closeBtn = backEl.querySelector('.aced-ob-close');

      goBtn.addEventListener('click', function () { hide(); });
      skipBtn.addEventListener('click', function () { hide(); });
      closeBtn.addEventListener('click', function () { hide(); });
      backEl.addEventListener('mousedown', function (e) {
        if (e.target === backEl) hide();          // click the backdrop to dismiss
      });

      keyHandler = function (e) {
        if (e.key === 'Escape' || e.keyCode === 27) { e.preventDefault(); hide(); return; }
        if (e.key === 'Tab' || e.keyCode === 9) {
          var f = focusables();
          if (!f.length) return;
          var first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      document.addEventListener('keydown', keyHandler, true);

      setTimeout(function () { try { goBtn.focus(); } catch (e) {} }, 0);
    } catch (e) {
      // Onboarding must never break the app.
      try { if (backEl && backEl.parentNode) backEl.parentNode.removeChild(backEl); } catch (e2) {}
      backEl = null;
    }
  }

  function hide() {
    markSeen();
    if (keyHandler) { document.removeEventListener('keydown', keyHandler, true); keyHandler = null; }
    var el = backEl;
    backEl = null;
    if (!el) return;
    el.classList.remove('aced-ob-in');
    var done = function () {
      try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
      try { if (lastFocus && lastFocus.focus) lastFocus.focus(); } catch (e) {}
      lastFocus = null;
    };
    // remove after the fade, with a fallback if transitionend never fires
    var fired = false;
    el.addEventListener('transitionend', function () { if (!fired) { fired = true; done(); } });
    setTimeout(function () { if (!fired) { fired = true; done(); } }, 260);
  }

  // ---- boot ----
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  ready(function () {
    try {
      var qs = '';
      try { qs = (window.location.search || '').toLowerCase(); } catch (e) {}
      var forced = /[?&]tutorial=1(&|$)/.test(qs);
      if (/[?&]tutorial=reset(&|$)/.test(qs)) reset();
      if (forced || (CFG.autoShow && !seen())) show();
    } catch (e) {}
  });

  window.ACEDOnboarding = { show: show, hide: hide, reset: reset, seen: seen };
})();
