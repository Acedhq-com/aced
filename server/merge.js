/* server/merge.js — the sync merge, implementing docs/BACKEND_SPEC.md exactly.
   Pure function, no I/O, so it can be unit-tested (see `node server/merge.test.js`).

   Rules:
     - mastery:            take the MAX per module (progress is monotonic; never regress).
     - dailyV1.bestStreak: MAX.  dailyV1.currentStreak/lastDate/freezes: trust the side with
                           the newer `updatedAt` (the client owns "today").
     - review:             per qKey, keep the record with the newer `last` (tie -> larger `seen`).
     - everything else:    last-write-wins per top-level key, by `updatedAt`.
*/
"use strict";

function mergeMastery(a, b) {
  const out = Object.assign({}, a || {});
  const src = b || {};
  for (const k in src) if (Object.prototype.hasOwnProperty.call(src, k)) {
    const av = +out[k] || 0, bv = +src[k] || 0;
    out[k] = Math.max(av, bv);
  }
  return out;
}

function reviewField(o, k) {
  const d = o && Object.getOwnPropertyDescriptor(o, k);
  return d && d.enumerable && Object.prototype.hasOwnProperty.call(d, "value") ? d : null;
}
function reviewObject(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  let p = Object.getPrototypeOf(v);
  while (p) {
    const d = Object.getOwnPropertyDescriptor(p, "constructor");
    const name = d && Object.prototype.hasOwnProperty.call(d, "value") && typeof d.value === "function" ? Object.getOwnPropertyDescriptor(d.value, "name") : null;
    if (d && !d.enumerable && name && Object.prototype.hasOwnProperty.call(name, "value") && name.value !== "Object") return false;
    p = Object.getPrototypeOf(p);
  }
  return true;
}
function reviewPut(o, k, v) {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}
function reviewJSON(v, stack = []) {
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (!v || typeof v !== "object" || (!Array.isArray(v) && !reviewObject(v)) ||
    stack.includes(v) || Object.getOwnPropertySymbols(v).length) throw new Error("serialization-failed");
  stack.push(v);
  const out = Array.isArray(v) ? Object.setPrototypeOf([], null) : Object.create(null), keys = Object.keys(v), names = Object.getOwnPropertyNames(v);
  if (names.some(k => !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(v, k), "value"))) throw new Error("serialization-failed");
  if (Array.isArray(v) && (names.length !== v.length + 1 || keys.length !== v.length || keys.some((k, i) => k !== String(i)))) throw new Error("serialization-failed");
  keys.forEach(k => {
    const d = reviewField(v, k);
    if (!d) throw new Error("serialization-failed");
    reviewPut(out, k, reviewJSON(d.value, stack));
  });
  stack.pop(); return out;
}
function mergeReview(a, b) {
  // Validate the whole scoped input before it can become a lossy persistence
  // candidate. Detached data also removes inherited hooks without invoking them.
  try { if (a !== undefined) a = reviewJSON(a); if (b !== undefined) b = reviewJSON(b); }
  catch (_) { throw new Error("serialization-failed"); }
  if (a === undefined && b === undefined) return Object.create(null);
  if (a === undefined) return b;
  if (b === undefined || !reviewObject(a) || !reviewObject(b)) return a;
  const out = Object.create(null);
  const keys = new Set(Object.keys(a).concat(Object.keys(b)));
  keys.forEach(k => {
    const da = reviewField(a, k), db = reviewField(b, k);
    const ra = da ? da.value : undefined, rb = db ? db.value : undefined;
    if (da && db) {
      let winner = ra;
      const processable = e => reviewObject(e) && ["last", "seen"].every(key => {
        const d = reviewField(e, key);
        return !d || d.value === null || ["number", "string", "boolean"].includes(typeof d.value);
      });
      if (processable(ra) && processable(rb)) {
        const n = (e, key) => { const d = reviewField(e, key); return d ? +d.value || 0 : 0; };
        const la = n(ra, "last"), lb = n(rb, "last");
        // Whole-record last, then seen, then stored-side tie. Historical
        // counters need not be additive or complete.
        winner = la !== lb ? (la > lb ? ra : rb) : (n(ra, "seen") >= n(rb, "seen") ? ra : rb);
      }
      reviewPut(out, k, winner);
    }
    else reviewPut(out, k, da ? ra : rb);
  });
  return out;
}

function mergeDaily(a, b, aNewer) {
  a = a || {}; b = b || {};
  const newer = aNewer ? a : b;          // side that owns "today"
  const out = Object.assign({}, b, a);   // start from a union
  // current-day fields come from the newer side
  out.currentStreak = newer.currentStreak != null ? newer.currentStreak : (out.currentStreak || 0);
  out.lastDate = newer.lastDate != null ? newer.lastDate : (out.lastDate || null);
  out.freezes = newer.freezes != null ? newer.freezes : (out.freezes || 0);
  // best streak is monotonic
  out.bestStreak = Math.max(+(a.bestStreak || 0), +(b.bestStreak || 0));
  out.longestStreak = Math.max(+(a.longestStreak || 0), +(b.longestStreak || 0), out.bestStreak || 0);
  // per-date results: union (a wins on conflict — it's the same deterministic Close anyway)
  out.results = Object.assign({}, b.results || {}, a.results || {});
  return out;
}

/* Merge two snapshots of the shape produced by ACEDCore.sync.snapshot():
   { v, pack, updatedAt, data: { mastery, review, calib, dailyV1, ... } }
   `incoming` is the just-pushed client snapshot; `stored` is what the server holds.
   Returns the merged `data` object. */
function mergeState(stored, incoming) {
  const sd = (stored && stored.data) || {};
  const id = (incoming && incoming.data) || {};
  const incomingNewer = (incoming && incoming.updatedAt || 0) >= (stored && stored.updatedAt || 0);
  const out = {};
  const keys = new Set(Object.keys(sd).concat(Object.keys(id)));
  keys.forEach(k => {
    if (k === "mastery") out[k] = mergeMastery(sd[k], id[k]);
    else if (k === "review") {
      const a = reviewField(sd, k), b = reviewField(id, k);
      if ((Object.prototype.hasOwnProperty.call(sd, k) && (!a || a.value === undefined)) ||
        (Object.prototype.hasOwnProperty.call(id, k) && (!b || b.value === undefined))) throw new Error("serialization-failed");
      out[k] = mergeReview(a ? a.value : undefined, b ? b.value : undefined);
    }
    else if (k === "dailyV1") out[k] = mergeDaily(id[k], sd[k], incomingNewer); // a=incoming
    else {
      // last-write-wins by snapshot updatedAt
      if (k in id && k in sd) out[k] = incomingNewer ? id[k] : sd[k];
      else out[k] = (k in id) ? id[k] : sd[k];
    }
  });
  return out;
}

module.exports = { mergeState, mergeMastery, mergeReview, mergeDaily };
