"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const B = require("./aced-bridge.js");
const L = require("./aced-library.js");
require("./tools/lib/question-id-integrity-tests")("library");

function pack() {
  return L.normalize({
    name: "Cells", questions: [
      { q: "Powerhouse of the cell?", answer: "Mitochondria", source: "Organelles" },
      { q: "Site of protein synthesis?", answer: "Ribosome", source: "Organelles" },
      { q: "Stores genetic material?", answer: "Nucleus", source: "Organelles" },
      { q: "Photosynthesis happens in?", answer: "Chloroplast", source: "Plants" },
      { q: "Pick the prime", choices: ["4", "6", "7", "9"], answer: 2, source: "Math", explain: "7 only divides by 1 and 7." }
    ]
  });
}

test("multiple-choice questions pass through untouched", () => {
  const q = B.toEngineQuestions(pack()).find(x => x.q === "Pick the prime");
  assert.deepEqual(q.choices, ["4", "6", "7", "9"]);
  assert.equal(q.answer, 2);
  assert.equal(q.explain, "7 only divides by 1 and 7.");
});

test("open-ended cards become gradable multiple choice with the right answer", () => {
  const out = B.toEngineQuestions(pack());
  out.forEach((q, i) => {
    assert.ok(q.choices.length >= 2 && q.choices.length <= 4);
    assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.choices.length);
    assert.equal(new Set(q.choices.map(c => c.toLowerCase())).size, q.choices.length, "no duplicate options");
  });
  const mito = out[0];
  assert.equal(mito.choices[mito.answer], "Mitochondria");
  assert.match(mito.explain, /^Answer: Mitochondria/);
});

test("wrong options come from the same topic first", () => {
  const mito = B.toEngineQuestions(pack())[0];
  const wrong = mito.choices.filter((_, i) => i !== mito.answer);
  assert.ok(wrong.includes("Nucleus") && wrong.includes("Ribosome"));
});

test("conversion is deterministic so a question keeps its layout between runs", () => {
  assert.deepEqual(B.toEngineQuestions(pack()), B.toEngineQuestions(pack()));
});

test("duplicate answers never produce duplicate or correct-looking options", () => {
  const p = L.normalize({ name: "Dupes", questions: [
    { q: "One?", answer: "True" }, { q: "Two?", answer: "true" }, { q: "Three?", answer: "False" }
  ] });
  B.toEngineQuestions(p).forEach(q => {
    assert.equal(new Set(q.choices.map(c => c.toLowerCase())).size, q.choices.length);
    assert.equal(q.choices.length, q.choices.filter(c => c.length).length);
  });
});

test("a pack with a single distinct answer still yields a valid question", () => {
  const p = L.normalize({ name: "Solo", questions: [{ q: "Only?", answer: "Yes" }] });
  const q = B.toEngineQuestions(p)[0];
  assert.deepEqual(q.choices.slice().sort(), ["None of the above", "Yes"]);
  assert.equal(q.choices[q.answer], "Yes");
});

test("question ids are preserved so progress maps back to the library", () => {
  const p = pack();
  assert.deepEqual(B.toEngineQuestions(p).map(q => q.id), p.questions.map(q => q.id));
});

test("difficulty and starting joker map to engine mods from fixed literals only", () => {
  assert.deepEqual(B.mods("casual"), { stakesMult: 0.75, startMoney: 8 });
  assert.deepEqual(B.mods("brutal", "snowball"), { stakesMult: 1.35, startMoney: 4, relicJoker: "snowball" });
  assert.deepEqual(B.mods("brutal&pack=x#evil", "<script>"), { stakesMult: 1, startMoney: 4 });
  assert.deepEqual(B.mods("__proto__", "constructor"), { stakesMult: 1, startMoney: 4 });
  assert.deepEqual(B.mods(undefined, undefined), { stakesMult: 1, startMoney: 4 });
});

test("answers are recorded as library progress with strength that builds and resets", () => {
  const library = L;
  const record = B.recorder(library, "positive-bridge");
  record({ id: "q1" }, true); record({ id: "q1" }, true);
  let saved = library.learning("positive-bridge");
  assert.equal(saved.answers.q1.strength, 2);
  assert.equal(saved.attempts, 2);
  assert.equal(saved.correct, 2);
  record({ id: "q1" }, false);
  saved = library.learning("positive-bridge");
  assert.equal(saved.answers.q1.strength, 0);
  assert.equal(saved.answers.q1.attempts, 3);
});

test("recording never throws into the game", () => {
  const record = B.recorder({ learning() { throw new Error("storage blocked"); }, saveLearning() {} }, "x");
  assert.doesNotThrow(() => record({ id: "q" }, true));
});
