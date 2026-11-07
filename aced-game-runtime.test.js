"use strict";

// Node builtins only. Execute the production loader, engine functions and real
// handlers against synthetic data; never import the historical score harness.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createRuntime } = require("./tools/lib/runtime-fixture");

const hostile = '<img src=x onerror="synthetic()"> & \'quoted\' Ω.β';
const escaped = "&lt;img src=x onerror=&quot;synthetic()&quot;&gt; &amp; &#39;quoted&#39; Ω.β";
function inert(markup) {
  assert.ok(!markup.includes("<img"), "synthetic authored tag must not become markup");
  // Entities are not delimiters during HTML tokenization. Inspect actual
  // attribute boundaries rather than mistaking literal 'onerror' text for one.
  for (const tag of markup.match(/<[A-Za-z][^>]*>/g) || []) {
    const attributes = tag.replace(/"[^"]*"|'[^']*'/g, "");
    assert.ok(!/\bon[a-z]+\s*=/i.test(attributes), "no event-handler attribute may be introduced");
  }
}
function authoredRuntime(extra = {}) {
  const topics = [hostile, "__proto__", "constructor", "toString", "hasOwnProperty", "正常な話題"];
  const raw = { id: "runtime-fixture", name: "Synthetic authored fixture", questions: topics.map((source, i) =>
    ({ id: "authored-q" + i, q: "Synthetic stem " + i, choices: ["Synthetic A", "Synthetic B"],
      answer: 0, source, explain: "Synthetic explanation " + i })) };
  const mastery = Object.fromEntries(topics.map((topic, i) => [topic, i + 1]));
  return createRuntime({ ...extra, raw,
    initial: { "aced:runtime-fixture:mastery": mastery, ...(extra.initial || {}) } });
}

test("C01: actual imported topics retain own labels, IDs and saved bytes", () => {
  const f = authoredRuntime();
  const libraryBefore = f.memory.get("aced:packs:v1");
  const masteryBefore = f.memory.get("aced:runtime-fixture:mastery");
  f.api.start();
  f.api.renderMastery();
  const markup = f.document.getElementById("masteryBody").innerHTML;
  inert(markup); assert.ok(markup.includes(escaped), "mastery key and label must be escaped");
  for (const topic of ["__proto__", "constructor", "toString", "hasOwnProperty", "正常な話題"]) {
    assert.ok(Object.hasOwn(f.api.modules, topic), "authored module must remain an own property");
    assert.equal(f.api.modules[topic], topic);
    assert.ok(markup.includes(topic), "all touched own-property topics stay visible");
  }
  assert.equal(f.api.qbank[0].source, hostile);
  assert.equal(f.api.qbank[0].id, "authored-q0");
  assert.equal(f.memory.get("aced:packs:v1"), libraryBefore);
  assert.equal(f.memory.get("aced:runtime-fixture:mastery"), masteryBefore);
  assert.equal(f.requests.length, 0);
});

test("C01: a separate authored display label is escaped without changing its key", () => {
  const f = createRuntime({
    initial: { "aced:runtime-fixture:mastery": { "Fixture topic": 1 } },
    configurePack(pack) { pack.modules["Fixture topic"] = hostile; }
  });
  const before = f.memory.get("aced:runtime-fixture:mastery");
  f.api.start();
  const markup = f.document.getElementById("masteryBody").innerHTML;
  inert(markup); assert.ok(markup.includes('class="mk">Fixture topic</span>'));
  assert.ok(markup.includes('class="mlbl">' + escaped + "</span>"));
  assert.equal(f.api.modules["Fixture topic"], hostile);
  assert.equal(f.api.qbank[0].source, "Fixture topic");
  assert.equal(f.memory.get("aced:runtime-fixture:mastery"), before);
});

