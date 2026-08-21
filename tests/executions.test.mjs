// The schedule_run table, against the real database.
//
// Skips without DATABASE_URL, for the reason db.test.mjs states: Badger runs
// without a database on purpose, so a suite that failed here would be
// asserting a requirement the product does not have. Everything written is
// under agents named `test-…` and deleted afterwards.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnvFile } from "../tools/scripts/_env.mjs";

// Loaded here as well as inside the modules, because the skip decision is made
// at module scope before any of them are imported. See db.test.mjs.
loadEnvFile(new URL("../.env", import.meta.url));

const LIVE = Boolean(process.env.DATABASE_URL);
const skip = LIVE ? false : "no DATABASE_URL — the database is optional";

let runs, db;

before(async () => {
  if (!LIVE) return;
  runs = await import("../app/server/executions.mjs");
  db = await import("../tools/scripts/_db.mjs");
});

after(async () => {
  if (!LIVE) return;
  await db.query("delete from schedule_run where agent like 'test-%'");
  await db.closeDb();
});

test("a run is recorded before it starts, so one that never returns is visible", { skip }, async () => {
  const id = await runs.startRun("test-hr", "default", "What changed in leave policy?");
  assert.ok(id);

  // This is the Cloud Run case: the instance recycled mid-answer. The row is
  // still there and still says what it was doing.
  const open = await runs.readRun("test-hr", id);
  assert.equal(open.status, "running");
  assert.equal(open.finishedAt, null);
  assert.equal(open.input, "What changed in leave policy?");
});

test("the answer round-trips through jsonb intact", { skip }, async () => {
  const id = await runs.startRun("test-hr", "default", "Digest");
  const result = {
    answer: "Two policies disagree.",
    verification: { checked: 2, verified: 2, failures: [] },
    toolCalls: ["drive_search", "drive_file"],
    cited: [{ kind: "doc", ref: "abc", label: "Leave Policy" }],
    opened: [{ kind: "doc", ref: "abc", label: "Leave Policy" }],
    uncited: [],
    costUsd: 0.0041,
  };
  await runs.finishRun(id, { status: "success", result });

  const read = await runs.readRun("test-hr", id);
  assert.equal(read.status, "success");
  assert.ok(read.finishedAt);
  // deepEqual, not a string compare: jsonb does not preserve key order, and
  // comparing the serialisations reports mismatches that are not there.
  assert.deepEqual(read.result, result);
});

test("a failure keeps its reason", { skip }, async () => {
  const id = await runs.startRun("test-hr", "default", "Digest");
  await runs.finishRun(id, { status: "error", error: "Badger has used its answer budget for today." });
  const read = await runs.readRun("test-hr", id);
  assert.equal(read.status, "error");
  assert.match(read.error, /answer budget/);
  assert.equal(read.result, null);
});

test("a run records what set it going, and both kinds share one list", { skip }, async () => {
  // One list with a column, not two lists — the shape n8n, GitHub Actions and
  // Airflow all use, because comparing a hand-run against a scheduled one is
  // the first thing anyone does when a scheduled run looks wrong.
  const tick = await runs.startRun("test-trig", "default", "Digest", new Date("2026-08-21T09:00:00Z"));
  const byHand = await runs.startRun("test-trig", "default", "Digest", new Date("2026-08-21T10:00:00Z"), "manual");

  assert.equal((await runs.readRun("test-trig", tick)).trigger, "schedule");
  assert.equal((await runs.readRun("test-trig", byHand)).trigger, "manual");
  assert.deepEqual((await runs.listRuns("test-trig")).map((r) => r.trigger), ["manual", "schedule"]);

  // Anything that is not "manual" is the tick. The value reaches a column
  // people filter on, so it is mapped rather than passed through.
  const junk = await runs.startRun("test-trig", "default", "Digest", new Date(), "'; drop table schedule_run; --");
  assert.equal((await runs.readRun("test-trig", junk)).trigger, "schedule");
});

test("the listing is newest first and carries no answer body", { skip }, async () => {
  const a = await runs.startRun("test-list", "default", "First", new Date("2026-08-21T09:00:00Z"));
  const b = await runs.startRun("test-list", "default", "Second", new Date("2026-08-21T10:00:00Z"));
  await runs.finishRun(a, { status: "success", result: { answer: "one" } });
  await runs.finishRun(b, { status: "success", result: { answer: "two" } });

  const list = await runs.listRuns("test-list");
  assert.deepEqual(list.map((r) => r.id), [b, a]);
  // The table shows the answer's first line, never the step trail or the
  // citations — those are the expensive columns and nothing on the row needs
  // them.
  assert.equal(list[0].answer, "two");
  assert.equal(list[0].result, undefined);
});

test("a run cannot be read through another agent's page", { skip }, async () => {
  const id = await runs.startRun("test-hr", "default", "Private");
  assert.equal(await runs.readRun("test-eng", id), null);
  // The id is a plain sequence, so the next one along belongs to someone
  // else's schedule and the agent is what stops it being readable.
  assert.ok(await runs.readRun("test-hr", id));
});

test("a junk id is refused rather than reaching the query", { skip }, async () => {
  assert.equal(await runs.readRun("test-hr", "1 or 1=1"), null);
  assert.equal(await runs.readRun("test-hr", "abc"), null);
});

test("renaming an agent takes its executions with it", { skip }, async () => {
  const id = await runs.startRun("test-before", "default", "Digest");
  await runs.renameAgentRuns("test-before", "test-after");
  assert.equal(await runs.readRun("test-before", id), null);
  assert.equal((await runs.readRun("test-after", id))?.id, id);
});
