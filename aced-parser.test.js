"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const L = require("./aced-library.js");

const report = (text, options) => L.parse(text, Object.assign({}, options, { report: true }));
const only = text => L.parse(text).questions[0];

test("term direction and identity stay compatible with normalizeQuestion", () => {
  const expected = L.normalizeQuestion({ q: "What is Mitochondria?", answer: "Produces ATP" }, 0);
  const actual = only("Mitochondria: Produces ATP");
  assert.deepEqual(actual, expected);
});

test("Q/A blocks retain multiline answers until a blank line", () => {
  const q = only("Q: Name two.\nA: One.\nTwo.");
  assert.equal(q.q, "Name two.");
  assert.equal(q.answer, "One.\nTwo.");
});

test("a new Q: ends the previous block without requiring a blank line", () => {
  const p = L.parse("Q: First?\nA: One.\nQ: Second?\nAnswer: Two.");
  assert.equal(p.questions.length, 2);
  assert.equal(p.questions[0].answer, "One.");
  assert.equal(p.questions[1].answer, "Two.");
});

test("an orphan A: reports its line and requires a preceding Q:", () => {
  const r = report("A: Paris");
  assert.equal(r.pack, null);
  assert.equal(r.stats.cards, 0);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].line, 1);
  assert.equal(r.issues[0].text, "A: Paris");
  assert.match(r.issues[0].reason, /preceding Q:/);
});

test("times are not term separators", () => {
  const r = report("Meeting 10:30");
  assert.equal(r.pack, null);
  assert.equal(r.stats.cards, 0);
  assert.equal(r.issues.length, 1);
});

test("an explicit double-colon separator preserves a time answer", () => {
  const q = only("Meeting time? :: 10:30");
  assert.equal(q.q, "Meeting time?");
  assert.equal(q.answer, "10:30");
});

test("report mode retains a valid card and reports prose on line 2", () => {
  const r = report("Dog: perro\nThis is just prose.");
  assert.equal(r.pack.questions.length, 1);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].line, 2);
  assert.equal(r.issues[0].text, "This is just prose.");
  assert.deepEqual(r.stats, { cards: 1, issues: 1, lines: 2 });
});

test("default mode still throws instead of silently importing partial input", () => {
  assert.throws(() => L.parse("Dog: perro\nThis is just prose."), error => {
    assert.match(error.message, /Line 2:/);
    assert.equal(error.issues.length, 1);
    assert.equal(error.issues[0].line, 2);
    return true;
  });
});

test("headings set topic source for the following cards", () => {
  const p = L.parse("# Biology\nATP: Cellular energy");
  assert.equal(p.questions[0].source, "Biology");
  assert.equal(p.questions[0].q, "What is ATP?");
});

test("duplicate questions and answers become one issue without losing the first card", () => {
  const r = report("Dog: perro\nDog: perro");
  assert.equal(r.pack.questions.length, 1);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].line, 2);
  assert.equal(r.issues[0].reason, "Duplicate question and answer");
});

test("language-prefixed slash pairs use the vocabulary term and language source", () => {
  const q = only("Spanish: perro / dog");
  assert.equal(q.q, "What is perro?");
  assert.equal(q.answer, "dog");
  assert.equal(q.source, "Spanish");
});

test("A-list is a term, not an answer label", () => {
  const q = only("A-list celebrity: famous person");
  assert.equal(q.q, "What is A-list celebrity?");
  assert.equal(q.answer, "famous person");
});

test("bold Markdown delimiters are removed from the term only", () => {
  const q = only("**Asset**: a resource");
  assert.equal(q.q, "What is Asset?");
  assert.equal(q.answer, "a resource");
  assert.equal(only("__Asset__: **a resource**").answer, "**a resource**");
});

test("a spaced hyphen can separate a term and definition", () => {
  const q = only("Term - definition");
  assert.equal(q.q, "What is Term?");
  assert.equal(q.answer, "definition");
});

test("an inline URL is not split on the protocol colon", () => {
  const r = report("See https://x.com");
  assert.equal(r.pack, null);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].text, "See https://x.com");
});

test("leading blanks preserve physical line numbers and original issue text", () => {
  const r = report("\n\nDog: perro\n   This is prose.  \n");
  assert.equal(r.pack.questions.length, 1);
  assert.equal(r.issues[0].line, 4);
  assert.equal(r.issues[0].text, "   This is prose.  ");
});

test("CSV question/answer headers and filename dispatch remain unchanged", () => {
  const text = "question,answer\nCapital?,Paris";
  const p = L.parse(text, { filename: "cards.csv" });
  const r = report(text, { filename: "cards.csv" });
  assert.equal(p.questions[0].q, "Capital?");
  assert.equal(p.questions[0].answer, "Paris");
  assert.deepEqual(r.pack.questions, p.questions);
  assert.deepEqual(r.issues, []);
  assert.equal(r.stats.cards, 1);
});