test("C01: actual coverage, card/tooltips/ARIA and deck names stay literal", () => {
  const f = authoredRuntime(); f.api.start();
  f.api.renderReadiness();
  inert(f.document.getElementById("coverageRow").innerHTML);
  assert.ok(f.document.getElementById("coverageRow").innerHTML.includes(escaped));
  const card = f.api.mk({ n: hostile, el: "S", v: 2, rank: 2, suit: "S",
    moduleKey: hostile, tags: [hostile] });
  const markup = f.api.cardHTML(card);
  inert(markup); assert.ok(markup.includes('aria-label="' + escaped));
  assert.ok(markup.includes('class="modk">' + escaped));
  f.api.G.masterDeck = [card]; f.api.G.hand = [card]; f.api.G._tipId = card.id;
  f.api.showCardTip(card);
  inert(f.document.getElementById("cardTip").innerHTML);
  f.api.deckView(); inert(f.modal()); assert.ok(f.modal().includes(escaped));
});

test("C01: actual audit chooser and selected topic handlers preserve escaped labels", () => {
  const f = authoredRuntime(); f.api.start();
  const [button] = f.choices(".auditpick", [{ mk: hostile }]);
  f.api.renderAuditPicker([{ mk: hostile, pct: 2, charge: 1, bounty: 10 }]);
  inert(f.modal()); assert.ok(f.modal().includes('data-mk="' + escaped + '"'));
  assert.ok(f.modal().includes('aria-label="' + escaped + ", mastery"));
  button.onclick();
  inert(f.modal()); assert.ok(f.modal().includes(escaped));
  assert.equal(f.api.qbank[0].source, hostile, "handler must not rewrite original topic");
});

test("C01: actual drill, review, notes, reports and Nemesis surfaces escape topics", () => {
  const f = authoredRuntime(); f.api.start();
  const libraryBefore = f.memory.get("aced:packs:v1");
  f.api.G.missedThisRun = [{ q: f.api.qbank[0], mk: hostile }];
  const actions = [
    () => f.api.drillModule(hostile),
    () => f.api.runQuiz({ title: hostile, kind: "review", questions: [f.api.qbank[0]] }),
    () => f.api.explanationsView(), () => f.api.readinessReport(),
    () => f.api.runInfoView(), () => f.api.studyReport()
  ];
  for (const action of actions) {
    action(); inert(f.modal()); assert.ok(f.modal().includes(escaped));
  }
  const nemesis = { name: hostile, epithet: hostile, module: hostile };
  f.context.ACEDNemesis = { current: () => nemesis, defeatCount: () => 0, hp: () => 5, maxHp: () => 10 };
  f.api.nemesisRise(nemesis);
  assert.ok(f.document.getElementById("toast").textContent.includes(hostile));
  f.api.codexView(); inert(f.modal()); assert.ok(f.modal().includes(escaped));
  assert.equal(f.memory.get("aced:packs:v1"), libraryBefore);
  assert.equal(f.requests.length, 0);
});

test("C01: calibration own-property topics and Unicode tooltips stay literal", () => {
  const f = authoredRuntime(); f.api.start();
  for (const topic of [hostile, "__proto__", "constructor", "hasOwnProperty"]) {
    for (let i = 0; i < 3; i++) {
      f.context.ACEDCore.calibration.record({ source: topic, confidence: "MED", correct: true });
    }
  }
  const rows = f.api.calibData().rows;
  assert.equal(rows.length, 4);
  assert.ok(rows.some(r => r.m === hostile && r.label === hostile));
  const markup = f.api.calibGridHTML();
  inert(markup); assert.ok(markup.includes('class="cgtip">' + escaped + "</span>"));
  assert.equal(f.evaluate("({}).n", "prototype-check"), undefined);
});

