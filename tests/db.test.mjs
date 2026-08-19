// The Postgres paths: conversations, search history, and the stored index.
//
// **These tests skip when DATABASE_URL is absent, and that is a supported
// configuration rather than a gap.** Badger runs without a database — history
// falls back to the browser and search falls back to the disk index, then to
// live retrieval. A suite that failed here would be asserting a requirement
// the product deliberately does not have.
//
// They run against the real database rather than a fake, because what is being
// tested is mostly SQL: an ownership check written as a WHERE clause, a
// lossless jsonb round trip, an ORDER BY that dedupes. A stub would test the
// stub. Everything written is namespaced to test uids and deleted afterwards.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnvFile } from "../tools/scripts/_env.mjs";

// The modules under test load .env themselves, but the skip decision is made
// at module scope — before any of them are imported. Load it here too, or
// every test silently skips on a machine that is perfectly well configured,
// which is the worst kind of green.
loadEnvFile(new URL("../.env", import.meta.url));

const LIVE = Boolean(process.env.DATABASE_URL);
const skip = LIVE ? false : "no DATABASE_URL — the database is optional";

let history, indexDb, db, loadIndex;

before(async () => {
  if (!LIVE) return;
  history = await import("../app/server/history.mjs");
  indexDb = await import("../tools/scripts/_index-db.mjs");
  db = await import("../tools/scripts/_db.mjs");
  ({ loadIndex } = await import("../tools/scripts/_index.mjs"));
});

after(async () => {
  if (!LIVE) return;
  await db.query("delete from chat_session where uid like 'test-%'");
  await db.query("delete from search_query where uid like 'test-%'");
  await db.closeDb();
});

const UID = "test-owner";
const OTHER = "test-stranger";

/** A turn shaped exactly as the client produces one, result and all. */
function turn(question = "Why was the Android app five weeks late?") {
  return {
    question,
    answer: {
      running: false,
      activity: null,
      steps: [{ label: "Searching GitHub", name: "github_search", args: { query: "android" } }],
      text: "The sync layer was rewritten twice.",
      result: {
        answer: "The sync layer was rewritten twice.",
        cited: [{ kind: "issue", ref: "8", label: "Sync rewrite" }],
        uncited: [],
        opened: [],
        toolCalls: ["github_search"],
        verification: { ok: true, checked: 1, findings: [] },
        tookMs: 14200,
        costUsd: 0.0041,
        inputTokens: 2200,
        outputTokens: 310,
      },
      error: null,
    },
  };
}

test("a conversation round-trips without losing any of the run's result", { skip }, async () => {
  const id = `t${Date.now().toString(36)}a`;
  assert.equal(await history.saveChat(UID, id, { title: "t", turns: [turn()] }), true);

  const back = await history.getChat(UID, id);
  assert.equal(back.turns.length, 1);
  assert.equal(back.turns[0].question, turn().question);
  assert.equal(back.turns[0].answer.steps.length, 1);
  // The fields an earlier schema dropped by splitting the result across
  // columns. They are the reason it is one jsonb column now.
  assert.equal(back.turns[0].answer.result.costUsd, 0.0041);
  assert.equal(back.turns[0].answer.result.verification.ok, true);
  assert.equal(back.turns[0].answer.result.inputTokens, 2200);
  // A restored turn is never mid-flight, whatever it was when it was saved.
  assert.equal(back.turns[0].answer.running, false);
});

test("a conversation is invisible and unwritable to another browser", { skip }, async () => {
  const id = `t${Date.now().toString(36)}b`;
  await history.saveChat(UID, id, { title: "mine", turns: [turn()] });

  // Chat ids are short and sit in a URL path, so guessing one must get you
  // nothing — and must not tell you whether you guessed right.
  assert.equal(await history.getChat(OTHER, id), null);
  assert.equal(await history.saveChat(OTHER, id, { title: "hijacked", turns: [turn()] }), false);
  assert.equal((await history.getChat(UID, id)).title, "mine");
});

