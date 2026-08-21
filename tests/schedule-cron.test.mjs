// The cron generator and the due-slot matcher.
//
// This is the part that will be wrong in a way nobody notices for a week: a
// scheduler that fires slightly too rarely looks exactly like a scheduler
// nobody has triggered yet. So it is tested before anything above it exists —
// no server, no database, no model call, no clock of its own.
//
// Every expected time is written as a UTC instant with the IST wall clock it
// corresponds to in the comment beside it, because the whole point of the
// module is that those two are different and only one of them is displayed.
import { deepStrictEqual, match, ok, strictEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  INTERVALS,
  cronFor,
  cronProblem,
  describeInterval,
  intervalFor,
  isDue,
  istFields,
  matchesAt,
  nextRunAt,
  nextSlot,
} from "../app/server/schedule-cron.mjs";

/** 2026-08-21 11:05 UTC is 16:35 IST — the plan's own worked example. */
const CREATED = new Date("2026-08-21T11:05:00Z");
/** …whose anchor is 11:15 UTC, 16:45 IST. */
const ANCHOR = new Date("2026-08-21T11:15:00Z");

test("IST is read as +5:30, not as the server's zone", () => {
  deepStrictEqual(istFields(CREATED), {
    minute: 35,
    hour: 16,
    dayOfMonth: 21,
    month: 8,
    // 2026-08-21 is a Friday.
    dayOfWeek: 5,
  });
});

test("the anchor is the next 15-minute mark, strictly after", () => {
  strictEqual(nextSlot(CREATED).toISOString(), ANCHOR.toISOString());
  // Already on a mark: the next one, not this one. A schedule must not claim
  // a first run in the instant it was created.
  strictEqual(nextSlot(ANCHOR).toISOString(), "2026-08-21T11:30:00.000Z");
});

test("every offered interval generates the cron the plan specifies", () => {
  strictEqual(cronFor(ANCHOR, { every: 15, unit: "minutes" }), "*/15 * * * *");
  strictEqual(cronFor(ANCHOR, { every: 30, unit: "minutes" }), "15,45 * * * *");
  // Hours are LISTED from the anchor's own hour, not stepped from midnight:
  // 16:45 IST every 3 hours is 1,4,7,…,16,…, and a step would first fire at
  // 18:45 with the banner still promising 16:45.
  strictEqual(cronFor(ANCHOR, { every: 2, unit: "hours" }), "45 0,2,4,6,8,10,12,14,16,18,20,22 * * *");
  strictEqual(cronFor(ANCHOR, { every: 3, unit: "hours" }), "45 1,4,7,10,13,16,19,22 * * *");
  strictEqual(cronFor(ANCHOR, { every: 1, unit: "hours" }), "45 * * * *");
  // 16:45 IST, and the hour field is IST's 16 rather than UTC's 11.
  strictEqual(cronFor(ANCHOR, { every: 1, unit: "days" }), "45 16 * * *");
  // Months are listed from the anchor's own month for the same reason the
  // hours are: August every 3 months is Feb/May/Aug/Nov, and a step from zero
  // would first fire in September.
  strictEqual(cronFor(ANCHOR, { every: 3, unit: "months" }), "45 16 21 2,5,8,11 *");
  strictEqual(cronFor(ANCHOR, { every: 1, unit: "months" }), "45 16 21 * *");
});

test("an interval that is not on the dropdown is refused", () => {
  throws(() => cronFor(ANCHOR, { every: 3, unit: "days" }), /not a schedulable interval/);
  throws(() => cronFor(ANCHOR, { every: 5, unit: "minutes" }), /not a schedulable interval/);
  throws(() => cronFor(ANCHOR, { every: 1, unit: "weeks" }), /not a schedulable unit/);
});

test("every generated cron fires first at its own anchor", () => {
  // The promise the modal makes. If this breaks, the banner starts lying and
  // nothing else looks wrong.
  for (const [unit, values] of Object.entries(INTERVALS)) {
    for (const every of values) {
      const cron = cronFor(ANCHOR, { every, unit });
      strictEqual(
        nextRunAt(cron, CREATED)?.toISOString(),
        ANCHOR.toISOString(),
        `${every} ${unit} (${cron}) did not first fire at its anchor`,
      );
    }
  }
});

test("every generated cron fires only on 15-minute marks", () => {
  const cron = cronFor(ANCHOR, { every: 1, unit: "hours" });
  let at = new Date(ANCHOR);
  for (let i = 0; i < 24; i++) {
    at = nextRunAt(cron, new Date(at.getTime() + 1));
    strictEqual(at.getTime() % (15 * 60 * 1000), 0);
  }
});

test("the interval round-trips back out of the cron for the editor", () => {
  for (const [unit, values] of Object.entries(INTERVALS)) {
    for (const every of values) {
      deepStrictEqual(intervalFor(cronFor(ANCHOR, { every, unit })), { every, unit });
    }
  }
  // A cron nobody here wrote is not forced into a shape it does not have.
  strictEqual(intervalFor("0 9 * * 1"), null);
  strictEqual(intervalFor("nonsense"), null);
});

