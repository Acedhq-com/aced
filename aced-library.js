/* ACED study packs. No framework, no remote uploads, no executable user packs. */
(function (root) {
  "use strict";
  var KEY = "aced:packs:v1", ACTIVITY = "aced:activity:v1", DRAFT = "aced:draft:v1";
  var MAX_QUESTIONS = 2000, MAX_TEXT = 2000000, MAX_SHARE = 12000;
  var memory = Object.create(null), persistent = true, loaded = Object.create(null);
  var STARTERS = [
    { id: "world-capitals", name: "World Capitals", subject: "Geography", count: 30,
      description: "Famous cities, surprising capitals, and the places you mix up.",
      file: "packs/world-capitals.js", accent: "green" },
    { id: "spanish-1k", name: "Everyday Spanish", subject: "Languages", count: 44,
      description: "Everyday words, useful verbs, and a few deceptive false friends.",
      file: "packs/spanish-1k.js", accent: "amber" }
  ];
  function storage() { return root["local" + "Storage"]; }
  function read(key, fallback) {
    var raw;
    try {
      raw = persistent ? storage().getItem(key) : memory[key];
      if (raw != null) memory[key] = raw;
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      persistent = false;
      try { return memory[key] == null ? fallback : JSON.parse(memory[key]); }
      catch (ignored) { return fallback; }
    }
  }
  function write(key, value) {
    var raw = JSON.stringify(value);
    memory[key] = raw;
    if (persistent) {
      try { storage().setItem(key, raw); }
      catch (e) { persistent = false; }
    }
    return persistent;
  }
  try {
    storage().setItem("aced:storage-check", "1");
    storage().removeItem("aced:storage-check");
  } catch (e) { persistent = false; }

  function text(value, max) {
    if (value == null) return "";
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error("Question fields must be text, not nested objects.");
    }
    var valueText = String(value).trim();
    if (valueText.length > (max || 6000)) throw new Error("A field is too long. Split it into shorter questions.");
    return valueText;
  }
  function hash(value) {
    var h = 2166136261, s = String(value), i;
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  function validId(id) {
    return typeof id === "string" && /^[a-z0-9][a-z0-9._-]{0,95}$/i.test(id)
      && ["__proto__", "constructor", "prototype"].indexOf(id) === -1;
  }
  function validPackId(id) {
    return validId(id) && ["packs", "activity", "draft", "storage-check", "pack-migration", "local"].indexOf(id) === -1;
  }
  function newId(name) {
    var slug = String(name || "pack").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 35);
    var suffix;
    try { suffix = root.crypto.randomUUID().slice(0, 8); }
    catch (e) { suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    return "pack-" + (slug || "study") + "-" + suffix;
  }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function normalizeQuestion(raw, index) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Question " + (index + 1) + " must be an object with a question and answer.");
    }
    var prompt = text(raw.q != null ? raw.q : (raw.prompt != null ? raw.prompt :
      (raw.question != null ? raw.question : (raw.front != null ? raw.front : raw.stem))));
    if (!prompt) throw new Error("Question " + (index + 1) + " needs a question or front.");
    var choices = raw.choices || raw.options || [];
    if (!Array.isArray(choices) && choices && typeof choices === "object") {
      choices = Object.keys(choices).sort().map(function (key) { return choices[key]; });
    }
    if (!Array.isArray(choices)) throw new Error("Question " + (index + 1) + ": choices must be a list.");
    choices = choices.map(function (choice) { return text(choice); });
    var answer = raw.answer != null ? raw.answer : (raw.correctIndex != null ? raw.correctIndex :
      (raw.correctAnswer != null ? raw.correctAnswer : (raw.back != null ? raw.back : raw.a)));
    var answerIndex = -1, kind = "recall";
    if (choices.length) {
      kind = "choice";
      if (choices.length < 2 || choices.length > 8 || choices.some(function (c) { return !c; })) {
        throw new Error("Question " + (index + 1) + ": use 2 to 8 non-empty choices.");
      }
      var unique = new Set(choices.map(function (c) { return c.toLocaleLowerCase(); }));
      if (unique.size !== choices.length) throw new Error("Question " + (index + 1) + " has duplicate choices.");
      if (typeof answer === "number" && Number.isInteger(answer)) answerIndex = answer;
      else {
        var answerText = text(answer);
        if (/^[A-H]$/i.test(answerText)) answerIndex = answerText.toUpperCase().charCodeAt(0) - 65;
        else if (/^\d$/.test(answerText)) answerIndex = Number(answerText);
        else answerIndex = choices.indexOf(answerText);
      }
      if (answerIndex < 0 || answerIndex >= choices.length) {
        throw new Error("Question " + (index + 1) + ": the correct answer must match a choice or its zero-based index.");
      }
      answer = answerIndex;
    } else {
      answer = text(answer);
      if (!answer) throw new Error("Question " + (index + 1) + " needs an answer or back.");
    }
    var explanation = text(raw.explain != null ? raw.explain : (raw.explanation != null ? raw.explanation : raw.why));
    var topic = text(raw.source || raw.topic || raw.moduleKey || raw.module || "General", 100);
    var fingerprint = prompt + "\n" + JSON.stringify(answer) + "\n" + choices.join("\n");
    return {
      id: validId(raw.id) ? raw.id : "q-" + hash(fingerprint),
      q: prompt, answer: answer, choices: choices, kind: kind,
      source: topic || "General", explain: explanation
    };
  }
  function normalize(raw, options) {
    options = options || {};
    if (Array.isArray(raw)) raw = { questions: raw };
    if (!raw || typeof raw !== "object") throw new Error("Use a JSON pack object or a list of question objects.");
    var rows = raw.questions || raw.cards;
    if (!Array.isArray(rows) || !rows.length) throw new Error("This pack has no questions. Add at least one.");
    if (rows.length > MAX_QUESTIONS) throw new Error("A pack can contain up to " + MAX_QUESTIONS + " questions. Split this one into smaller packs.");
    var seen = Object.create(null);
    var questions = rows.map(function (q, i) {
      var result = normalizeQuestion(q, i);
      if (seen[result.id]) throw new Error("Question " + (i + 1) + " is duplicated or shares another question's ID.");
      seen[result.id] = true;
      return result;
    });
    var name = text(options.name || raw.name || raw.title || "Untitled pack", 100);
    var id = options.id || raw.id;
    return {
      version: 1, id: validPackId(id) ? id : newId(name), name: name,
      subject: text(options.subject || raw.subject || raw.section || "General", 100),
      description: text(raw.description || "", 500),
      questions: questions,
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }
  function parseDelimited(input, delimiter) {
    var rows = [], row = [], field = "", quoted = false, i, c;
    for (i = 0; i < input.length; i++) {
      c = input[i];
      if (c === '"') {
        if (quoted && input[i + 1] === '"') { field += '"'; i++; }
        else if (!quoted && field.length) field += c;
        else quoted = !quoted;
      } else if (!quoted && c === delimiter) { row.push(field); field = ""; }
      else if (!quoted && (c === "\n" || c === "\r")) {
        if (c === "\r" && input[i + 1] === "\n") i++;
        row.push(field); if (row.some(function (v) { return v.trim(); })) rows.push(row);
        row = []; field = "";
      } else field += c;
    }
    if (quoted) throw new Error("A quoted CSV field is not closed.");
    row.push(field); if (row.some(function (v) { return v.trim(); })) rows.push(row);
    return rows;
  }
  function tableQuestions(rows) {
    if (!rows.length || rows[0].length < 2) throw new Error("Use two columns: question and answer.");
    var header = rows[0].map(function (v) { return v.trim().toLowerCase().replace(/[\s_-]+/g, ""); });
    var hasHeader = ["question", "q", "prompt", "front", "term"].indexOf(header[0]) !== -1;
    var names = hasHeader ? header : ["question", "answer", "topic", "explanation"];
    var questionColumn = names.findIndex(function (v) { return ["question", "q", "prompt", "front", "term"].indexOf(v) !== -1; });
    var answerColumn = names.findIndex(function (v) { return ["answer", "back", "a", "definition", "correctanswer", "correctindex"].indexOf(v) !== -1; });
    if (answerColumn < 0) throw new Error("Add an answer column to your table.");
    return rows.slice(hasHeader ? 1 : 0).map(function (row, i) {
      if (row.length < 2) throw new Error("Table row " + (i + 1) + " needs a question and answer.");
      var q = { q: row[questionColumn], answer: row[answerColumn] };
      names.forEach(function (name, j) {
        if (name === "topic" || name === "source") q.source = row[j];
        if (name === "explanation" || name === "explain") q.explain = row[j];
        if (name === "choices" || name === "options") {
          try { q.choices = JSON.parse(row[j]); }
          catch (e) { throw new Error("The choices cell in row " + (i + 1) + " must be a JSON list."); }
        }
      });
      return q;
    });
  }
  function parseResult(pack, issues, input) {
    return { pack: pack, issues: issues, stats: {
      cards: pack ? pack.questions.length : 0, issues: issues.length,
      lines: input ? input.split(/\r\n?|\n/).length : 0
    } };
  }
  function plainTextReport(input, options) {
    var rows = [], issues = [], issueLines = new Set(), seen = new Set(), ids = new Set();
    var source = "General", pending = null, lines = input.split(/\r\n?|\n/);
    function issue(line, reason) {
      if (issueLines.has(line)) return;
      issueLines.add(line);
      issues.push({ line: line, text: lines[line - 1], reason: reason });
    }
    function add(row, line) {
      try {
        var question = normalizeQuestion(row, rows.length);
        var key = JSON.stringify([question.q, question.answer]);
        if (seen.has(key)) { issue(line, "Duplicate question and answer"); return; }
        if (ids.has(question.id)) { issue(line, "Question shares another question's ID"); return; }
        if (rows.length >= MAX_QUESTIONS) {
          issue(line, "A pack can contain up to " + MAX_QUESTIONS + " questions."); return;
        }
        seen.add(key); ids.add(question.id); rows.push(question);
      } catch (e) { issue(line, e.message); }
    }
    function finishBlock() {
      if (!pending) return;
      if (pending.answerLine === null) issue(pending.line, "Q: needs an A: answer.");
      else add({ q: pending.q, answer: pending.answer.join("\n"), source: pending.source }, pending.line);
      pending = null;
    }
    function separator(line, patterns) {
      var urls = [], urlPattern = /https?:\/\/\S+/gi, url;
      while ((url = urlPattern.exec(line))) urls.push([url.index, url.index + url[0].length]);
      for (var i = 0; i < patterns.length; i++) {
        var match;
        while ((match = patterns[i].exec(line))) {
          if (!urls.some(function (range) { return match.index >= range[0] && match.index < range[1]; })) {
            return { left: line.slice(0, match.index).trim(), right: line.slice(match.index + match[0].length).trim(), colon: i === 1 };
          }
        }
      }
      return null;
    }
    lines.forEach(function (rawLine, index) {
      var number = index + 1, line = rawLine.trim();
      if (!line) { finishBlock(); return; }
      line = line.replace(/^(?:[-*+•]|\d+[.)])\s+/, "");
      var heading = line.match(/^#{1,6}\s+(.*)$/);
      if (heading) { finishBlock(); source = heading[1].trim().slice(0, 100) || "General"; return; }
      var match = line.match(/^(?:Q|Question):\s*(.*)$/i);
      if (match) {
        finishBlock();
        pending = { q: match[1], source: source, line: number, answerLine: null, answer: [] };
        return;
      }
      match = line.match(/^(?:A|Ans|Answer):\s*(.*)$/i);
      if (match) {
        if (!pending) issue(number, "Answer needs a preceding Q:.");
        else if (pending.answerLine !== null) issue(number, "A second A: is not allowed in one Q:/A: block.");
        else { pending.answerLine = number; pending.answer.push(match[1]); }
        return;
      }
      if (pending) {
        if (pending.answerLine !== null) pending.answer.push(line);
        else issue(number, "Expected an A: answer after the preceding Q:.");
        return;
      }
      if (/^https?:\/\/\S+$/i.test(line)) {
        issue(number, "A URL is not a question/answer pair. Paste the question and answer instead."); return;
      }
      var pair = separator(line, [/::/g, /:[ \t]+/g, /[ \t]+=[ \t]+/g, /[ \t]+->[ \t]+/g,
        /[ \t]+=>[ \t]+/g, /[ \t]+→[ \t]+/g, /[ \t]+—[ \t]+/g, /[ \t]+–[ \t]+/g,
        /[ \t]+-[ \t]+/g, /[ \t]+\/[ \t]+/g]);
      if (!pair) {
        issue(number, "This line is not a question/answer pair. Use Term: definition or Q: / A: lines; ACED does not invent answers from prose.");
        return;
      }
      var term = pair.left.replace(/^(?:\*\*|__)/, "").replace(/(?:\*\*|__)$/, "").trim();
      var answer = pair.right, topic = source;
      if (pair.colon && /^(?:spanish|french|german|italian|portuguese|japanese|chinese|mandarin|korean|latin|arabic|russian|hindi|vocab|vocabulary)$/i.test(term)) {
        var languagePair = separator(answer, [/[ \t]+\/[ \t]+/g]);
        if (languagePair) { topic = term; term = languagePair.left; answer = languagePair.right; }
      }
      term = term.replace(/^(?:\*\*|__)/, "").replace(/(?:\*\*|__)$/, "").trim();
      add({ q: /[?？]$/.test(term) ? term : term ? "What is " + term + "?" : "", answer: answer, source: topic }, number);
    });
    finishBlock();
    issues.sort(function (a, b) { return a.line - b.line; });
    return parseResult(rows.length ? normalize({ questions: rows }, options) : null, issues, input);
  }
  function parse(input, options) {
    options = options || {};
    if (options.report && typeof input === "string" && !input.trim()) return parseResult(null, [], input);
    if (typeof input !== "string" || !input.trim()) throw new Error("Paste some questions or choose a study-pack file first.");
    if (input.length > MAX_TEXT) throw new Error("This input is too large. Split it into smaller packs.");
    var plainInput = input.replace(/^\uFEFF/, "");
    input = input.replace(/^\uFEFF/, "").trim();
    if (/^[\[{]/.test(input)) {
      var raw;
      try { raw = JSON.parse(input); }
      catch (e) { throw new Error("That JSON is not valid. Check its commas, quotation marks and brackets."); }
      var jsonPack = normalize(raw, options);
      return options.report ? parseResult(jsonPack, [], plainInput) : jsonPack;
    }
    var firstLine = input.split(/\r?\n/)[0];
    var ext = String(options.filename || "").split(".").pop().toLowerCase();
    if (ext === "csv" || ext === "tsv" || firstLine.indexOf("\t") >= 0 || /^(question|q|prompt|front|term)\s*,/i.test(firstLine)) {
      var tablePack = normalize({ questions: tableQuestions(parseDelimited(input, ext === "tsv" || firstLine.indexOf("\t") >= 0 ? "\t" : ",")) }, options);
      return options.report ? parseResult(tablePack, [], plainInput) : tablePack;
    }
    var result = plainTextReport(plainInput, options);
    if (options.report) return result;
    if (result.issues.length) {
      var message = result.issues.slice(0, 5).map(function (entry) { return "Line " + entry.line + ": " + entry.reason; }).join("\n");
      if (result.issues.length > 5) message += "\nAnd " + (result.issues.length - 5) + " more";
      var error = new Error(message); error.issues = result.issues; throw error;
    }
    return result.pack || normalize({ questions: [] }, options);
  }
  function registry() {
    var data = read(KEY, { version: 1, packs: [] });
    if (!data || !Array.isArray(data.packs)) return { version: 1, packs: [] };
    return data;
  }
  function list() {
    return registry().packs.filter(function (p) { return p && validPackId(p.id) && Array.isArray(p.questions); });
  }
  function starter(id) { return STARTERS.find(function (p) { return p.id === id; }) || null; }
  function get(id) { return list().find(function (p) { return p.id === id; }) || null; }
  function save(raw) {
    var pack = normalize(raw), data = registry(), existing = get(pack.id);
    if (starter(pack.id)) { pack.id = newId(pack.name); existing = null; }
    pack.createdAt = existing ? existing.createdAt : Date.now();
    pack.updatedAt = Date.now();
    data.packs = data.packs.filter(function (p) { return p.id !== pack.id; });
    data.packs.unshift(pack);
    write(KEY, data);
    if (existing) {
      var history = learning(pack.id), review = read("aced:" + pack.id + ":review", {}), reset = false;
      var oldQuestions = new Map(existing.questions.map(function (q) { return [q.id, q]; }));
      pack.questions.forEach(function (q) {
        var old = oldQuestions.get(q.id);
        if (!old) return;
        var before = old.choices.length ? old.choices[old.answer] : old.answer;
        var after = q.choices.length ? q.choices[q.answer] : q.answer;
        if (before !== after || old.kind !== q.kind) {
          delete history.answers[q.id]; delete review[q.id]; reset = true;
        }
      });
      if (reset) {
        write("aced:" + pack.id + ":learning_v1", history);
        write("aced:" + pack.id + ":review", review);
      }
    }
    return pack;
  }
  function remove(id) {
    if (!validPackId(id)) return;
    var data = registry();
    data.packs = data.packs.filter(function (p) { return p.id !== id; });
    write(KEY, data);
    var prefix = "aced:" + id + ":";
    Object.keys(memory).forEach(function (key) { if (key.indexOf(prefix) === 0) delete memory[key]; });
    if (persistent) {
      try {
        for (var i = storage().length - 1; i >= 0; i--) {
          var key = storage().key(i);
          if (key && key.indexOf(prefix) === 0) storage().removeItem(key);
        }
      } catch (e) { persistent = false; }
    }
    var a = activity(); delete a[id]; write(ACTIVITY, a);
  }
  function activity() { return read(ACTIVITY, {}); }
  function touch(id) {
    if (!validPackId(id)) return;
    var a = activity(); a[id] = Date.now(); write(ACTIVITY, a);
  }
  function lastPack() {
    var a = activity(), ids = Object.keys(a).filter(function (id) { return !!starter(id) || !!get(id); });
    ids.sort(function (x, y) { return a[y] - a[x]; });
    return ids[0] || STARTERS[0].id;
  }
  function load(id) {
    var mine = get(id);
    if (mine) return Promise.resolve(normalize(mine));
    var meta = starter(id);
    if (!meta) return Promise.reject(new Error("This pack is not saved in this browser. Import its file or ask its author for a share link."));
    if (loaded[id]) return loaded[id];
    loaded[id] = new Promise(function (resolve, reject) {
      var script = root.document.createElement("script");
      script.src = meta.file;
      script.onload = function () {
        try {
          var raw = root.ACED_STARTER_PACKS && root.ACED_STARTER_PACKS[id] || root.ACED_PACK;
          if (!raw || raw.id !== id) throw new Error("The starter pack could not be read.");
          var pack = normalize(raw, { subject: meta.subject, name: meta.name });
          resolve(pack);
        } catch (e) { delete loaded[id]; reject(e); }
      };
      script.onerror = function () { delete loaded[id]; reject(new Error("The starter pack could not load. Check your connection and try again.")); };
      root.document.head.appendChild(script);
    });
    return loaded[id];
  }
  function learning(id) {
    var value = read("aced:" + id + ":learning_v1", null);
    if (!value || typeof value !== "object" || Array.isArray(value)) value = {};
    if (!value.answers || typeof value.answers !== "object" || Array.isArray(value.answers)) value.answers = {};
    ["attempts", "correct", "selfRated"].forEach(function (key) {
      value[key] = Math.max(0, Number(value[key]) || 0);
    });
    return value;
  }
  function progress(id, questions) {
    var s = learning(id), count = Array.isArray(questions) ? questions.length : Number(questions) || 0;
    var ids = Array.isArray(questions) ? questions.map(function (q) { return q.id; }) : Object.keys(s.answers || {});
    var strength = 0, practiced = 0;
    ids.forEach(function (key) {
      var answer = (s.answers || {})[key];
      if (answer) { practiced++; strength += Math.max(0, Math.min(2, Number(answer.strength) || 0)); }
    });
    return { pct: count ? Math.round(strength / (count * 2) * 100) : 0,
      practiced: practiced, count: count, attempts: s.attempts || 0, correct: s.correct || 0, selfRated: s.selfRated || 0 };
  }
  function exportText(pack) {
    var clean = normalize(pack);
    delete clean.createdAt; delete clean.updatedAt;
    return JSON.stringify(clean, null, 2);
  }
  function encode(value) {
    var bytes = new TextEncoder().encode(value), binary = "", i;
    for (i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return root.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decode(value) {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 200000) throw new Error("This share link is invalid or too large. Ask for the pack file instead.");
    var base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    base64 += "=".repeat((4 - base64.length % 4) % 4);
    try {
      var bytes = Uint8Array.from(root.atob(base64), function (c) { return c.charCodeAt(0); });
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) { throw new Error("This share link could not be decoded. Ask the author to export the pack again."); }
  }
  function shareUrl(pack) {
    var clean = normalize(pack);
    delete clean.createdAt; delete clean.updatedAt;
    clean.id = "shared-" + hash(JSON.stringify(clean.questions) + clean.name);
    var payload = encode(JSON.stringify(clean));
    if (payload.length > MAX_SHARE) throw new Error("This pack is too large for a reliable share link. Export its JSON file and send that instead.");
    var pageUrl = new URL(root.location.href);
    // Never put a capability-bearing or expiring preview URL into a shared pack.
    var temporaryHost = /(^|\.)(?:pplx\.app|perplexity\.ai|vercel\.app)$/i.test(pageUrl.hostname);
    var url = temporaryHost || !/^https?:$/.test(pageUrl.protocol)
      ? new URL("https://acedhq.com/importer.html") : new URL("importer.html", pageUrl);
    url.username = ""; url.password = "";
    url.hash = "pack=" + payload;
    return url.href;
  }
  function importShared(fragment) {
    var params = new URLSearchParams(String(fragment || "").replace(/^#/, ""));
    var payload = params.get("pack");
    if (!payload) return null;
    var raw;
    try { raw = JSON.parse(decode(payload)); }
    catch (e) { throw new Error("This shared pack is invalid. Ask its author for a new link or JSON export."); }
    var result = normalize(raw);
    result.id = newId(result.name); // importing never silently overwrites a saved pack
    return result;
  }
  function stashDraft(value) { return write(DRAFT, value); }
  function getDraft() { return read(DRAFT, null); }
  function migrate() {
    if (read("aced:pack-migration:v1", false)) return;
    var legacy = read("aced:local:customPack", null);
    if (legacy && (legacy.questions || legacy.cards)) {
      try { legacy.id = newId(legacy.name || legacy.title); save(legacy); }
      catch (e) { /* Leave the user's original value intact if its format is unsupported. */ }
    }
    write("aced:pack-migration:v1", true);
  }
  var api = {
    starters: STARTERS, maxFileBytes: 5 * 1024 * 1024,
    normalize: normalize, normalizeQuestion: normalizeQuestion, parse: parse,
    list: list, get: get, save: save, remove: remove, load: load, starter: starter,
    activity: activity, touch: touch, lastPack: lastPack, progress: progress, learning: learning,
    saveLearning: function (packId, value) {
      if (!validPackId(packId)) throw new Error("Invalid pack identity.");
      return write("aced:" + packId + ":learning_v1", value);
    },
    exportText: exportText, shareUrl: shareUrl, importShared: importShared, encode: encode, decode: decode,
    stashDraft: stashDraft, getDraft: getDraft, newId: newId, hash: hash,
    isPersistent: function () { return persistent; }
  };
  migrate();
  root.ACEDLibrary = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
