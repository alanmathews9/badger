// The schedule store, against real directories and the framework's own reader.
//
// The store is thin on purpose — the framework owns the file format — so what
// is worth pinning is the seam between the two: that a save survives the
// framework's fixed-key rewrite, that the interval vocabulary is enforced
// where the file is written rather than only in the browser, and that the one
// schedule per agent really is one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSchedules } from "@open-gitagent/gitagent";
import {
  SCHEDULE_ID,
  dueSchedules,
  listSchedules,
  readSchedule,
  removeSchedule,
  writeSchedule,
} from "../app/server/schedules-store.mjs";

/** An agents/ directory holding two empty agent folders. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "badger-schedules-"));
  for (const slug of ["hr-badger", "eng-badger"]) {
    mkdirSync(join(dir, slug), { recursive: true });
    // agent.yaml is what makes a directory an agent, and the store checks for
    // it before writing — see the test below for what happens without it.
    writeFileSync(join(dir, slug, "agent.yaml"), `name: ${slug}\n`);
  }
  return dir;
}

/** 2026-08-21 11:05 UTC — 16:35 IST, so the anchor is 16:45 IST. */
const NOW = new Date("2026-08-21T11:05:00Z");

test("an agent with no schedule reads as none, not as an error", async () => {
  const dir = scratch();
  assert.equal(await readSchedule(dir, "hr-badger"), null);
  assert.deepEqual(await listSchedules(dir, ["hr-badger", "eng-badger"]), []);
});

test("a saved schedule lands where the framework's own reader finds it", async () => {
  const dir = scratch();
  await writeSchedule(dir, "hr-badger", { prompt: "Anything new in leave policy?", every: 30, unit: "minutes" }, { now: NOW });

  // Not our reader — the runtime's, from dist/schedules.js. If the shape ever
  // stops being the framework's, this is what notices.
  const [found] = await discoverSchedules(join(dir, "hr-badger"));
  assert.equal(found.id, SCHEDULE_ID);
  assert.equal(found.prompt, "Anything new in leave policy?");
  assert.equal(found.cron, "15,45 * * * *");
  assert.equal(found.enabled, true);
  assert.equal(found.mode, "repeat");
});

test("the interval and the next run come back derived, in IST", async () => {
  const dir = scratch();
  await writeSchedule(dir, "hr-badger", { prompt: "Digest", every: 1, unit: "days" }, { now: NOW });
  const read = await readSchedule(dir, "hr-badger");
  assert.deepEqual(read.interval, { every: 1, unit: "days" });
  assert.equal(read.label, "Every day");
  assert.equal(read.agent, "hr-badger");
  // 16:45 IST, whichever day it next falls on.
  assert.match(read.cron, /^45 16 /);
});

test("an interval the dropdown does not offer is refused at the file, not just in the browser", async () => {
  const dir = scratch();
  await assert.rejects(
    () => writeSchedule(dir, "hr-badger", { prompt: "Digest", every: 5, unit: "minutes" }, { now: NOW }),
    /not a schedulable interval/,
  );
  await assert.rejects(
    () => writeSchedule(dir, "hr-badger", { prompt: "Digest", every: 3, unit: "days" }, { now: NOW }),
    /not a schedulable interval/,
  );
  assert.equal(existsSync(join(dir, "hr-badger", "schedules")), false);
});

test("an empty question is refused", async () => {
  const dir = scratch();
  await assert.rejects(
    () => writeSchedule(dir, "hr-badger", { prompt: "   ", every: 15, unit: "minutes" }, { now: NOW }),
    /needs a question/,
  );
});

test("a schedule cannot be created for an agent that does not exist", async () => {
  const dir = scratch();
  // Without this the framework's saveSchedule mkdir's the whole path, and in
  // repo mode saveEdit commits and pushes a folder holding a schedule for an
  // agent nobody can open. That is not hypothetical — it happened against a
  // running server and had to be reverted off the learning branch.
  await assert.rejects(
    () => writeSchedule(dir, "ghost-badger", { prompt: "x", every: 15, unit: "minutes" }),
    /no such agent/,
  );
  assert.equal(existsSync(join(dir, "ghost-badger")), false);
  await assert.rejects(() => readSchedule(dir, "ghost-badger"), /no such agent/);
});