test("C01: fresh prototype-like topics score, charge and earn normal finite increments", async () => {
  const topics = ["__proto__", "constructor", "toString", "hasOwnProperty"];
  const f = createRuntime({
    raw: { id: "runtime-fixture", name: "Synthetic prototype fixture",
      questions: topics.map((source, i) => ({ id: "prototype-q" + i, q: "Synthetic item " + i,
        choices: ["Synthetic A", "Synthetic B"], answer: 0, source })) },
    initial: { "aced:runtime-fixture:mastery": { untouchedNumeric: 7, untouchedLegacy: "retained" } }
  });
  f.api.start(); f.api.fastAnimations(); f.api.G.jokers = [];
  f.api.G.target = 1e9; f.api.G.handsLeft = 100;
  const prototypeBefore = f.evaluate("JSON.stringify(Object.getOwnPropertyNames(Object.prototype))", "prototype-before");
  for (const topic of topics) {
    const q = f.api.qbank.find(q => q.source === topic);
    const card = f.api.G.masterDeck.find(c => c.moduleKey === topic);
    f.api.G.hand = [card]; f.api.G.sel = new Set([card.id]);
    await f.api.play();
    assert.equal(f.api.mastery[topic], 1);
    assert.ok(Object.hasOwn(f.api.mastery, topic));
    assert.equal(f.api.G._chargedThisClose[topic], 1);
    const [answer] = f.choices("[data-ach]", [{ ach: "0" }]);
    const [confidence] = f.choices("[data-conf]", [{ conf: "MED" }]);
    f.api.beginAuditQuestion(topic, q, 10, true);
    answer.onclick(); confidence.onclick(); f.document.getElementById("auditSubmit").onclick();
    assert.equal(f.api.mastery[topic], 9, "MED correct retains +8 mastery");
    assert.equal(f.api.G.conviction[topic], 2, "MED correct retains +2 conviction");
    const before = f.api.G.score;
    f.api.G.hand = [card]; f.api.G.sel = new Set([card.id]);
    await f.api.play();
    assert.equal(f.api.G.score - before, (card.v + 5) * 3, "conviction applies once to real High Card");
    assert.equal(f.api.mastery[topic], 10);
    assert.equal(f.api.G._chargedThisClose[topic], 2);
    const saved = JSON.parse(f.memory.get("aced:runtime-fixture:mastery"));
    assert.ok(Object.hasOwn(saved, topic)); assert.equal(saved[topic], 10);
    assert.ok(Number.isFinite(f.api.G.score));
  }
  assert.equal(f.api.mastery.untouchedNumeric, 7);
  assert.equal(f.api.mastery.untouchedLegacy, "retained", "do not normalize unrelated historical data");
  assert.equal(f.evaluate("JSON.stringify(Object.getOwnPropertyNames(Object.prototype))", "prototype-after"), prototypeBefore);
  assert.equal(f.evaluate("({}).n", "prototype-check"), undefined);
  assert.equal(f.requests.length, 0);
});

test("C01: missing-pack diagnostic accepts only the existing safe pack slug", () => {
  const f = createRuntime();
  f.context.location.search = "?pack=" + encodeURIComponent(hostile);
  f.evaluate(f.loaderSource, "study.html:missing-pack-loader");
  const script = f.appended.find(n => typeof n.src === "string" && n.src.startsWith("packs/"));
  assert.ok(script);
  script.onerror();
  inert(f.document.body.innerHTML);
  assert.ok(f.document.body.innerHTML.includes("<b>world-capitals</b>"));
  assert.equal(f.requests.length, 0);
});

test("C02: actual start twice retains rare/unknown profile IDs without equipping extras", () => {
  const initial = { "aced:runtime-fixture:unlocked": ["mirror", "future-valid-id"],
    "aced:another-pack:unlocked": ["another-only"] };
  const f = createRuntime({ initial });
  const otherBefore = f.memory.get("aced:another-pack:unlocked");
  for (let i = 0; i < 2; i++) {
    f.api.start();
    for (const id of ["mirror", "future-valid-id", ...f.api.starters]) assert.ok(f.api.unlocked.includes(id));
    assert.deepEqual([...f.api.G.jokers.map(j => j.id)], [...f.api.loadout]);
    assert.ok(!f.api.G.jokers.some(j => j.id === "mirror"));
    f.api.saveUnlocked();
  }
  const reload = createRuntime({ initial: Object.fromEntries(f.memory) });
  reload.api.start();
  assert.ok(reload.api.unlocked.includes("mirror"));
  assert.ok(reload.api.unlocked.includes("future-valid-id"));
  assert.ok(!reload.api.unlocked.includes("another-only"));
  assert.equal(f.memory.get("aced:another-pack:unlocked"), otherBefore);
  assert.equal(reload.memory.get("aced:another-pack:unlocked"), otherBefore);
});

