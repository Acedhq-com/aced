/* ACED bridge: lets the full poker roguelike (study.html) play packs saved in the
   user's library. It converts library questions into engine questions, maps run
   settings (stakes, starting joker) to engine mods, and writes answers back to the
   pack's progress so the library shows real recall progress. */
(function (root) {
  "use strict";

  var STAKES = {
    casual: { stakesMult: 0.75, startMoney: 8 },
    standard: { stakesMult: 1, startMoney: 4 },
    brutal: { stakesMult: 1.35, startMoney: 4 }
  };
  var RELICS = { warmup: "warmup", flowstate: "flowstate", snowball: "snowball" };

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function member(o, k) { var d = o && Object.getOwnPropertyDescriptor(o, k); return d && own(d, "value") ? d : null; }
  function field(o, k) { var d = member(o, k); return d && d.enumerable ? d : null; }
  function value(o, k) { var d = field(o, k); return d ? d.value : undefined; }
  function put(o, k, v) { Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); }
  function dataObject(v) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    var p = Object.getPrototypeOf(v);
    while (p) {
      var d = Object.getOwnPropertyDescriptor(p, "constructor");
      var name = d && own(d, "value") && typeof d.value === "function" ? Object.getOwnPropertyDescriptor(d.value, "name") : null;
      if (d && !d.enumerable && name && own(name, "value") && name.value !== "Object") return false;
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
    if (names.some(function (k) { return !own(Object.getOwnPropertyDescriptor(v, k), "value"); })) throw new Error("serialization-failed");
    if (Array.isArray(v) && (names.length !== v.length + 1 || keys.length !== v.length || keys.some(function (k, i) { return k !== String(i); }))) throw new Error("serialization-failed");
    keys.forEach(function (k) { var d = field(v, k); if (!d) throw new Error("serialization-failed"); put(out, k, jsonCopy(d.value, stack)); });
    stack.pop(); return out;
  }
  function knownCount(o, k) { var v = value(o, k); return !!field(o, k) && typeof v === "number" && Number.isSafeInteger(v) && v >= 0; }
  function recordingResult(outcome, persistence, reason) { return { outcome: outcome, persistence: persistence, reason: reason }; }

  function hash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffled(list, random) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1)), swap = out[i]; out[i] = out[j]; out[j] = swap;
    }
    return out;
  }
  function norm(text) { return String(text == null ? "" : text).trim().toLowerCase().replace(/\s+/g, " "); }

  function answerText(q) {
    if (q.kind === "choice" && Array.isArray(q.choices)) return String(q.choices[q.answer]);
    return String(q.answer == null ? "" : q.answer);
  }

  /* Multiple-choice questions pass straight through. Open-ended cards become
     multiple choice by drawing wrong options from the other answers in the same
     pack (same topic first), so every card can be graded automatically and bet on. */
  function toEngineQuestions(pack) {
    var rows = (pack && pack.questions) || [];
    var pool = rows.map(function (q) { return { text: answerText(q), source: q.source || "General" }; });
    return rows.map(function (q) {
      var base = { id: q.id, q: q.q, source: q.source || "General" };
      if (q.kind === "choice" && Array.isArray(q.choices) && q.choices.length >= 2) {
        base.choices = q.choices.slice(); base.answer = q.answer; base.explain = q.explain || "";
        return base;
      }
      var correct = answerText(q), key = norm(correct), seen = Object.create(null);
      seen[key] = true;
      var same = [], other = [];
      pool.forEach(function (candidate) {
        var k = norm(candidate.text);
        if (!k || seen[k]) return;
        seen[k] = true;
        (candidate.source === base.source ? same : other).push(candidate.text);
      });
      var random = rng(hash(String(q.id) + "\n" + q.q));
      var wrong = shuffled(same, random).concat(shuffled(other, random)).slice(0, 3);
      if (!wrong.length) wrong = ["None of the above"];
      var position = Math.floor(random() * (wrong.length + 1));
      var choices = wrong.slice(); choices.splice(position, 0, correct);
      base.choices = choices; base.answer = position;
      base.explain = "Answer: " + correct + (q.explain ? " \u2014 " + q.explain : "");
      return base;
    });
  }

  function mods(difficulty, relic) {
    var level = typeof difficulty === "string" && own(STAKES, difficulty) ? STAKES[difficulty] : STAKES.standard;
    var result = { stakesMult: level.stakesMult, startMoney: level.startMoney };
    if (typeof relic === "string" && own(RELICS, relic)) result.relicJoker = RELICS[relic];
    return result;
  }

  /* Returns a function(question, correct) that records an answer in pack progress. */
  function recorder(library, id) {
    return function (q, correct) {
      if (!q || q.id == null) return recordingResult("no-question", "none", "no-question");
      var context, capability;
      try {
        capability = member(library, "learningWriteContext");
        if (!capability || typeof capability.value !== "function") throw new Error("raw-state-unavailable");
        context = capability.value.call(library, id);
        var classification = member(context, "classification"), source = member(context, "source"), snapshot = member(context, "snapshot"), commit = member(context, "commit");
        if (!classification || !source || !snapshot || !commit || typeof commit.value !== "function" ||
          ["absent", "present", "corrupt", "unavailable"].indexOf(classification.value) < 0 ||
          ["durable", "memory", "none"].indexOf(source.value) < 0 ||
          (classification.value === "unavailable" ? source.value !== "none" : source.value === "none")) throw new Error("raw-state-unavailable");
      } catch (e) { return recordingResult("held", "none", "raw-state-unavailable"); }
      if (classification.value === "corrupt") return recordingResult("held", "none", "historical-state-held");
      var learning;
      try {
        learning = classification.value === "present" ? jsonCopy(snapshot.value) : { attempts: 0, correct: 0, selfRated: 0, answers: Object.create(null) };
      } catch (e) { return recordingResult("held", "none", "serialization-failed"); }
      if (!dataObject(learning) || (field(learning, "answers") && !dataObject(value(learning, "answers"))))
        return recordingResult("held", "none", "historical-state-held");
      var answers = value(learning, "answers");
      if (!answers) { answers = Object.create(null); put(learning, "answers", answers); }
      if (field(answers, q.id) && !dataObject(value(answers, q.id))) return recordingResult("held", "none", "historical-state-held");
      var previous = field(answers, q.id) ? value(answers, q.id) : { attempts: 0, correct: 0, strength: 0 };
      var knownItem = knownCount(previous, "attempts") && knownCount(previous, "correct"), partial = false;
      function advance(o) {
        ["attempts", "correct"].forEach(function (k) {
          if (!knownCount(o, k)) partial = true;
          else if (k === "attempts" || correct) {
            if (o[k] < Number.MAX_SAFE_INTEGER) o[k]++;
            else partial = true;
          }
        });
      }
      advance(learning); advance(previous);
      if (field(learning, "selfRated") && !knownCount(learning, "selfRated")) partial = true;
      var strength = value(previous, "strength");
      if (!correct) put(previous, "strength", 0);
      else if (field(previous, "strength") && typeof strength === "number" && isFinite(strength) && strength >= 0 && strength <= 2)
        put(previous, "strength", Math.min(2, strength + 1));
      else if (!field(previous, "strength") && knownItem) put(previous, "strength", 1);
      else partial = true;
      var now = Date.now();
      if (typeof now !== "number" || !isFinite(now) || now < 0) return recordingResult("held", "none", "serialization-failed");
      put(previous, "lastCorrect", !!correct); put(previous, "lastAt", now); put(previous, "selfRated", false);
      put(answers, q.id, previous);
      try { learning = jsonCopy(learning); }
      catch (e) { return recordingResult("held", "none", "serialization-failed"); }
      var disposition;
      try { disposition = commit.value.call(context, learning); }
      catch (e) { return recordingResult("held", "none", "storage-unavailable"); }
      var accepted = member(disposition, "accepted"), persistence = member(disposition, "persistence"), reason = member(disposition, "reason");
      if (!accepted || accepted.value !== true || !persistence || ["durable", "memory"].indexOf(persistence.value) < 0)
        return recordingResult("held", "none", reason && reason.value === "serialization-failed" ? "serialization-failed" : "storage-unavailable");
      return recordingResult(partial ? "partial" : "recorded", persistence.value,
        partial ? "historical-fields-unknown" : (persistence.value === "durable" ? "complete" : "storage-unavailable"));
    };
  }

  var api = { toEngineQuestions: toEngineQuestions, mods: mods, recorder: recorder, STAKES: STAKES, RELICS: RELICS };
  root.ACEDBridge = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