test("a slug that is not an agent name cannot reach the filesystem", async () => {
  const dir = scratch();
  await assert.rejects(() => readSchedule(dir, "../../etc"), /not a valid agent name/);
  await assert.rejects(
    () => writeSchedule(dir, "../escape", { prompt: "x", every: 15, unit: "minutes" }),
    /not a valid agent name/,
  );
});

test("editing the prompt does not move when it runs", async () => {
  const dir = scratch();
  const first = await writeSchedule(dir, "hr-badger", { prompt: "One", every: 2, unit: "hours" }, { now: NOW });
  // An hour later, which would anchor somewhere else entirely.
  const later = new Date(NOW.getTime() + 60 * 60 * 1000);
  const second = await writeSchedule(dir, "hr-badger", { prompt: "Two", every: 2, unit: "hours" }, { now: later });
  assert.equal(second.prompt, "Two");
  assert.equal(second.cron, first.cron);
  assert.equal(second.createdAt, first.createdAt);
});

test("changing the interval re-anchors, because the banner has to stay true", async () => {
  const dir = scratch();
  const first = await writeSchedule(dir, "hr-badger", { prompt: "One", every: 2, unit: "hours" }, { now: NOW });
  const later = new Date("2026-08-21T12:05:00Z"); // 17:35 IST, anchor 17:45
  const second = await writeSchedule(dir, "hr-badger", { prompt: "One", every: 1, unit: "days" }, { now: later });
  assert.notEqual(second.cron, first.cron);
  assert.equal(second.cron, "45 17 * * *");
});

test("lastRunAt survives a save", async () => {
  const dir = scratch();
  await writeSchedule(dir, "hr-badger", { prompt: "One", every: 15, unit: "minutes" }, { now: NOW });
  // What executeScheduledJob stamps back after a run.
  const { updateScheduleMeta } = await import("@open-gitagent/gitagent");
  await updateScheduleMeta(join(dir, "hr-badger"), SCHEDULE_ID, {
    lastRunAt: "2026-08-21T11:15:00.000Z",
    lastResult: "success",
  });

  // saveSchedule rebuilds the object from a fixed key list, so anything the
  // wrapper does not carry through is silently dropped — and dropping
  // lastRunAt makes the schedule due again the instant it is edited.
  const saved = await writeSchedule(dir, "hr-badger", { prompt: "Two", every: 15, unit: "minutes" }, { now: NOW });
  assert.equal(saved.lastRunAt, "2026-08-21T11:15:00.000Z");
  assert.equal(saved.lastResult, "success");
});

test("there is exactly one schedule per agent, however many times it is saved", async () => {
  const dir = scratch();
  await writeSchedule(dir, "hr-badger", { prompt: "One", every: 15, unit: "minutes" }, { now: NOW });
  await writeSchedule(dir, "hr-badger", { prompt: "Two", every: 1, unit: "days" }, { now: NOW });
  const all = await discoverSchedules(join(dir, "hr-badger"));
  assert.equal(all.length, 1);
  assert.equal(all[0].prompt, "Two");
});

test("a hand-written cron is stored as written, with no anchoring", async () => {
  const dir = scratch();
  const saved = await writeSchedule(dir, "hr-badger", { prompt: "Monday standup", cron: "0 9 * * 1" }, { now: NOW });
  assert.equal(saved.cron, "0 9 * * 1");
  // Not one of ours, so it is shown as itself rather than as an interval it
  // is not — and the editor knows to open on the cron side.
  assert.equal(saved.interval, null);
  assert.equal(saved.label, "0 9 * * 1");
  assert.ok(saved.nextRunAt);
});

