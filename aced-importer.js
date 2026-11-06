(function () {
  "use strict";
  var L = window.ACEDLibrary, U = window.ACEDUI, esc = U.esc;
  var form = document.getElementById("pack-form"), notes = document.getElementById("pack-notes");
  var nameInput = document.getElementById("pack-name"), subjectInput = document.getElementById("pack-subject");
  var editors = document.getElementById("question-editors"), current = null, filename = "", editing = false;
  var parsed = null, issuesAccepted = true, editingIdentity = null, reviewEdited = false;
  var params = new URLSearchParams(location.search);
  function status(message, error) {
    var el = document.getElementById("import-status");
    el.hidden = !message; el.className = "status " + (error ? "error" : "success"); el.textContent = message || "";
    U.storageNotice();
  }
  function metadata() {
    var result = {};
    if (nameInput.value.trim()) result.name = nameInput.value.trim();
    if (subjectInput.value.trim()) result.subject = subjectInput.value.trim();
    if (filename) result.filename = filename;
    return result;
  }
  function stash() {
    if (!editing) L.stashDraft({ text: notes.value, name: nameInput.value, subject: subjectInput.value });
  }
  function updateSaveButtons() {
    var blocked = !current || !current.questions.length || !issuesAccepted;
    document.getElementById("save-play").disabled = blocked;
    document.getElementById("save-library").disabled = blocked;
  }
  function showInput(preserveOriginal) {
    document.getElementById("input-stage").hidden = false;
    document.getElementById("review-stage").hidden = true;
    document.getElementById("questions-section").hidden = true;
    // Keep rejected lines; saved/shared packs still retain unfinished edits.
    if (current && (!parsed || reviewEdited) && preserveOriginal !== true) notes.value = JSON.stringify(current, null, 2);
    filename = ""; notes.focus();
  }
  function renderReport() {
    var issues = parsed ? parsed.issues : [];
    status((current ? current.questions.length : 0) + " cards ready \u00b7 " + issues.length + " lines need attention", issues.length > 0);
    var el = document.getElementById("import-status");
    var hint = document.createElement("p");
    hint.textContent = "Leave a blank line after a Q:/A: block."; el.appendChild(hint);
    if (issues.length) {
      var list = document.createElement("ul"); list.id = "import-issues";
      issues.forEach(function (entry) {
        var item = document.createElement("li");
        item.textContent = "Line " + entry.line + ": " + entry.reason + " \u2014 " + entry.text;
        item.style.overflowWrap = "anywhere"; item.style.whiteSpace = "pre-wrap";
        list.appendChild(item);
      });
      el.appendChild(list);
      var actions = document.createElement("div"); actions.className = "button-row";
      var fix = document.createElement("button"); fix.type = "button"; fix.className = "button quiet"; fix.id = "fix-lines";
      fix.textContent = "Fix lines"; fix.onclick = function () { showInput(true); }; actions.appendChild(fix);
      var proceed = document.createElement("button"); proceed.type = "button"; proceed.className = "button"; proceed.id = "continue-lines";
      proceed.textContent = "Continue without these lines"; proceed.disabled = !current || !current.questions.length || issuesAccepted;
      proceed.onclick = function () {
        if (!current || !current.questions.length) return;
        issuesAccepted = true; updateSaveButtons(); renderReport();
        document.getElementById("save-play").focus();
      };
      actions.appendChild(proceed); el.appendChild(actions);
    }
    updateSaveButtons();
  }
  function clearResult() {
    if (editing && current) editingIdentity = { id: current.id, createdAt: current.createdAt };
    parsed = null; current = null; issuesAccepted = false; reviewEdited = false;
    editors.textContent = ""; document.getElementById("questions-section").hidden = true;
    updateSaveButtons(); status("");
  }
  function setReview(pack, result) {
    current = pack; parsed = result || null; issuesAccepted = !parsed || !parsed.issues.length; reviewEdited = false;
    if (pack) {
      nameInput.value = pack.name; subjectInput.value = pack.subject === "General" ? "" : pack.subject;
      if (editing) editingIdentity = { id: pack.id, createdAt: pack.createdAt };
    }
    document.getElementById("input-stage").hidden = true;
    document.getElementById("review-stage").hidden = false;
    document.getElementById("questions-section").hidden = !pack;
    renderEditors();
    document.getElementById("import-title").textContent = editing ? "Make this pack yours." : "Ready for a run?";
    document.getElementById("import-subtitle").textContent = "Check your questions, then save and play. No loadout decisions required.";
    renderReport();
    if (pack && issuesAccepted) document.getElementById("save-play").focus();
  }
  function parseNotes(review, options) {
    clearResult();
    options = Object.assign({}, options || metadata(), { report: true });
    var result = L.parse(notes.value, options), pack = result.pack;
    if (pack) {
      if (editingIdentity) { pack.id = editingIdentity.id; pack.createdAt = editingIdentity.createdAt; }
      else pack.id = L.newId(pack.name);
    }
    if (review) setReview(pack, result);
    else { current = pack; parsed = result; issuesAccepted = !result.issues.length; renderReport(); }
    return result;
  }
  function renderEditors() {
    document.getElementById("question-count").textContent = (current ? current.questions.length : 0) + " questions";
    editors.innerHTML = (current ? current.questions : []).map(function (q, i) {
      var choiceEditor = q.choices.length
        ? '<div class="field"><label class="field-label" for="q-answer-' + i + '">Correct answer</label><select id="q-answer-' + i + '" data-field="answer">' +
          q.choices.map(function (c, j) { return '<option value="' + j + '"' + (j === q.answer ? " selected" : "") + '>' + String.fromCharCode(65 + j) + " · " + esc(c.slice(0, 100)) + '</option>'; }).join("") + '</select></div>' +
          '<div class="field-grid">' + q.choices.map(function (c, j) { return '<div class="field"><label class="field-label" for="q-' + i + '-choice-' + j + '">Choice ' + String.fromCharCode(65 + j) + '</label><textarea id="q-' + i + '-choice-' + j + '" data-choice="' + j + '">' + esc(c) + '</textarea></div>'; }).join("") + '</div>'
        : '<div class="field"><label class="field-label" for="q-answer-' + i + '">Answer</label><textarea id="q-answer-' + i + '" data-field="answer">' + esc(q.answer) + '</textarea></div>';
      return '<details class="question-editor" data-question="' + i + '"' + (i === 0 ? " open" : "") + '>' +
        '<summary><span class="question-number">' + String(i + 1).padStart(2, "0") + '</span><span class="question-preview">' + esc(q.q) + '</span><span class="tag">' + (q.choices.length ? "MCQ" : "RECALL") + '</span></summary>' +
        '<div class="editor-body"><div class="field"><label class="field-label" for="q-prompt-' + i + '">Question</label><textarea id="q-prompt-' + i + '" data-field="q">' + esc(q.q) + '</textarea></div>' + choiceEditor +
        '<div class="field"><label class="field-label" for="q-topic-' + i + '">Topic</label><input id="q-topic-' + i + '" data-field="source" maxlength="100" value="' + esc(q.source) + '"></div>' +
        '<div class="field"><label class="field-label" for="q-explain-' + i + '">Explanation <span class="muted">(optional)</span></label><textarea id="q-explain-' + i + '" data-field="explain">' + esc(q.explain) + '</textarea></div>' +
        '<button type="button" class="button quiet" data-remove="' + i + '">Remove question</button></div></details>';
    }).join("");
  }
  editors.oninput = function (event) {
    var field = event.target, block = field.closest("[data-question]");
    if (!block) return;
    var q = current.questions[Number(block.dataset.question)];
    reviewEdited = true;
    if (field.hasAttribute("data-choice")) {
      var choice = Number(field.dataset.choice); q.choices[choice] = field.value;
      var option = block.querySelector('select[data-field="answer"] option[value="' + choice + '"]');
      if (option) option.textContent = String.fromCharCode(65 + choice) + " · " + field.value.slice(0, 100);
    } else if (field.dataset.field) {
      q[field.dataset.field] = field.dataset.field === "answer" && q.choices.length ? Number(field.value) : field.value;
      if (field.dataset.field === "q") block.querySelector(".question-preview").textContent = field.value;
    }
  };
  editors.onchange = editors.oninput;
  editors.onclick = function (event) {
    var button = event.target.closest("[data-remove]");
    if (!button || !current) return;
    current.questions.splice(Number(button.dataset.remove), 1); reviewEdited = true; renderEditors(); renderReport();
  };
  form.onsubmit = function (event) {
    event.preventDefault();
    if (!document.getElementById("input-stage").hidden) {
      try {
        parseNotes(true);
      } catch (e) { status(e.message, true); }
    }
  };
  async function readFile(file) {
    if (!file) return;
    if (file.size > L.maxFileBytes) { status("That file is larger than 5 MB. Split it into smaller study packs.", true); return; }
    if (!/\.(json|csv|tsv|txt|md|markdown)$/i.test(file.name)) {
      status("Choose a JSON, CSV, TSV, TXT or Markdown study pack. PDFs and documents need question/answer formatting first.", true); return;
    }
    try {
      clearResult();
      filename = file.name;
      notes.value = await file.text();
      var options = metadata();
      if (!nameInput.value.trim()) options.name = file.name.replace(/\.(aced\.)?(json|csv|tsv|txt|md|markdown)$/i, "").replace(/[-_]/g, " ");
      var ownTitle = !nameInput.value.trim(), result = parseNotes(true, options), pack = result.pack;
      // An exported pack's own title takes precedence over the filename.
      if (pack && /^\s*[\[{]/.test(notes.value) && ownTitle) {
        var raw = JSON.parse(notes.value);
        if (raw.name || raw.title) pack.name = String(raw.name || raw.title).slice(0, 100);
      }
      stash(); if (pack) nameInput.value = pack.name;
    } catch (e) { status(e.message, true); }
  }
  document.getElementById("pack-file").onchange = function (event) { readFile(event.target.files[0]); };
  var dropzone = document.getElementById("dropzone");
  ["dragenter", "dragover"].forEach(function (type) {
    dropzone.addEventListener(type, function (event) { event.preventDefault(); dropzone.classList.add("dragging"); });
  });
  ["dragleave", "drop"].forEach(function (type) {
    dropzone.addEventListener(type, function (event) {
      event.preventDefault(); dropzone.classList.remove("dragging");
      if (type === "drop") readFile(event.dataTransfer.files[0]);
    });
  });
  document.getElementById("example-button").onclick = function () {
    clearResult();
    notes.value = "Q: What kind of hands score points in ACED?\nA: Poker hands\n\nQ: What do correct answers earn?\nA: Insight and bonus cash\n\nQ: What can you buy between rounds?\nA: Jokers that change your scoring";
    if (!nameInput.value.trim()) nameInput.value = "ACED: getting started";
    if (!subjectInput.value.trim()) subjectInput.value = "Getting started";
    filename = ""; stash(); status("Example loaded. You can replace any of this with your own material.", false);
  };
  document.getElementById("back-input").onclick = showInput;
  document.getElementById("add-question").onclick = function () {
    if (!current) return;
    if (current.questions.length >= 2000) { status("This pack has reached the 2,000-question limit.", true); return; }
    current.questions.push({ id: "q-" + L.newId("new"), q: "Your question", answer: "Your answer", choices: [], source: "General", explain: "", kind: "recall" });
    reviewEdited = true;
    renderEditors(); renderReport(); var last = editors.lastElementChild; last.open = true; last.querySelector("textarea").focus();
  };
  function save(play) {
    try {
      if (!current || !current.questions.length || !issuesAccepted) { renderReport(); return; }
      current.name = nameInput.value.trim() || "Untitled pack";
      current.subject = subjectInput.value.trim() || "General";
      current = L.save(current); editing = true;
      editingIdentity = { id: current.id, createdAt: current.createdAt };
      history.replaceState(null, "", "importer.html?edit=" + encodeURIComponent(current.id));
      U.storageNotice();
      if (play) {
        // Only engine-owned literals may flow into the navigation URL.
        var selectedDifficulty = form.querySelector('[name="difficulty"]:checked');
        var difficulty = selectedDifficulty && selectedDifficulty.value === "casual" ? "casual"
          : selectedDifficulty && selectedDifficulty.value === "brutal" ? "brutal" : "standard";
        var selectedRelic = form.querySelector('[name="relic"]:checked');
        var relic = selectedRelic && selectedRelic.value === "warmup" ? "warmup"
          : selectedRelic && selectedRelic.value === "flowstate" ? "flowstate"
          : selectedRelic && selectedRelic.value === "snowball" ? "snowball" : "";
        var url = "study.html?pack=" + encodeURIComponent(current.id) + "&difficulty=" + encodeURIComponent(difficulty)
          + (relic ? "&relic=" + encodeURIComponent(relic) : "");
        if (!L.isPersistent()) {
          var payload = L.encode(L.exportText(current));
          if (payload.length > 190000) throw new Error("Browser saving is blocked and this pack is too large to carry between pages. Export it and open ACED in its own tab.");
          url += "#pack=" + payload;
        }
        location.href = url;
      } else {
        status(L.isPersistent() ? "Saved to your library. You can keep editing or play whenever you're ready." : "Available in this tab only. Browser saving is blocked; export a backup before leaving.", false);
        var el = document.getElementById("import-status");
        var exportButton = document.createElement("button"); exportButton.type = "button"; exportButton.className = "button quiet";
        exportButton.textContent = "Export backup"; exportButton.onclick = function () { U.download(current); };
        el.appendChild(document.createElement("br")); el.appendChild(exportButton);
      }
    } catch (e) { status(e.message, true); }
  }
  document.getElementById("save-play").onclick = function () { save(true); };
  document.getElementById("save-library").onclick = function () { save(false); };
  notes.addEventListener("input", function () {
    var reparse = !!parsed; filename = ""; clearResult(); stash();
    if (reparse) {
      try { parseNotes(false); } catch (e) { status(e.message, true); }
    }
  });
  nameInput.addEventListener("input", stash); subjectInput.addEventListener("input", stash);
  updateSaveButtons();
  try {
    var shared = L.importShared(location.hash);
    if (shared) { setReview(shared); status("Shared pack opened. Review it, then save your own copy. Nothing has been added to your library yet.", false); }
    else if (params.get("edit")) {
      current = L.get(params.get("edit"));
      if (!current) throw new Error("This pack is not in this browser's library. Import its file or open a share link.");
      current = JSON.parse(JSON.stringify(current)); editing = true; setReview(current);
      document.getElementById("import-eyebrow").textContent = "aced.edit / Your saved pack";
    } else {
      var fragment = new URLSearchParams(location.hash.replace(/^#/, "")), draft = L.getDraft();
      if (fragment.get("notes")) notes.value = L.decode(fragment.get("notes"));
      else if (draft) { notes.value = draft.text || ""; nameInput.value = draft.name || ""; subjectInput.value = draft.subject || ""; }
      if (params.get("boot") && notes.value.trim()) {
        try { parseNotes(true); }
        catch (e) { status(e.message, true); }
      }
    }
  } catch (e) { status(e.message, true); }
})();