test("C02: missing/malformed saves get starters and inaccessible storage retains visible unlocks", () => {
  for (const value of [undefined, null, {}, 7, "invalid-json"]) {
    const initial = value === undefined ? {} : { "aced:runtime-fixture:unlocked": value };
    const f = createRuntime({ initial }); f.api.start();
    for (const id of f.api.starters) assert.ok(f.api.unlocked.includes(id));
    assert.deepEqual([...f.api.G.jokers.map(j => j.id)], [...f.api.loadout]);
  }
  const f = createRuntime({ initial: { "aced:runtime-fixture:unlocked": ["mirror"] } });
  f.api.start(); f.blockStorage();
  f.api.start(); f.api.saveUnlocked(); f.api.start();
  assert.ok(f.api.unlocked.includes("mirror"), "visible profile must survive read/write failures");
  const unavailable = createRuntime({ storageBlocked: true });
  unavailable.api.start(); unavailable.api.start();
  for (const id of unavailable.api.starters) assert.ok(unavailable.api.unlocked.includes(id));
});

test("C02: a real purchase survives restart when writes fail but old storage remains readable", () => {
  const f = createRuntime({ initial: { "aced:runtime-fixture:unlocked": ["mirror"] } });
  f.api.start();
  const joker = f.api.jokers.find(j => !f.api.unlocked.includes(j.id));
  assert.ok(joker);
  f.api.G.money = 100;
  f.api.G.shop = { jk: [joker], jkTreat: [null], cs: [], packs: [], reroll: 2 };
  const storedBefore = f.memory.get("aced:runtime-fixture:unlocked");
  f.blockWrites(); f.api.buyJoker(0);
  assert.ok(f.api.unlocked.includes(joker.id));
  assert.equal(f.memory.get("aced:runtime-fixture:unlocked"), storedBefore);
  f.api.start(); f.api.start();
  assert.ok(f.api.unlocked.includes(joker.id), "visible newly purchased unlock survives stale stored profile");
  assert.ok(f.api.unlocked.includes("mirror"));
  assert.deepEqual([...f.api.G.jokers.map(j => j.id)], [...f.api.loadout]);
});

test("C03: actual Insight handler mutates each OBJECT once, not each ID or reference", () => {
  const f = createRuntime(); f.api.start();
  const a = { id: 1, el: "S", v: 10, tags: [] }, sameId = { ...a };
  const handOnly = { id: 2, el: "S", v: 20, tags: [] };
  const wrong = { id: 3, el: "H", v: 30, tags: [] };
  const weak = { id: 4, el: "S", v: 0, weakness: true, tags: [] };
  f.api.G.masterDeck = [a, a, sameId, wrong, weak];
  f.api.G.hand = [a, a, sameId, handOnly, handOnly, wrong, weak];
  f.api.G.insight = 4; f.api.openInsight();
  f.document.getElementById("isS").onclick();
  assert.deepEqual([a.v, sameId.v, handOnly.v, wrong.v, weak.v], [18, 18, 28, 30, 0]);
  assert.equal(f.api.G.insight, 2);
  assert.ok(f.document.getElementById("callout").textContent.includes("(3 cards)"));
  f.document.getElementById("isS").onclick();
  assert.deepEqual([a.v, sameId.v, handOnly.v, wrong.v, weak.v], [26, 26, 36, 30, 0]);
  assert.equal(f.api.G.insight, 0);
  f.document.getElementById("isS").onclick();
  assert.deepEqual([a.v, sameId.v, handOnly.v, wrong.v, weak.v], [26, 26, 36, 30, 0]);
  assert.equal(f.api.G.insight, 0);
});

test("C03: normal dealt master/hand alias receives +8 and insufficient cost is a no-op", () => {
  const f = createRuntime(); f.api.start();
  const card = f.api.G.hand.find(c => c.el === "S") || f.api.G.hand[0];
  assert.ok(f.api.G.masterDeck.includes(card), "actual draw must retain object identity");
  const original = card.v;
  f.api.G.insight = 1; f.api.openInsight();
  f.document.getElementById("is" + card.el).onclick();
  assert.equal(card.v, original); assert.equal(f.api.G.insight, 1);
  f.api.G.insight = 2; f.api.openInsight();
  f.document.getElementById("is" + card.el).onclick();
  assert.equal(card.v, original + 8); assert.equal(f.api.G.insight, 0);
});

