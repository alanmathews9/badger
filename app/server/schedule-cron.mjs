// Turning "every 30 minutes" into cron, and deciding whether a cron is due.
//
// The framework's schedule store is cron-only and drops any key it does not
// know (dist/schedules.js builds a fresh object from a fixed list on read AND
// on write), so there is nowhere to put an interval of our own. The UI is bent
// to cron instead: the dropdown offers only intervals cron can express
// faithfully, and this file is the translation both ways.
//
// **Every field is read in India Standard Time.** The server runs UTC, the
// browser is wherever the reader is, and a schedule that means one thing in
// the YAML and another on screen is the one-fact-stored-twice generator this
// codebase keeps tripping over. IST is fixed at +5:30 with no daylight saving,
// so there is no hour that happens twice and none that never happens.
//
// Nothing here calls node-cron. `startScheduler` is never started — Cloud Run
// scales to zero, so an in-process cron never fires — and node-cron has no
// next-run or prev-run API to borrow. Matching is ours.

/** IST is UTC+5:30, always. No daylight saving, no historical shifts. */
export const IST_OFFSET_MINUTES = 330;

/** What the modal shows beside the interval, and what the banner says. */
export const TIMEZONE_LABEL = "India Standard Time (IST)";

/** One slot. Every cron this file generates fires only on these boundaries. */
const SLOT_MS = 15 * 60 * 1000;

/** How far back the tick will look. See `isDue`. */
const CATCHUP_MS = 24 * 60 * 60 * 1000;

/**
 * The intervals the dropdown offers, and nothing else.
 *
 * Each one is faithfully expressible in cron, which is the whole reason the
 * list is closed. "Every 3 days" is not here because cron cannot say it — a
 * step of 3 on the day field restarts at each month boundary, so it would fire
 * on the 1st, 4th, 7th and then the 1st again.
 */
export const INTERVALS = {
  minutes: [15, 30],
  hours: [1, 2, 3, 4, 6, 8, 12],
  days: [1],
  months: [1, 2, 3, 4, 6],
};

/** The same date, as the wall-clock fields IST would show. */
export function istFields(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    minute: shifted.getUTCMinutes(),
    hour: shifted.getUTCHours(),
    dayOfMonth: shifted.getUTCDate(),
    // Cron months are 1-12.
    month: shifted.getUTCMonth() + 1,
    // Cron weekdays are 0-6 from Sunday, which is what getUTCDay gives.
    dayOfWeek: shifted.getUTCDay(),
  };
}

/**
 * The next 15-minute mark strictly after `from`. The anchor every schedule
 * hangs off.
 *
 * Strictly after, so a schedule created exactly on the mark does not claim a
 * first run in the same instant it was created.
 *
 * The 15-minute grid is the same in IST as in UTC — the offset is 330
 * minutes, a whole number of slots — so this needs no timezone arithmetic.
 */
export function nextSlot(from) {
  const ms = from instanceof Date ? from.getTime() : new Date(from).getTime();
  return new Date(Math.floor(ms / SLOT_MS) * SLOT_MS + SLOT_MS);
}

/**
 * The cron for an interval, anchored to a moment.
 *
 * The anchor is what makes the modal's "First run at 4:45 PM" literally true
 * rather than approximately true. Without it, "every 30 minutes" created at
 * 16:35 would generate `0,30 * * * *` and first fire at 17:00 while the banner
 * promised 16:45.
 *
 * @param {Date} anchor the moment the first run should land on, normally `nextSlot(now)`
 * @param {{every:number, unit:"minutes"|"hours"|"days"|"months"}} interval
 */