test("a cron that would never fire is refused where the file is written", async () => {
  const dir = scratch();
  await assert.rejects(
    () => writeSchedule(dir, "hr-badger", { prompt: "x", cron: "7 * * * *" }),
    /every 15 minutes/,
  );
  await assert.rejects(
    () => writeSchedule(dir, "hr-badger", { prompt: "x", cron: "not a cron" }),
    /five fields/,
  );
  assert.equal(await readSchedule(dir, "hr-badger"), null);
});

test("switching from a cron back to an interval re-anchors", async () => {
  const dir = scratch();
  await writeSchedule(dir, "hr-badger", { prompt: "One", cron: "0 9 * * 1" }, { now: NOW });
  const back = await writeSchedule(dir, "hr-badger", { prompt: "One", every: 1, unit: "days" }, { now: NOW });
  assert.equal(back.cron, "45 16 * * *");
  assert.deepEqual(back.interval, { every: 1, unit: "days" });
});

test("delete removes the directory, so nothing empty is committed", async () => {
  const dir = scratch();
  await writeSchedule(dir, "hr-badger", { prompt: "One", every: 15, unit: "minutes" }, { now: NOW });
  assert.equal(await removeSchedule(dir, "hr-badger"), true);
  assert.equal(existsSync(join(dir, "hr-badger", "schedules")), false);
  assert.equal(await readSchedule(dir, "hr-badger"), null);
  // Deleting one that is not there is not an error.
  assert.equal(await removeSchedule(dir, "hr-badger"), false);
});

test("the tick sees only the agents whose schedule is due", async () => {
  const dir = scratch();
  await writeSchedule(dir, "hr-badger", { prompt: "Quarter hourly", every: 15, unit: "minutes" }, { now: NOW });
  await writeSchedule(dir, "eng-badger", { prompt: "Daily", every: 1, unit: "days" }, { now: NOW });

  const slugs = ["hr-badger", "eng-badger"];
  // The anchor itself: both were created at 16:35 IST and both anchor to
  // 16:45, so both are due on the first tick that reaches it.
  const atAnchor = await dueSchedules(dir, slugs, new Date("2026-08-21T11:15:00Z"));
  assert.deepEqual(atAnchor.map((s) => s.agent).sort(), ["eng-badger", "hr-badger"]);

  // Fifteen minutes on, with both marked as having run at the anchor: only
  // the quarter-hourly one comes back.
  const { updateScheduleMeta } = await import("@open-gitagent/gitagent");
  for (const slug of slugs) {
    await updateScheduleMeta(join(dir, slug), SCHEDULE_ID, { lastRunAt: "2026-08-21T11:15:00.000Z" });
  }
  const next = await dueSchedules(dir, slugs, new Date("2026-08-21T11:30:00Z"));
  assert.deepEqual(next.map((s) => s.agent), ["hr-badger"]);
});

test("a disabled schedule is still readable and never due", async () => {
  const dir = scratch();
  await writeSchedule(dir, "hr-badger", { prompt: "One", every: 15, unit: "minutes", enabled: false }, { now: NOW });
  const read = await readSchedule(dir, "hr-badger");
  assert.equal(read.enabled, false);
  // No next run to show, because there is not one.
  assert.equal(read.nextRunAt, null);
  assert.deepEqual(await dueSchedules(dir, ["hr-badger"], new Date("2026-08-21T11:15:00Z")), []);
});

test("a hand-written cron is shown as itself rather than as an interval it is not", async () => {
  const dir = scratch();
  mkdirSync(join(dir, "hr-badger", "schedules"), { recursive: true });
  writeFileSync(
    join(dir, "hr-badger", "schedules", `${SCHEDULE_ID}.yaml`),
    "id: default\nprompt: Monday standup\ncron: 0 9 * * 1\nmode: repeat\nenabled: true\ncreatedAt: 2026-08-01T00:00:00Z\n",
  );
  const read = await readSchedule(dir, "hr-badger");
  assert.equal(read.interval, null);
  assert.equal(read.label, "0 9 * * 1");
});