test("C06: actual review empty/loading/error/unavailable do not create learning evidence or rewards", () => {
  const f = createRuntime(); f.api.start();
  const progressEvents = [];
  f.context.ACEDProgress = { event: (...args) => progressEvents.push(args) };
  const core = f.context.ACEDCore, bank = f.api.qbank;
  const before = Object.fromEntries(f.memory);
  const logCount = f.logs.length;
  const money = f.api.G.money, insight = f.api.G.insight;
  const modalBefore = f.modal();
  f.api.launchReview();
  assert.equal(f.document.getElementById("toast").textContent, "No questions due right now.");
  f.api.qbank = []; f.api.launchReview();
  assert.match(f.document.getElementById("toast").textContent, /still loading/);
  f.api.qbank = bank;
  const queue = core.review.queue;
  core.review.queue = () => { throw new Error("Synthetic queue failure"); };
  f.api.launchReview();
  assert.match(f.document.getElementById("toast").textContent, /unavailable/i);
  core.review.queue = queue;
  f.context.ACEDCore = undefined; f.api.launchReview(); f.context.ACEDCore = core;
  assert.match(f.document.getElementById("toast").textContent, /unavailable/i);
  assert.equal(f.modal(), modalBefore);
  assert.deepEqual(Object.fromEntries(f.memory), before);
  assert.equal(f.api.G.money, money); assert.equal(f.api.G.insight, insight);
  assert.equal(progressEvents.length, 0, "visiting review must not grant XP/progression events");
  assert.equal(f.logs.length, logCount, "queue errors must not log content-bearing Error objects");
  assert.equal(f.requests.length, 0);
});

test("C06: actual nonempty review opens a question without recording an answer", () => {
  const f = createRuntime(); f.api.start();
  const progressEvents = [];
  f.context.ACEDProgress = { event: (...args) => progressEvents.push(args) };
  const core = f.context.ACEDCore, q = f.api.qbank[0];
  core.store.set("review", { [q.id]: { seen: 1, miss: 1, ok: 0, last: 1, box: 0, src: q.source, dueAt: 1 } });
  const reviewBefore = JSON.stringify(core.store.get("review", {}));
  const learningBefore = f.memory.get("aced:runtime-fixture:learning_v1");
  const money = f.api.G.money, insight = f.api.G.insight;
  f.api.launchReview();
  assert.ok(f.modal().includes("REVIEW"));
  assert.ok(f.modal().includes(q.q));
  assert.ok(f.document.getElementById("qSubmit").onclick, "real quiz submit handler must be wired");
  assert.equal(JSON.stringify(core.store.get("review", {})), reviewBefore);
  assert.equal(f.memory.get("aced:runtime-fixture:learning_v1"), learningBefore);
  assert.equal(f.api.G.money, money); assert.equal(f.api.G.insight, insight);
  assert.equal(progressEvents.length, 0);
  assert.equal(f.requests.length, 0);
});

test("C06: actual game opens mature nonweak scheduled review exactly when due, without rewards", () => {
  const f = createRuntime({ now: 1000 }); f.api.start();
  const core = f.context.ACEDCore, q = f.api.qbank[0], progressEvents = [];
  f.context.ACEDProgress = { event: (...args) => progressEvents.push(args) };
  core.store.set("review", { [q.id]: {
    seen: 3, miss: 0, ok: 3, last: 500, box: 3, src: q.source,
    dueAt: 2000, intervalDays: 7, lastReviewedAt: 500
  } });
  const before = JSON.stringify(core.store.get("review", {}));
  const money = f.api.G.money, insight = f.api.G.insight, score = f.api.G.score;
  f.api.launchReview();
  assert.equal(f.document.getElementById("toast").textContent, "No questions due right now.");
  assert.equal(core.review.count(f.api.qbank), 0);
  f.setNow(2000); f.api.launchReview();
  assert.ok(f.modal().includes(q.q)); assert.ok(f.modal().includes("REVIEW"));
  assert.equal(core.review.count(f.api.qbank), 1);
  f.setNow(2001); f.api.launchReview();
  assert.ok(f.modal().includes(q.q));
  assert.equal(JSON.stringify(core.store.get("review", {})), before);
  assert.deepEqual([f.api.G.money, f.api.G.insight, f.api.G.score], [money, insight, score]);
  assert.equal(progressEvents.length, 0);
  assert.equal(f.requests.length, 0);
});

