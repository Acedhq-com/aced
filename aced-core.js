/* ACED — aced-core.js
   ============================================================================
   One small dependency-free core that the game pages share. It supersedes the
   earlier confidence.js / nemesis.js / daily.js drafts, which were written
   against an older question schema (q.topic / q.stem). The real banks use
   q.source / q.q, so this module is written against THAT schema and is the
   single, correct home for:

     ACEDCore.store        namespaced localStorage with in-memory fallback
     ACEDCore.analytics    fire-and-forget event tracking (growth-doc events)
     ACEDCore.calibration  Brier-score confidence calibration, by module
     ACEDCore.review       missed-question tracking + spaced review queue
     ACEDCore.streak       read the Daily Run streak (for HUD badges)
     ACEDCore.backend      optional sync abstraction (no-op until configured)

   Everything degrades gracefully: no storage, no network, no problem.
   Load this BEFORE the engine so the engine can call into it.
   ============================================================================ */
(function () {
  "use strict";

  var PACKID = (function () {
    try {
      var p = new URLSearchParams(location.search).get("pack");
      return (p || "world-capitals").replace(/[^a-z0-9._-]/gi, "");
    } catch (e) { return "world-capitals"; }
  })();
  var NS = "aced:" + PACKID + ":";

  /* ---------- storage (try/catch + in-memory fallback) ---------- */
  var mem = {}, lsOk = false;
  try { var k = "__acedcore__"; window["local" + "Storage"].setItem(k, "1"); window["local" + "Storage"].removeItem(k); lsOk = true; } catch (e) { lsOk = false; }
  function rd(key) { if (lsOk) { try { var raw = window["local" + "Storage"].getItem(NS + key); if (key === "review") mem[key] = raw; return raw; } catch (e) { lsOk = false; } } return mem[key] == null ? null : mem[key]; }
  function wr(key, v) { if (lsOk) { try { window["local" + "Storage"].setItem(NS + key, v); if (key === "review") mem[key] = v; return "durable"; } catch (e) { lsOk = false; } } mem[key] = v; return "memory"; }
  var store = {
    get: function (key, fb) { var raw = rd(key); if (raw == null) return fb; try { return JSON.parse(raw); } catch (e) { return fb; } },
    set: function (key, v) { try { wr(key, JSON.stringify(key === "review" || key === "learning_v1" ? jsonCopy(v) : v)); } catch (e) {} },
    isPersistent: function () { return lsOk; }
  };

  // Scoped review data boundaries. Descriptors avoid getters and safe insertion
  // keeps literal IDs (including __proto__) intact after ordinary JSON reloads.
  function field(o, k) { var d = o && Object.getOwnPropertyDescriptor(o, k); return d && d.enumerable && Object.prototype.hasOwnProperty.call(d, "value") ? d : null; }
  function value(o, k) { var d = field(o, k); return d ? d.value : undefined; }
  function put(o, k, v) { Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); }
  function dataObject(v) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    var p = Object.getPrototypeOf(v);
    while (p) {
      var d = Object.getOwnPropertyDescriptor(p, "constructor");
      var name = d && Object.prototype.hasOwnProperty.call(d, "value") && typeof d.value === "function" ? Object.getOwnPropertyDescriptor(d.value, "name") : null;
      if (d && !d.enumerable && name && Object.prototype.hasOwnProperty.call(name, "value") && name.value !== "Object") return false;
      p = Object.getPrototypeOf(p);
    }
    return true;
  }
  function jsonCopy(v, stack) {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number" && isFinite(v)) return v;
    if (!v || typeof v !== "object" || (!Array.isArray(v) && !dataObject(v))) throw new Error("serialization-failed");
    stack = stack || [];
    if (stack.indexOf(v) >= 0 || Object.getOwnPropertySymbols(v).length) throw new Error("serialization-failed");
    stack.push(v);
    var out = Array.isArray(v) ? Object.setPrototypeOf([], null) : Object.create(null), keys = Object.keys(v), names = Object.getOwnPropertyNames(v);
    if (names.some(function (k) { return !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(v, k), "value"); })) throw new Error("serialization-failed");
    if (Array.isArray(v) && (names.length !== v.length + 1 || keys.length !== v.length || keys.some(function (k, i) { return k !== String(i); }))) throw new Error("serialization-failed");
    keys.forEach(function (k) { var d = field(v, k); if (!d) throw new Error("serialization-failed"); put(out, k, jsonCopy(d.value, stack)); });
    stack.pop(); return out;
  }
  function countValue(v) { return typeof v === "number" && Number.isSafeInteger(v) && v >= 0; }
  function knownCount(o, k) { return !!field(o, k) && countValue(value(o, k)); }
  function knownBox(o) { var b = value(o, "box"); return !!field(o, "box") && Number.isInteger(b) && b >= 0 && b <= 5; }
  function reviewResult(outcome, persistence, reason) { return { outcome: outcome, persistence: persistence, reason: reason }; }
  function reviewSource() {
    var raw = rd("review");
    if (raw != null) { try { JSON.parse(raw); } catch (e) { return { corrupt: true }; } }
    return { state: store.get("review", {}), absent: raw == null };
  }
  function acceptReview(prepared) {
    try {
      var persistence = wr("review", prepared);
      return persistence === "durable" || persistence === "memory" ?
        { persistence: persistence } : { reason: "storage-unavailable" };
    } catch (e) { return { reason: "storage-unavailable" }; }
  }
  function commitReview(candidate) {
    var prepared;
    try { prepared = JSON.stringify(jsonCopy(candidate)); }
    catch (e) { return { reason: "serialization-failed" }; }
    return acceptReview(prepared);
  }
  function equalReview(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
    var ak = Object.keys(a), bk = Object.keys(b);
    return ak.length === bk.length && ak.every(function (k) {
      return !!field(b, k) && equalReview(value(a, k), value(b, k));
    });
  }
  function comparableReview(e) {
    return dataObject(e) && ["last", "seen"].every(function (k) {
      var v = value(e, k);
      return !field(e, k) || v === null || ["number", "string", "boolean"].indexOf(typeof v) >= 0;
    });
  }
  // Review-only inbound boundary: one post-response raw snapshot, no display
  // fallback, field union, retry, or stronger cross-tab transaction promise.
  function prepareInboundReview(descriptor) {
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value"))
      return { reason: "review-serialization-failed" };
    var raw = rd("review"), current, incoming, absent = raw == null;
    if (!lsOk && !Object.prototype.hasOwnProperty.call(mem, "review")) return { reason: "review-storage-unavailable" };
    if (!absent) {
      try { current = JSON.parse(raw); }
      catch (e) { return { reason: "review-state-held" }; }
    }
    try {
      if (!absent) current = jsonCopy(current);
      incoming = jsonCopy(descriptor.value);
    } catch (e) { return { reason: "review-serialization-failed" }; }
    if (!absent) {
      if (equalReview(current, incoming)) return { noop: true };
      if (!dataObject(current) || !dataObject(incoming)) return { reason: "review-state-held" };
      var conflict = Object.keys(current).some(function (k) {
        if (!field(incoming, k)) return true;
        var a = value(current, k), b = value(incoming, k);
        return (!comparableReview(a) || !comparableReview(b)) && !equalReview(a, b);
      });
      if (conflict) return { reason: "review-state-held" };
    }
    try { return { prepared: JSON.stringify(incoming) }; }
    catch (e) { return { reason: "review-serialization-failed" }; }
  }

  /* short stable hash for a question (used as a review key with its module) */
  function hash(s) { var h = 0, i; s = String(s == null ? "" : s); for (i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; } return h.toString(36); }
  // Legacy identity (source + stem hash) used before canonical IDs. Kept permanently for migration
  // and for imported/older packs that have no id.
  function legacyQKey(q) { return (q && q.source ? q.source : "?") + ":" + hash(q && q.q ? q.q : ""); }
  // Canonical identity: prefer the pipeline-assigned immutable q.id; fall back to the legacy stem
  // hash so imported/older questions still work. Editing wording no longer resets review history.
  function qKey(q) { if (q && q.id != null) { var id = String(q.id).trim(); if (id) return id; } return legacyQKey(q); }

  /* ---------- analytics (fire-and-forget; matches GROWTH_BACKLOG events) ---------- */
  var EVENT_CAP = 200;
  // Defensive PII scrubber: analytics props should never carry raw emails or
  // auth tokens. This is a safety net (nothing intentionally logs PII), so it
  // redacts email-like values and long token-like strings and drops keys whose
  // name suggests a secret. Objects are recursed one level deep; capped in size.
  var PII_KEY = /(email|mail|token|jwt|secret|password|passwd|pwd|auth|bearer|apikey|api_key|session)/i;
  var EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
  function scrubVal(v) {
    if (v == null) return v;
    if (typeof v === "string") {
      if (EMAIL_RE.test(v)) return "[redacted:email]";
      // long opaque strings (tokens/ids) — keep short human-readable labels
      if (v.length > 64 || /^(ey[A-Za-z0-9._-]{20,}|Bearer\s)/i.test(v)) return "[redacted]";
      return v;
    }
    if (typeof v === "number" || typeof v === "boolean") return v;
    return undefined; // drop nested objects/arrays/functions from analytics props
  }
  function scrubProps(props) {
    var out = {}, n = 0;
    if (!props || typeof props !== "object") return out;
    try {
      for (var kk in props) {
        if (!Object.prototype.hasOwnProperty.call(props, kk)) continue;
        if (n++ >= 40) break;                    // cap prop count
        if (PII_KEY.test(kk)) { out[kk] = "[redacted]"; continue; }
        var sv = scrubVal(props[kk]);
        if (sv !== undefined) out[kk] = sv;
      }
    } catch (e) {}
    return out;
  }
  var analytics = {
    track: function (event, props) {
      var rec = { e: event, t: Date.now(), p: scrubProps(props) };
      try {
        var buf = store.get("events", []);
        buf.push(rec); if (buf.length > EVENT_CAP) buf = buf.slice(-EVENT_CAP);
        store.set("events", buf);
      } catch (e) {}
      // optional live sink (e.g., Plausible/PostHog) — wired by the host if present
      try { if (typeof window.ACED_ANALYTICS_SINK === "function") window.ACED_ANALYTICS_SINK(event, rec.p); } catch (e) {}
      try { if (window.console && console.debug) console.debug("[aced]", event, rec.p); } catch (e) {}
    },
    recent: function (n) { var b = store.get("events", []); return n ? b.slice(-n) : b; }
  };

  /* ---------- calibration (Brier score by module) ----------
     prob: LOW .50 / MED .75 / HIGH .95 ; brier = (prob - actual)^2
     display = (1 - mean brier) * 100, clamped 0..100. */
  var PROB = { LOW: 0.50, MED: 0.75, HIGH: 0.95 };
  var CAL_CAP = 400;
  var calibration = {
    PROB: PROB,
    record: function (o) {
      o = o || {};
      var p = PROB[o.confidence]; if (p == null) return;
      var actual = o.correct ? 1 : 0;
      var s = store.get("calib", { samples: [], byModule: {} });
      var brier = (p - actual) * (p - actual);
      s.samples.push({ b: brier, c: o.confidence, ok: actual, m: o.source || null, t: Date.now() });
      if (s.samples.length > CAL_CAP) s.samples = s.samples.slice(-CAL_CAP);
      if (o.source) {
        var bm = Object.prototype.hasOwnProperty.call(s.byModule, o.source)
          ? s.byModule[o.source] : { n: 0, sum: 0, correct: 0 };
        bm.n += 1; bm.sum += brier; bm.correct += actual;
        Object.defineProperty(s.byModule, o.source, {
          value: bm, enumerable: true, configurable: true, writable: true
        });
      }
      store.set("calib", s);
      analytics.track("confidence_bet_placed", { level: o.confidence, correct: !!o.correct, module: o.source || null });
      return this.summary();
    },
    summary: function () {
      var s = store.get("calib", { samples: [], byModule: {} });
      var n = s.samples.length;
      if (!n) return { pct: null, n: 0, byModule: {} };
      var sum = 0, correct = 0, i;
      for (i = 0; i < n; i++) { sum += s.samples[i].b; correct += s.samples[i].ok; }
      var pct = Math.max(0, Math.min(100, Math.round((1 - sum / n) * 100)));
      return { pct: pct, n: n, accuracy: Math.round((correct / n) * 100), byModule: s.byModule };
    }
  };

  /* ---------- review / spaced repetition (Leitner-lite, keyed by module+question) ----------
     Each answered question gets a "box" 0..5. Correct -> box+1, miss -> box=0.
     Scheduled questions return when due, independently of weakness. Legacy
     records without a schedule retain weakness-only eligibility. */
  /* ---------- review-key migration: stem-hash keys -> canonical q.id ----------
     This intentionally runs once per loaded question set, not once globally. A global
     "done" flag caused the first pack opened to block migration for every other pack.
     The operation is naturally idempotent because a migrated legacy key is deleted. */
  var REVIEW_ID_MIGRATION_KEY = "reviewCanonicalIdsV1";
  function validScheduleNumber(value) { return typeof value === "number" && isFinite(value) && value >= 0; }
  function validReviewSchedule(entry) {
    return validScheduleNumber(value(entry, "dueAt")) && value(entry, "dueAt") > 0 &&
      (!field(entry, "intervalDays") || validScheduleNumber(value(entry, "intervalDays"))) &&
      (!field(entry, "lastReviewedAt") || validScheduleNumber(value(entry, "lastReviewedAt")));
  }
  function mergeReviewEntries(a, b) {
    a = a || {}; b = b || {};
    var aLast = Number(a.last || 0), bLast = Number(b.last || 0);
    var latest = bLast > aLast ? b : a;
    var merged = {
      seen: Math.max(Number(a.seen || 0), Number(b.seen || 0)),
      miss: Math.max(Number(a.miss || 0), Number(b.miss || 0)),
      ok: Math.max(Number(a.ok || 0), Number(b.ok || 0)),
      box: Math.max(0, Math.min(5, Number(latest.box || 0))),
      last: Math.max(aLast, bLast),
      src: latest.src || a.src || b.src || null
    };
    var other = latest === a ? b : a, schedule = latest;
    // Only an absent/zero legacy schedule may fall back. Keep malformed winning
    // values intact so migration cannot turn them into immediately due legacy cards.
    if ((latest.dueAt === undefined || latest.dueAt === 0) && validReviewSchedule(other)) schedule = other;
    ["dueAt", "intervalDays", "lastReviewedAt"].forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(schedule, key)) merged[key] = schedule[key];
    });
    var aLapses = validScheduleNumber(a.lapses), bLapses = validScheduleNumber(b.lapses);
    if (aLapses || bLapses) merged.lapses = Math.max(aLapses ? a.lapses : 0, bLapses ? b.lapses : 0);
    return merged;
  }
  function migrateReviewIds(allQs) {
    if (!Array.isArray(allQs) || !allQs.length) { return { migrated: 0, skipped: 0, reason: "no-questions" }; }
    var source = reviewSource(), records, migrated = 0, skipped = 0, held = false;
    if (source.corrupt) return { migrated: 0, skipped: allQs.length, reason: "historical-state-held" };
    try { records = jsonCopy(source.state); }
    catch (e) {
      var blockedRows = allQs.filter(function (q) {
        if (!q || !q.id || !dataObject(source.state)) return true;
        var oldKey = legacyQKey(q), d = Object.getOwnPropertyDescriptor(source.state, oldKey);
        return oldKey !== qKey(q) && d && d.enumerable;
      }).length;
      return { migrated: 0, skipped: blockedRows, reason: "serialization-failed" };
    }
    if (!dataObject(records)) return { migrated: 0, skipped: allQs.length, reason: "historical-state-held" };
    var collisionFields = ["seen", "miss", "ok", "box", "last", "src", "dueAt", "intervalDays", "lastReviewedAt", "lapses"];
    function compatible(e) {
      return dataObject(e) && ["seen", "miss", "ok"].every(function (k) { return knownCount(e, k); }) &&
        !!field(e, "last") && validScheduleNumber(value(e, "last")) &&
        !!field(e, "box") && typeof value(e, "box") === "number" && isFinite(value(e, "box")) &&
        (!field(e, "src") || value(e, "src") === null || typeof value(e, "src") === "string") &&
        Object.keys(e).every(function (k) { return collisionFields.indexOf(k) >= 0; });
    }
    allQs.forEach(function (q) {
      if (!q || !q.id) { skipped++; return; }
      var oldKey = legacyQKey(q), newKey = qKey(q);
      if (oldKey === newKey || !field(records, oldKey)) return;
      var old = value(records, oldKey), current = value(records, newKey);
      if (!dataObject(old) || (field(records, newKey) && (!compatible(old) || !compatible(current)))) { skipped++; held = true; return; }
      put(records, newKey, field(records, newKey) ? mergeReviewEntries(current, old) : old);
      delete records[oldKey]; migrated++;
    });
    if (migrated) {
      var disposition = commitReview(records);
      if (!disposition.persistence) return { migrated: 0, skipped: skipped + migrated, reason: disposition.reason || "storage-unavailable" };
    }
    store.set(REVIEW_ID_MIGRATION_KEY, { lastRunAt: Date.now(), migrated: migrated, skipped: skipped });
    try { analytics.track("review_ids_migrated", { migrated: migrated, skipped: skipped }); } catch (e) {}
    return { migrated: migrated, skipped: skipped, reason: held ? "historical-state-held" : "complete" };
  }
  /* ---------- spaced-repetition schedule (time-based) ---------- */
  // Days until a card is due again, by Leitner box (0 = same session).
  var BOX_INTERVALS = [0, 1, 3, 7, 14, 30];
  function _weak(e) { return dataObject(e) && ((knownCount(e, "miss") && knownCount(e, "ok") && value(e, "miss") > value(e, "ok")) ||
    (knownCount(e, "miss") && knownBox(e) && value(e, "miss") > 0 && value(e, "box") <= 1)); }
  // Positive numeric schedules are independent of weakness. Only legacy missing/zero
  // dates retain weakness-only eligibility; malformed dates are held, not coerced.
  function _dueForReview(e, now) {
    if (!dataObject(e)) return false;
    var d = Object.getOwnPropertyDescriptor(e, "dueAt"), due = value(e, "dueAt");
    if (d && !field(e, "dueAt")) return false;
    if (due === undefined || due === 0) return _weak(e);
    return validScheduleNumber(due) && due > 0 && due <= now;
  }
  var review = {
    migrateIds: migrateReviewIds,
    record: function (q, correct) {
      if (!q) return reviewResult("no-question", "none", "no-question");
      var key = qKey(q);
      var source = reviewSource(), r;
      if (source.corrupt) return reviewResult("held", "none", "historical-state-held");
      try { r = jsonCopy(source.state); }
      catch (err) { return reviewResult("held", "none", "serialization-failed"); }
      if (!dataObject(r) || (field(r, key) && !dataObject(value(r, key)))) return reviewResult("held", "none", "historical-state-held");
      var e = field(r, key) ? value(r, key) : { seen: 0, miss: 0, ok: 0, box: 0, last: 0, src: q.source || null };
      var now = Date.now();
      if (!validScheduleNumber(now)) return reviewResult("held", "none", "serialization-failed");
      var completeCounts = ["seen", "miss", "ok"].every(function (k) { return knownCount(e, k); }), partial = !completeCounts;
      ["seen", correct ? "ok" : "miss"].forEach(function (k) {
        if (knownCount(e, k) && e[k] < Number.MAX_SAFE_INTEGER) e[k] += 1;
        else partial = true;
      });
      put(e, "last", now);
      if (correct && !knownBox(e)) partial = true;
      else {
        put(e, "box", correct ? Math.min(5, e.box + 1) : 0);
        put(e, "lastReviewedAt", now);
        put(e, "intervalDays", correct ? BOX_INTERVALS[e.box] : 0);
        put(e, "dueAt", correct ? now + e.intervalDays * 864e5 : now + 6e5);
      }
      if (field(e, "lapses")) {
        if (!knownCount(e, "lapses")) partial = true;
        else if (!correct) { if (e.lapses < Number.MAX_SAFE_INTEGER) e.lapses++; else partial = true; }
      } else if (!correct) { if (completeCounts) put(e, "lapses", 1); else partial = true; }
      put(r, key, e);
      var disposition = commitReview(r);
      if (!disposition.persistence) return reviewResult("held", "none", disposition.reason || "storage-unavailable");
      return reviewResult(partial ? "partial" : "recorded", disposition.persistence,
        partial ? "historical-fields-unknown" : (disposition.persistence === "durable" ? "complete" : "storage-unavailable"));
    },
    // scheduling info for the after-run summary ("returns in N days")
    schedule: function (q) { var r = store.get("review", {}), e = dataObject(r) ? value(r, qKey(q)) : null; if (!dataObject(e)) return null; return { box: value(e, "box") || 0, intervalDays: value(e, "intervalDays") || 0, dueAt: value(e, "dueAt") || 0, lapses: value(e, "lapses") || 0 }; },
    isWeak: function (q) { var r = store.get("review", {}); return dataObject(r) && _weak(value(r, qKey(q))); },
    /* return up to n due questions from allQs, ranked by the existing
       misses/box/overdue arithmetic. */
    queue: function (allQs, n) {
      n = n || 10;
      var r = store.get("review", {});
      if (!dataObject(r)) return [];
      var scored = [];
      var now = Date.now();
      (allQs || []).forEach(function (q) {
        var e = value(r, qKey(q));
        if (_dueForReview(e, now)) {
          var due = value(e, "dueAt"), overdue = due ? Math.max(0, now - due) / 864e5 : 1;
          var rank = knownCount(e, "miss") && knownCount(e, "ok") && knownBox(e) ?
            (e.miss * 10) - e.box + (5 - Math.min(5, e.ok)) + Math.min(20, overdue) : -Infinity;
          scored.push({ q: q, rank: rank, order: scored.length });
        }
      });
      scored.sort(function (a, b) { return a.rank === b.rank ? a.order - b.order : b.rank - a.rank; });
      return scored.slice(0, n).map(function (x) { return x.q; });
    },
    count: function () {
      var r = store.get("review", {}); var now = Date.now(); var c = 0;
      if (dataObject(r)) Object.keys(r).forEach(function (k) { if (_dueForReview(value(r, k), now)) c++; });
      return c;
    }
  };

  /* ---------- streak (read the Daily Run streak written by daily.html) ---------- */
  // Daily state is stored per pack. Pass a pack id to read another pack's streak (the landing
  // page shows the streak of whichever pack the player used last).
  function dailyFor(packId) {
    if (!packId || packId === PACKID) return store.get("dailyV1", {});
    try {
      var id = String(packId).replace(/[^a-z0-9._-]/gi, "");
      var raw = window["local" + "Storage"].getItem("aced:" + id + ":dailyV1");
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { return {}; }
  }
  var streak = {
    get: function (packId) {
      var d = dailyFor(packId);
      return { current: d.currentStreak || 0, best: d.bestStreak || 0, freezes: d.freezes || 0, lastDate: d.lastDate || null };
    },
    playedToday: function (packId) {
      var d = dailyFor(packId);
      var today = new Date(); var key = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
      return !!(d.results && d.results[key]);
    }
  };

  /* ---------- backend abstraction (no-op until configured) ----------
     Set ACEDCore.backend.configure({endpoint, token}) to enable cross-device
     sync. Until then push/pull resolve to local data. See BACKEND_SPEC.md. */
  var _be = { endpoint: null, token: null };
  // Timeout guard so a cold/hung backend can't leave sync requests pending
  // forever (Render free tier cold-starts ~15-20s). Always clears the timer.
  var BE_TIMEOUT_MS = 20000;
  function fetchT(url, init, ms) {
    init = init || {};
    var ac = (typeof AbortController !== "undefined") ? new AbortController() : null;
    if (ac) init.signal = ac.signal;
    var timer = setTimeout(function () { try { if (ac) ac.abort(); } catch (e) {} }, ms || BE_TIMEOUT_MS);
    return fetch(url, init).then(
      function (r) { clearTimeout(timer); return r; },
      function (err) { clearTimeout(timer); throw err; }
    );
  }
  var backend = {
    configure: function (cfg) { _be.endpoint = (cfg && cfg.endpoint) || null; _be.token = (cfg && cfg.token) || null; },
    isEnabled: function () { return !!_be.endpoint; },
    push: function (payload) {
      if (!_be.endpoint) return Promise.resolve({ synced: false, local: true });
      try {
        return fetchT(_be.endpoint + "/sync?pack=" + encodeURIComponent(PACKID), {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": _be.token ? ("Bearer " + _be.token) : "" },
          body: JSON.stringify(payload || {})
        }).then(function (r) { return r.json(); }).catch(function () { return { synced: false, error: true }; });
      } catch (e) { return Promise.resolve({ synced: false, error: true }); }
    },
    pull: function () {
      if (!_be.endpoint) return Promise.resolve(null);
      try {
        // Always name the pack: state is stored per (user, pack). Omitting it made the
        // server fall back to world-capitals, whose state was then written into this pack.
        return fetchT(_be.endpoint + "/state?pack=" + encodeURIComponent(PACKID), { headers: { "Authorization": _be.token ? ("Bearer " + _be.token) : "" } })
          .then(function (r) { return r.json(); }).catch(function () { return null; });
      } catch (e) { return Promise.resolve(null); }
    }
  };

  /* ---------- cross-device sync (MI-2) ----------
     Bundles the keys this device owns and round-trips them through the backend
     abstraction. Entirely a no-op until ACEDCore.backend.configure({endpoint})
     is called, so it is safe to wire eagerly. Streak lives under "dailyV1", so
     including it here is what lets a streak survive phone <-> laptop. */
  var SYNC_KEYS = ["mastery", "review", "calib", "events", "unlocked", "unlocks",
    "nemesis", "nemesisDefeats", "bestScore", "bestAnte", "dailyV1", "subscribers", "muted",
    "progress", "objectives", "vault", "learning_v1", "runStats_v1"];
  var sync = {
    snapshot: function () {
      var data = {}, i, k, v;
      for (i = 0; i < SYNC_KEYS.length; i++) { k = SYNC_KEYS[i]; v = store.get(k, null); if (v != null) data[k] = v; }
      return { v: 1, pack: PACKID, updatedAt: Date.now(), data: data };
    },
    isEnabled: function () { return backend.isEnabled(); },
    push: function () {
      if (!backend.isEnabled()) return Promise.resolve({ synced: false, reason: "no-endpoint" });
      var snap = this.snapshot();
      try { store.set("lastSyncPush", snap.updatedAt); } catch (e) {}
      analytics.track("sync_push", { keys: Object.keys(snap.data).length });
      return backend.push(snap);
    },
    // Pull remote and apply ONLY if it is newer than the last applied pull (conservative,
    // last-write-wins by timestamp). Returns {applied, keys|reason}.
    // Containment: remote state is applied only when the server confirms it belongs to THIS
    // pack, and only the keys sync owns are written, so another pack's progress (or a
    // malformed response) can never overwrite this pack's local learning history.
    pull: function () {
      if (!backend.isEnabled()) return Promise.resolve({ applied: false, reason: "no-endpoint" });
      var lastApplied = store.get("lastSyncApplied", 0);
      return backend.pull().then(function (remote) {
        if (!remote || !remote.data || typeof remote.data !== "object") return { applied: false, reason: "empty" };
        if (remote.pack !== PACKID) return { applied: false, reason: "pack-mismatch" };
        if (remote.updatedAt && remote.updatedAt <= lastApplied) return { applied: false, reason: "stale" };
        var keys = Object.keys(remote.data).filter(function (k) { return SYNC_KEYS.indexOf(k) >= 0; }), i;
        if (keys.indexOf("review") >= 0) {
          var reviewWrite = prepareInboundReview(Object.getOwnPropertyDescriptor(remote.data, "review"));
          if (reviewWrite.reason) return { applied: false, reason: reviewWrite.reason };
          if (!reviewWrite.noop) {
            var accepted = acceptReview(reviewWrite.prepared);
            if (!accepted.persistence) return { applied: false, reason: accepted.reason === "serialization-failed" ?
              "review-serialization-failed" : "review-storage-unavailable" };
          }
        }
        for (i = 0; i < keys.length; i++) { if (keys[i] !== "review") { try { store.set(keys[i], remote.data[keys[i]]); } catch (e) {} } }
        try { store.set("lastSyncApplied", remote.updatedAt || Date.now()); } catch (e) {}
        analytics.track("sync_pull", { keys: keys.length });
        return { applied: true, keys: keys.length };
      });
    }
  };

  /* ---------- retention / cohort (Task 1: D1 / D7 / D30 return) ----------
     Records first-seen (the signup cohort) + every active calendar day, and fires
     structured install / day_active / returned events. Per-user flags live here;
     the AGGREGATE cohort rate (e.g. "D7 for the week-of-Mar-3 cohort") is computed
     from the emitted events in your analytics sink or the backend — the event
     payloads (cohort + dayIndex) are shaped so that rollup is a group-by. */
  var retention = {
    _dayIndex: function (fromISO, toISO) {
      var a = Date.parse(fromISO + "T00:00:00Z"), b = Date.parse(toISO + "T00:00:00Z");
      if (isNaN(a) || isNaN(b)) return 0;
      return Math.round((b - a) / 86400000);
    },
    _week: function (iso) { // ISO-week cohort label YYYY-Www
      var d = new Date(iso + "T00:00:00Z");
      if (isNaN(d.getTime())) return iso;
      var day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3);
      var firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
      var wk = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
      return d.getUTCFullYear() + "-W" + (wk < 10 ? "0" : "") + wk;
    },
    // Call once per app load (auto-called below). Idempotent within a calendar day.
    ping: function () {
      var today = new Date().toISOString().slice(0, 10);
      var r = store.get("retention", null);
      if (!r) {
        r = { firstSeen: today, lastSeen: today, days: [today] };
        store.set("retention", r);
        analytics.track("install", { cohort: retention._week(today) });
        analytics.track("day_active", { dayIndex: 0, cohort: retention._week(today) });
        return retention.report();
      }
      if (r.lastSeen !== today) {
        var di = retention._dayIndex(r.firstSeen, today);
        if (r.days.indexOf(today) === -1) { r.days.push(today); if (r.days.length > 120) r.days = r.days.slice(-120); }
        r.lastSeen = today; store.set("retention", r);
        analytics.track("day_active", { dayIndex: di, cohort: retention._week(r.firstSeen) });
        analytics.track("returned", { dayIndex: di, cohort: retention._week(r.firstSeen) });
      }
      return retention.report();
    },
    // Per-user snapshot: cohort + whether this user has returned on/after day 1/7/30.
    report: function () {
      var r = store.get("retention", null);
      if (!r) return { firstSeen: null, cohort: null, daysActive: 0, dayIndex: 0, d1: false, d7: false, d30: false };
      var days = r.days || [];
      function returnedBy(win) { for (var j = 0; j < days.length; j++) { if (retention._dayIndex(r.firstSeen, days[j]) >= win) return true; } return false; }
      return {
        firstSeen: r.firstSeen, cohort: retention._week(r.firstSeen), daysActive: days.length,
        dayIndex: retention._dayIndex(r.firstSeen, new Date().toISOString().slice(0, 10)),
        d1: returnedBy(1), d7: returnedBy(7), d30: returnedBy(30)
      };
    }
  };

  window.ACEDCore = {
    version: 2,
    store: store,
    analytics: analytics,
    calibration: calibration,
    review: review,
    streak: streak,
    retention: retention,
    backend: backend,
    sync: sync,
    qKey: qKey,
    legacyQKey: legacyQKey
  };

  // fire-and-forget: record today's activity + emit cohort events on every load
  try { retention.ping(); } catch (e) {}
})();