test("saving twice replaces the turns rather than appending them", { skip }, async () => {
  const id = `t${Date.now().toString(36)}c`;
  await history.saveChat(UID, id, { title: "t", turns: [turn("first")] });
  await history.saveChat(UID, id, { title: "t", turns: [turn("first"), turn("second")] });

  const back = await history.getChat(UID, id);
  assert.deepEqual(
    back.turns.map((t) => t.question),
    ["first", "second"],
  );
});

test("search history dedupes by query, case-insensitively, keeping the newest", { skip }, async () => {
  const uid = `test-search-${Date.now().toString(36)}`;
  await history.recordSearch(uid, { query: "payments", path: "index", resultCount: 12 });
  await history.recordSearch(uid, { query: "Payments", path: "index", resultCount: 12 });
  await history.recordSearch(uid, { query: "brightsmile", path: "live", resultCount: 4 });

  const searches = await history.listSearches(uid);
  assert.deepEqual(searches.map((s) => s.query), ["brightsmile", "Payments"]);
  await db.query("delete from search_query where uid = $1", [uid]);
});

test("a search's own numbers are kept as sent, or null — never guessed", { skip }, async () => {
  const uid = `test-nums-${Date.now().toString(36)}`;
  await history.recordSearch(uid, { query: "q", path: "index", tookMs: 3, apiCalls: 0 });
  const { rows } = await db.query(
    "select path, took_ms, api_calls, result_count from search_query where uid = $1",
    [uid],
  );
  assert.equal(rows[0].path, "index");
  assert.equal(rows[0].took_ms, 3);
  assert.equal(rows[0].api_calls, 0);
  // Not sent, so not invented — a zero here would read as "found nothing".
  assert.equal(rows[0].result_count, null);
  await db.query("delete from search_query where uid = $1", [uid]);
});

/**
 * The index round trip.
 *
 * This one writes to the shared `document` table, so it pushes the index
 * that is already on disk: the side effect is "Postgres now holds what disk
 * holds", which is the invariant the system wants anyway. It skips when there
 * is no disk index to push, rather than inventing a fixture that would leave
 * the table holding fictional documents.
 */
test("the index survives Postgres unchanged, header and all", { skip }, async () => {
  const disk = loadIndex();
  if (!disk) return; // nothing built locally; nothing to assert against

  await indexDb.pushIndex(disk);
  const back = await indexDb.pullIndex();

  assert.equal(back.docs.length, disk.docs.length);
  // The header carries the freshness figures the UI prints on every search.
  // Inventing them would mean a status display nobody can see be wrong.
  for (const key of ["version", "builtAt", "refreshedAt", "repo", "buildMs", "apiCalls"]) {
    assert.deepEqual(back[key], disk[key], `header field ${key}`);
  }
  assert.deepEqual(back.counts, disk.counts);

  // deepEqual, not string comparison: jsonb does not preserve key order, so
  // comparing JSON.stringify output reports differences that do not exist.
  const byId = new Map(back.docs.map((d) => [d.id, d]));
  for (const doc of disk.docs) {
    const stored = byId.get(doc.id);
    assert.ok(stored, `document ${doc.id} came back`);
    for (const key of ["source", "type", "title", "body"]) {
      assert.equal(stored[key], doc[key], `${doc.id}.${key}`);
    }
    assert.deepEqual(stored.meta ?? {}, doc.meta ?? {}, `${doc.id}.meta`);
  }
});

test("a pulled index is searchable, typo correction included", { skip }, async () => {
  const pulled = await indexDb.pullIndex();
  if (!pulled) return;

  const { createSearcher } = await import("../tools/scripts/_index.mjs");
  const searcher = createSearcher(pulled);

  const hits = searcher.search("payments", { limit: 3 });
  assert.ok(hits.total > 0, "a plain query finds something");

  // The typo layer needs the corpus vocabulary, which only exists because we
  // hold the text. If the body columns came back empty this is what notices.
  const typo = searcher.search("paymnets", { limit: 3 });
  assert.deepEqual(
    typo.corrections?.map((c) => `${c.from}->${c.to}`),
    ["paymnets->payments"],
  );
});