export function cronFor(anchor, { every, unit }) {
  const allowed = INTERVALS[unit];
  if (!allowed) throw new Error("not a schedulable unit");
  if (!allowed.includes(Number(every))) throw new Error("not a schedulable interval");
  const n = Number(every);
  const at = istFields(anchor);

  switch (unit) {
    case "minutes":
      // 15 divides the hour exactly, so `*/15` already lands on the anchor.
      // 30 does not — the anchor may be at :15 or :45 — so the two minutes are
      // listed rather than stepped.
      if (n === 15) return "*/15 * * * *";
      return `${at.minute % 30},${(at.minute % 30) + 30} * * * *`;
    case "hours": {
      // NOT `*/N`. A step counts from zero, so every 3 hours anchored at 16:45
      // would first fire at 18:45 and the banner would be wrong for two of the
      // seven options. The hours are listed from the anchor's own hour
      // instead, which every option can do exactly because they all divide 24.
      if (n === 1) return `${at.minute} * * * *`;
      const hours = [];
      for (let h = at.hour % n; h < 24; h += n) hours.push(h);
      return `${at.minute} ${hours.join(",")} * * *`;
    }
    case "days":
      return `${at.minute} ${at.hour} * * *`;
    case "months": {
      // Listed from the anchor's own month, for the same reason the hours are:
      // a step counts from zero, so every 3 months anchored in August would
      // first fire in September. Every option divides 12, so the list wraps
      // evenly through December and back into January.
      //
      // The day of month is the anchor's own, unclamped: a schedule created on
      // the 31st really does skip February, and `nextRunAt` reports the true
      // next firing rather than a comfortable approximation of it.
      if (n === 1) return `${at.minute} ${at.hour} ${at.dayOfMonth} * *`;
      const months = [];
      for (let m = 1; m <= 12; m++) if ((m - at.month) % n === 0) months.push(m);
      return `${at.minute} ${at.hour} ${at.dayOfMonth} ${months.join(",")} *`;
    }
  }
}

/**
 * Read a cron back into the interval that produced it, for the editor.
 *
 * Only the shapes `cronFor` writes are recognised. Anything else — a cron
 * hand-written into the YAML — comes back null, and the UI shows the
 * expression rather than pretending it is one of ours.
 */
export function intervalFor(cron) {
  const parts = String(cron ?? "").trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, month] = parts;

  if (cron.trim() === "*/15 * * * *") return { every: 15, unit: "minutes" };
  if (/^\d+,\d+$/.test(minute) && hour === "*" && dom === "*" && month === "*") {
    return { every: 30, unit: "minutes" };
  }
  // Anything with a day-of-week constraint is hand-written, not ours.
  if (parts[4] !== "*") return null;

  if (/^\d+$/.test(minute) && dom === "*" && month === "*") {
    // Every hour, written as a star rather than a list of 24.
    if (hour === "*") return { every: 1, unit: "hours" };
    // An evenly spaced list of hours is one of ours; anything else is not.
    if (/^\d+(,\d+)+$/.test(hour)) {
      const hours = hour.split(",").map(Number);
      const every = 24 / hours.length;
      const even = hours.every((h, i) => i === 0 || h - hours[i - 1] === every);
      if (Number.isInteger(every) && even && INTERVALS.hours.includes(every)) {
        return { every, unit: "hours" };
      }
    }
  }
  if (/^\d+$/.test(dom) && /^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    if (month === "*") return { every: 1, unit: "months" };
    if (/^\d+(,\d+)+$/.test(month)) {
      const months = month.split(",").map(Number);
      const every = 12 / months.length;
      const even = months.every((m, i) => i === 0 || m - months[i - 1] === every);
      if (Number.isInteger(every) && even && INTERVALS.months.includes(every)) {
        return { every, unit: "months" };
      }
    }
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === "*" && month === "*") {
    return { every: 1, unit: "days" };
  }
  return null;
}

/** "Every 30 minutes", "Every 2 hours", "Every day", "Every 3 months". */
export function describeInterval({ every, unit }) {
  const one = every === 1;
  const noun = one ? unit.replace(/s$/, "") : `${every} ${unit}`;
  return `Every ${noun}`;
}

/**
 * Does one cron field match one value?
 *
 * Handles a star, a step, a comma list, a range and a literal — which is every
 * shape `cronFor` writes plus the ones a person might hand-write. A step is
 * modulo from zero rather than from the field's own minimum, which is what
 * crontab does and why a day-field step skips at month boundaries.
 */
function fieldMatches(field, value) {
  for (const term of String(field).split(",")) {
    if (term === "*") return true;
    const step = /^(\*|\d+-\d+)\/(\d+)$/.exec(term);
    if (step) {
      const n = Number(step[2]);
      if (n > 0 && value % n === 0) {
        if (step[1] === "*") return true;
        const [lo, hi] = step[1].split("-").map(Number);
        if (value >= lo && value <= hi) return true;
      }
      continue;
    }
    const range = /^(\d+)-(\d+)$/.exec(term);
    if (range && value >= Number(range[1]) && value <= Number(range[2])) return true;
    if (/^\d+$/.test(term) && Number(term) === value) return true;
  }
  return false;
}

/** What each cron field is allowed to hold, in order. */
const RANGES = [
  { name: "minute", lo: 0, hi: 59 },
  { name: "hour", lo: 0, hi: 23 },
  { name: "day of month", lo: 1, hi: 31 },
  { name: "month", lo: 1, hi: 12 },
  { name: "day of week", lo: 0, hi: 6 },
];