test("actual ranked poker scoring remains production Pair=28 without a copied harness", async () => {
  const f = createRuntime(); f.api.start(); f.api.fastAnimations();
  const cards = f.api.G.masterDeck.filter(c => c.rank === 2).slice(0, 2);
  f.api.G.jokers = []; f.api.G.hand = cards;
  f.api.G.sel = new Set(cards.map(c => c.id)); f.api.G.target = 1e9;
  assert.equal(f.api.detectHand(cards).name, "Pair");
  await f.api.play();
  assert.equal(f.api.G.score, 28);
  assert.equal(f.api.G.lastHand.name, "Pair");
});

// Desired v2 behavior against actual loader and handlers, with redacted failures.
function integrityRuntime(rawId, initial = {}) {
  return createRuntime({ now: 1800000000000, initial,
    raw: { id: "runtime-fixture", name: "Synthetic integrity fixture", questions: [
      { id: rawId, q: "Synthetic item", choices: ["Synthetic A", "Synthetic B"], answer: 0, source: "Fixture", explain: "Synthetic" }
    ] } });
}
function integrityTest(name, fn) {
  test(name, () => { try { fn(); } catch (_) { throw new Error("actual-runtime integrity regression failed"); } });
}
integrityTest("T12 actual audit true/miss preserves existing routes and game effects for special IDs", () => {
  for (const correct of [true, false]) {
    let ordinary;
    for (const id of ["ordinary", "toString", "hasOwnProperty"]) {
      const f = integrityRuntime(id); f.api.start();
      let coreCalls = 0, bridgeCalls = 0;
      const coreRecord = f.context.ACEDCore.review.record, bridgeRecord = f.context.ACEDLibraryRecord;
      f.context.ACEDCore.review.record = (...args) => { coreCalls++; return coreRecord(...args); };
      f.context.ACEDLibraryRecord = (...args) => { bridgeCalls++; return bridgeRecord(...args); };
      const [choice] = f.choices("[data-ach]", [{ ach: correct ? "0" : "1" }]);
      const [confidence] = f.choices("[data-conf]", [{ conf: "MED" }]);
      f.api.beginAuditQuestion("Fixture", f.api.qbank[0], 10, true);
      assert.equal(coreCalls, 0); assert.equal(bridgeCalls, 0);
      choice.onclick(); confidence.onclick(); f.document.getElementById("auditSubmit").onclick();
      assert.equal(coreCalls, 1); assert.equal(bridgeCalls, 1);
      const review = JSON.parse(f.memory.get("aced:runtime-fixture:review"));
      const learning = JSON.parse(f.memory.get("aced:runtime-fixture:learning_v1"));
      assert.ok(Object.hasOwn(review, id) && Object.hasOwn(learning.answers, id));
      assert.equal(review[id].seen, 1); assert.equal(learning.answers[id].attempts, 1);
      assert.equal(learning.answers[id].lastCorrect, correct);
      const effects = [f.api.mastery.Fixture, f.api.G.money, f.api.G.insight, f.api.G.conviction.Fixture, f.api.G.score];
      if (id === "ordinary") ordinary = effects;
      else assert.deepEqual(effects, ordinary);
      const reload = integrityRuntime(id, Object.fromEntries(f.memory));
      assert.equal(reload.context.ACEDLibrary.progress("runtime-fixture", [{ id }]).practiced, 1);
      assert.equal(reload.context.ACEDCore.review.count(), 0);
      assert.equal(f.requests.length, 0);
    }
  }
});
integrityTest("T11/T12 actual component holds are independent, with no compensating replay", () => {
  for (const held of ["core", "library"]) {
    const id = "toString", initial = held === "core"
      ? { "aced:runtime-fixture:review": { [id]: null } }
      : { "aced:runtime-fixture:learning_v1": { attempts: 12, correct: 8, selfRated: 2, answers: { [id]: null, other: { strength: 2 } } } };
    const f = integrityRuntime(id, initial); f.api.start();
    const heldKey = "aced:runtime-fixture:" + (held === "core" ? "review" : "learning_v1");
    const before = f.memory.get(heldKey);
    const [choice] = f.choices("[data-ach]", [{ ach: "0" }]);
    const [confidence] = f.choices("[data-conf]", [{ conf: "MED" }]);
    f.api.beginAuditQuestion("Fixture", f.api.qbank[0], 10, true);
    choice.onclick(); confidence.onclick(); f.document.getElementById("auditSubmit").onclick();
    assert.equal(f.memory.get(heldKey), before);
    if (held === "core") assert.equal(JSON.parse(f.memory.get("aced:runtime-fixture:learning_v1")).attempts, 1);
    else assert.equal(JSON.parse(f.memory.get("aced:runtime-fixture:review"))[id].seen, 1);
    assert.equal(f.api.mastery.Fixture, 8); assert.equal(f.requests.length, 0);
  }
});
integrityTest("T12 actual shared review submit remains core-only and no record on open", () => {
  for (const correct of [true, false]) {
    const f = integrityRuntime("hasOwnProperty"); f.api.start();
    const q = f.api.qbank[0], core = f.context.ACEDCore;
    core.store.set("review", { [q.id]: { dueAt: 1 } });
    const [choice] = f.choices("[data-qc]", [{ qc: correct ? "0" : "1" }]);
    let calls = 0, bridgeCalls = 0; const record = core.review.record;
    core.review.record = (...args) => { calls++; return record(...args); };
    f.context.ACEDLibraryRecord = () => { bridgeCalls++; };
    f.api.updateReviewBadge(); assert.ok(f.document.getElementById("reviewBtn").innerHTML.includes(">1<"));
    const learningBefore = f.memory.get("aced:runtime-fixture:learning_v1");
    f.api.launchReview(); assert.equal(calls, 0);
    assert.ok(f.modal().includes('role="button" tabindex="0"'));
    choice.onclick(); f.document.getElementById("qSubmit").onclick();
    f.document.getElementById("qSubmit").onclick();
    assert.equal(calls, 1); assert.equal(bridgeCalls, 0);
    assert.equal(f.memory.get("aced:runtime-fixture:learning_v1"), learningBefore);
    f.document.getElementById("qNext").onclick();
    assert.ok(f.modal().includes(correct ? "1/1" : "0/1"));
    assert.equal(typeof f.document.getElementById("qDone").onclick, "function");
    assert.equal(f.requests.length, 0);
  }
});
integrityTest("T12/T13 finite accessible library progress text matches own practiced evidence", () => {
  const f = integrityRuntime("toString", {
    "aced:runtime-fixture:learning_v1": { answers: { unrelated: { strength: 2 } } }
  });
  f.document.getElementById("mine-search").value = "";
  const fs = require("node:fs");
  f.evaluate(fs.readFileSync(__dirname + "/aced-library-page.js", "utf8"), "aced-library-page.js:actual");
  let markup = f.document.getElementById("mine-grid").innerHTML;
  assert.ok(markup.includes('role="progressbar"') && markup.includes('aria-valuenow="0"'));
  assert.ok(markup.includes("0% recall") && markup.includes("0/1 practiced"));
  f.context.ACEDLibrary.saveLearning("runtime-fixture", { answers: { toString: { strength: 2 } } });
  f.evaluate(fs.readFileSync(__dirname + "/aced-library-page.js", "utf8"), "aced-library-page.js:actual");
  markup = f.document.getElementById("mine-grid").innerHTML;
  assert.ok(markup.includes('aria-valuenow="100"') && markup.includes("100% recall") && markup.includes("1/1 practiced"));
  assert.ok(!/NaN|Infinity/.test(markup));
  assert.equal(f.requests.length, 0);
});