test("matching reads the fields in IST", () => {
  const daily = cronFor(ANCHOR, { every: 1, unit: "days" });
  ok(matchesAt(daily, ANCHOR));
  // 16:45 UTC is 22:15 IST — the same wall clock in the wrong zone must not
  // match, or the schedule fires five and a half hours early.
  ok(!matchesAt(daily, new Date("2026-08-21T16:45:00Z")));
});

test("a missed window fires once, not once per missed slot", () => {
  // Every 15 minutes, last run 3 hours ago: twelve slots matched, and the
  // answer is still one run.
  const schedule = {
    enabled: true,
    cron: "*/15 * * * *",
    createdAt: "2026-08-21T00:00:00Z",
    lastRunAt: "2026-08-21T08:00:00Z",
  };
  strictEqual(isDue(schedule, new Date("2026-08-21T11:00:00Z")), true);
});

test("not due again inside its own interval", () => {
  const schedule = {
    enabled: true,
    cron: cronFor(ANCHOR, { every: 2, unit: "hours" }),
    createdAt: "2026-08-21T11:05:00Z",
    lastRunAt: "2026-08-21T11:15:00Z",
  };
  // 11:15 UTC is 16:45 IST. The next listed hour is 18 IST, so 12:15 UTC
  // (17:45 IST) is not due and 13:15 UTC (18:45 IST) is.
  strictEqual(isDue(schedule, new Date("2026-08-21T12:15:00Z")), false);
  strictEqual(isDue(schedule, new Date("2026-08-21T13:15:00Z")), true);
});

test("a schedule that has never run is due at its anchor and not before", () => {
  const schedule = {
    enabled: true,
    cron: cronFor(ANCHOR, { every: 1, unit: "days" }),
    createdAt: CREATED.toISOString(),
  };
  strictEqual(isDue(schedule, CREATED), false);
  strictEqual(isDue(schedule, ANCHOR), true);
});

test("a disabled schedule is never due", () => {
  strictEqual(isDue({ enabled: false, cron: "*/15 * * * *", createdAt: "2026-01-01T00:00:00Z" }), false);
});

test("the catch-up window is capped at 24 hours", () => {
  // Idle for a month. It is due — coming back to a current answer is right —
  // and the cap is what stops the walk being a month long.
  const schedule = {
    enabled: true,
    cron: "45 16 * * *",
    createdAt: "2026-07-01T00:00:00Z",
    lastRunAt: "2026-07-01T00:00:00Z",
  };
  strictEqual(isDue(schedule, new Date("2026-08-21T11:20:00Z")), true);
  // …and having run at yesterday's slot, it is not due again until today's.
  strictEqual(
    isDue({ ...schedule, lastRunAt: "2026-08-20T11:15:00Z" }, new Date("2026-08-21T11:00:00Z")),
    false,
  );
});

test("a monthly schedule anchored to the 31st skips February rather than lying", () => {
  const anchor = new Date("2026-01-31T11:15:00Z"); // 16:45 IST on the 31st
  const cron = cronFor(anchor, { every: 1, unit: "months" });
  strictEqual(cron, "45 16 31 * *");
  // The banner is computed from this, so it says March and is true, rather
  // than saying February and being wrong.
  strictEqual(
    nextRunAt(cron, new Date(anchor.getTime() + 1000))?.toISOString(),
    "2026-03-31T11:15:00.000Z",
  );
});

test("a hand-written cron is checked for shape and for range", () => {
  strictEqual(cronProblem("0 9 * * 1"), null);
  strictEqual(cronProblem("*/15 * * * *"), null);
  match(cronProblem("nonsense"), /five fields/);
  match(cronProblem("*/15 * * *"), /five fields/);
  match(cronProblem("60 * * * *"), /minute does not accept/);
  match(cronProblem("0 24 * * *"), /hour does not accept/);
  match(cronProblem("0 9 32 * *"), /day of month does not accept/);
  match(cronProblem(""), /required/);
});

test("a cron that can never land on the 15-minute grid is refused", () => {
  // THE check worth having, and the one a cron reference will not warn about.
  // The tick runs every 15 minutes, so `7 * * * *` is syntactically perfect
  // and fires never — which on screen is indistinguishable from nobody having
  // scheduled anything at all.
  match(cronProblem("7 * * * *"), /every 15 minutes/);
  match(cronProblem("1-14 * * * *"), /every 15 minutes/);
  // …while a minute field that includes one of the four marks is fine.
  strictEqual(cronProblem("0,7 * * * *"), null);
});

test("the interval reads the way it is said out loud", () => {
  strictEqual(describeInterval({ every: 30, unit: "minutes" }), "Every 30 minutes");
  strictEqual(describeInterval({ every: 1, unit: "days" }), "Every day");
  strictEqual(describeInterval({ every: 1, unit: "hours" }), "Every hour");
  strictEqual(describeInterval({ every: 3, unit: "months" }), "Every 3 months");
});
