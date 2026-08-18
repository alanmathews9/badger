// Deterministic tests for the index search module — no keys, no network.
//
// The fixture is a hand-made index shaped exactly like a built one, so every
// case states which retrieval property it protects: IDF (rare terms outrank
// common ones), the title boost, the suffix tolerance shared with _rank, and
// — from the typo layer — visible correction, never silent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSearcher } from "../tools/scripts/_index.mjs";

const doc = (id, title, body, extra = {}) => ({
  id, source: "github", type: "issue", title, body,
  author: "t", date: "2026-01-01", url: "", meta: {}, vector: null, ...extra,
});

const fixture = {
  version: 1,
  builtAt: "2026-08-18T00:00:00.000Z",
  counts: {},
  docs: [
    // "app" appears everywhere; "brightsmile" in exactly one doc. IDF is what
    // makes the one doc win a query naming both.
    doc("issue-1", "Apple Wallet passes for appointments", "the app could add wallet passes for the app"),
    doc("issue-2", "Reminder timing bug", "the app sent reminders at 3am, app push was wrong"),
    doc("issue-3", "Brightsmile onboarding", "brightsmile asked when the app would be ready"),
    // Title boost: same term, one in title, one buried in body.
    doc("issue-4", "Leave policy question", "see the handbook"),
    doc("issue-5", "Handbook cleanup", "the leave section was stale"),
    // Suffix tolerance: "week" must be findable by "weeks", "apple" must NOT
    // be findable by "app".
    doc("issue-6", "Sprint cadence", "we plan one week at a time"),
  ],
};

test("IDF: the rare term decides the order", () => {
  const s = createSearcher(fixture);
  const { rows } = s.search("brightsmile app");
  assert.equal(rows[0].id, "issue-3");
});

test("title hit outranks body hit", () => {
  const s = createSearcher(fixture);
  const { rows } = s.search("leave");
  assert.equal(rows[0].id, "issue-4");
  assert.equal(rows[1].id, "issue-5");
});

test("suffix tolerance: 'weeks' finds 'week'", () => {
  const s = createSearcher(fixture);
  const { rows } = s.search("weeks");
  assert.ok(rows.some((r) => r.id === "issue-6"));
});

test("'app' does not match 'Apple'", () => {
  const s = createSearcher(fixture);
  const { rows } = s.search("app");
  // issue-1 matches on body "app", but its Apple title alone must not count.
  const apple = s.search("apple").rows;
  assert.ok(apple.every((r) => r.id === "issue-1"));
  assert.ok(rows.every((r) => r.matchedTerms.includes("app")));
});

test("stopwords are stripped, question words don't pollute", () => {
  const s = createSearcher(fixture);
  const { terms } = s.search("why did the reminders go out at 3am");
  assert.ok(!terms.includes("why") && !terms.includes("the"));
  assert.ok(terms.includes("reminders"));
});

test("no matches returns empty rows, not an error", () => {
  const s = createSearcher(fixture);
  const { rows } = s.search("zzzunfindable");
  assert.equal(rows.length, 0);
});

// ── typo layer ────────────────────────────────────────────────────────────

test("a typo is corrected against the corpus vocabulary, and says so", () => {
  const s = createSearcher(fixture);
  const { rows, corrections } = s.search("brigthsmile");
  assert.deepEqual(corrections, [{ from: "brigthsmile", to: "brightsmile" }]);
  assert.equal(rows[0].id, "issue-3");
});

test("nonsense clears no threshold and is reported unmatched, never silently dropped", () => {
  const s = createSearcher(fixture);
  const { corrections, unmatched } = s.search("xqzvwk reminders");
  assert.deepEqual(corrections, []);
  assert.deepEqual(unmatched, ["xqzvwk"]);
});

test("a term already in the vocabulary is never rewritten", () => {
  const s = createSearcher(fixture);
  const { corrections } = s.search("reminder");
  assert.deepEqual(corrections, []);
});