test("JSON keeps answer index zero in default and report modes", () => {
  const text = JSON.stringify({ questions: [{ q: "Pick one", choices: ["A", "B"], answer: 0 }] });
  assert.equal(L.parse(text).questions[0].answer, 0);
  const r = report(text);
  assert.equal(r.pack.questions[0].answer, 0);
  assert.deepEqual(r.issues, []);
});

test("TSV and quoted multiline CSV retain the structured parser behavior", () => {
  assert.equal(report("question\tanswer\nQ?\tA", { filename: "cards.tsv" }).pack.questions[0].answer, "A");
  const text = 'question,answer\n"Q, really?","One.\nTwo."';
  assert.equal(report(text, { filename: "cards.csv" }).pack.questions[0].answer, "One.\nTwo.");
  assert.throws(() => report("question,answer\nQ", { filename: "cards.csv" }), /needs a question and answer/);
  assert.throws(() => report("{broken"), /JSON is not valid/);
});

test("all supported list markers are stripped once", () => {
  for (const marker of ["-", "*", "+", "•", "1.", "1)"]) {
    assert.equal(only(marker + " **Nucleus** - holds DNA").q, "What is Nucleus?");
  }
  assert.equal(only("- - Term: definition").q, "What is - Term?");
});

test("all supported spaced separators work", () => {
  for (const separator of [" = ", " -> ", " => ", " → ", " — ", " – ", " - ", " / "]) {
    assert.equal(only("Term" + separator + "definition").answer, "definition");
  }
});

test("separator priority selects double colon, then colon-space before other separators", () => {
  assert.equal(only("Term: qualifier :: answer").q, "What is Term: qualifier?");
  assert.equal(only("Term - qualifier: answer").q, "What is Term - qualifier?");
  assert.equal(only("https://x.com:8080 :: URL answer").answer, "URL answer");
  const r = report("See https://[::1]:8080");
  assert.equal(r.pack, null);
  assert.equal(r.issues.length, 1);
});

test("labels require a colon immediately after Q/Question/A/Ans/Answer", () => {
  for (const label of ["A", "Ans", "Answer"]) {
    assert.equal(only("Question: Q?\n" + label + ": Answer.").answer, "Answer.");
  }
  for (const label of ["A-", "A."]) {
    const r = report("Q: Q?\n" + label + " Answer.");
    assert.equal(r.pack, null);
    assert.ok(r.issues.some(i => /needs an A:/.test(i.reason)));
  }
});

test("missing and duplicate answer labels report the actual problem lines", () => {
  const missing = report("Q: Missing?\n\nGood: answer");
  assert.equal(missing.pack.questions.length, 1);
  assert.equal(missing.issues[0].line, 1);
  assert.match(missing.issues[0].reason, /needs an A:/);
  const duplicate = report("Q: Q?\nA: First.\nAns: Second.");
  assert.equal(duplicate.pack.questions[0].answer, "First.");
  assert.equal(duplicate.issues.length, 1);
  assert.equal(duplicate.issues[0].line, 3);
  assert.match(duplicate.issues[0].reason, /second A:/);
});

test("normalization failures are line issues, not report-mode crashes", () => {
  const r = report(":: answer\nQ:\nA: Answer\n\nGood: answer");
  assert.equal(r.pack.questions.length, 1);
  assert.deepEqual(r.issues.map(i => i.line), [1, 2]);
});

test("default errors show at most five issues but attach every issue", () => {
  const text = Array.from({ length: 8 }, (_, i) => "Prose line " + (i + 1)).join("\n");
  assert.throws(() => L.parse(text), error => {
    assert.equal(error.issues.length, 8);
    assert.equal((error.message.match(/Line \d+:/g) || []).length, 5);
    assert.match(error.message, /And 3 more/);
    assert.doesNotMatch(error.message, /Line 6:/);
    return true;
  });
});

test("headings are capped at 100 characters and General remains the default", () => {
  assert.equal(only("Dog: perro").source, "General");
  assert.equal(only("# " + "x".repeat(120) + "\nDog: perro").source.length, 100);
  assert.equal(report("# Biology\n\n").pack, null);
  assert.equal(report("").pack, null);
});

test("all supported language labels are matched case-insensitively", () => {
  for (const language of ["spanish", "french", "german", "italian", "portuguese", "japanese", "chinese", "mandarin", "korean", "latin", "arabic", "russian", "hindi", "vocab", "vocabulary"]) {
    const q = only(language.toUpperCase() + ": term / meaning");
    assert.equal(q.q, "What is term?");
    assert.equal(q.answer, "meaning");
    assert.equal(q.source, language.toUpperCase());
  }
});

test("the requested preview fixture produces exactly five cards and one issue", () => {
  const text = "# Biology\nMitochondria: makes most of a cell's ATP\nSpanish: perro / dog\nQ: Two membrane functions?\nA: Controls movement.\nHelps communication.\n\nMeeting time? :: 10:30\nThis line is just prose with no separator\n- **Nucleus** - holds DNA";
  const r = report(text);
  assert.equal(r.pack.questions.length, 5);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].line, 9);
  assert.equal(r.pack.questions[2].answer, "Controls movement.\nHelps communication.");
  assert.equal(r.pack.questions[4].q, "What is Nucleus?");
});