/** Is one term of one field a shape we understand, and in range? */
function termValid(term, { lo, hi }) {
  if (term === "*") return true;
  const step = /^(\*|\d+-\d+)\/(\d+)$/.exec(term);
  if (step) {
    if (Number(step[2]) < 1) return false;
    if (step[1] === "*") return true;
    const [a, b] = step[1].split("-").map(Number);
    return a >= lo && b <= hi && a <= b;
  }
  const range = /^(\d+)-(\d+)$/.exec(term);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])];
    return a >= lo && b <= hi && a <= b;
  }
  if (!/^\d+$/.test(term)) return false;
  return Number(term) >= lo && Number(term) <= hi;
}

/**
 * Why this cron cannot be used, or null if it can.
 *
 * The second check is the one that matters and the one a cron reference will
 * not tell you about: **the tick only runs every 15 minutes**, so a cron whose
 * minute field can never be 0, 15, 30 or 45 is syntactically perfect and will
 * never fire. `7 * * * *` is the obvious one. Refusing it here is the
 * difference between a clear message now and an Executions tab that stays
 * empty forever while looking exactly like one nobody has scheduled.
 */
export function cronProblem(cron) {
  const text = String(cron ?? "").trim();
  if (!text) return "a cron expression is required";
  const parts = text.split(/\s+/);
  if (parts.length !== 5) return "a cron expression has five fields: minute hour day month weekday";

  for (const [i, field] of parts.entries()) {
    for (const term of field.split(",")) {
      if (!termValid(term, RANGES[i])) {
        return `${RANGES[i].name} does not accept "${term}"`;
      }
    }
  }

  if (!nextRunAt(text)) {
    return "that never comes round. Runs are checked every 15 minutes, so the minute field has to allow 0, 15, 30 or 45";
  }
  return null;
}

/** Does this cron fire at this moment, read in IST? */
export function matchesAt(cron, date) {
  const parts = String(cron ?? "").trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const at = istFields(date);
  return (
    fieldMatches(parts[0], at.minute) &&
    fieldMatches(parts[1], at.hour) &&
    fieldMatches(parts[2], at.dayOfMonth) &&
    fieldMatches(parts[3], at.month) &&
    fieldMatches(parts[4], at.dayOfWeek)
  );
}

/**
 * The next moment this cron fires, at or after `from`. Null if it never does
 * within the horizon.
 *
 * Walks the 15-minute grid rather than solving the cron, because every cron
 * this product writes fires only on that grid and the walk cannot disagree
 * with `matchesAt` the way a second implementation could. A year of slots is
 * 35,040 comparisons, which is microseconds.
 *
 * The horizon is 400 days: longer than the longest interval offered (6
 * months) plus the worst skip a day-of-month anchor can cause.
 */
export function nextRunAt(cron, from = new Date()) {
  const start = nextSlot(new Date(from.getTime() - 1));
  const horizon = 400 * 24 * 4;
  for (let i = 0; i < horizon; i++) {
    const at = new Date(start.getTime() + i * SLOT_MS);
    if (matchesAt(cron, at)) return at;
  }
  return null;
}

/**
 * Is this schedule due, given when it last ran?
 *
 * The tick runs every 15 minutes and can miss: a redeploy, a cold start, a
 * Cloud Scheduler retry. So this walks every slot between the last run and now
 * and fires ONCE if any of them matched, rather than firing once per missed
 * slot. For a digest you want the current answer, not four stale ones.
 *
 * Capped at 24 hours back. Without the cap, a schedule idle for a month would
 * come back and match — which is right — but a bug that made the walk fire per
 * slot would then cost a month of answers rather than a day's. The cap is
 * cheap insurance on the expensive path.
 *
 * A schedule that has never run is due at its first matching slot, which is
 * its anchor, so `lastRunAt` falls back to `createdAt`.
 */
export function isDue(schedule, now = new Date()) {
  if (!schedule?.enabled) return false;
  if (!schedule.cron) return false;

  const since = new Date(schedule.lastRunAt || schedule.createdAt || 0).getTime();
  const floor = now.getTime() - CATCHUP_MS;
  const from = Number.isFinite(since) ? Math.max(since, floor) : floor;

  // Strictly after `from`, up to and including the slot `now` sits in.
  const first = nextSlot(new Date(from));
  const last = Math.floor(now.getTime() / SLOT_MS) * SLOT_MS;
  for (let t = first.getTime(); t <= last; t += SLOT_MS) {
    if (matchesAt(schedule.cron, new Date(t))) return true;
  }
  return false;
}
