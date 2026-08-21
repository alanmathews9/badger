// A sub-agent's schedule: a saved question it asks itself on an interval.
//
// **The framework's own store, used unchanged.** `dist/schedules.js` reads and
// writes `schedules/<id>.yaml` inside an agent directory, and it is exported
// from the package root. Unlike the git case — where the runtime had no
// mechanism and `AGENT.saveEdit` had to be written — there is a mechanism
// here, so this file is a thin wrapper and not a third lookalike store beside
// agents-store and skills-store.
//
// What the wrapper adds is the two things the framework has no opinion about:
// the interval vocabulary (schedule-cron.mjs, IST throughout) and the rule
// that there is exactly ONE schedule per agent. One is a product decision, not
// a limit of the store — the id is still written into every execution row, so
// the day a second one is wanted nothing below has to be migrated.
//
// Schedules live only on sub-agents. Badger itself has no agent page to hang
// the UI off, and a scheduled question that runs as Badger is what /chat is.
import { discoverSchedules, saveSchedule, deleteSchedule } from "@open-gitagent/gitagent";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { agentDir } from "./agents-store.mjs";
import { cronFor, describeInterval, intervalFor, isDue, nextRunAt, nextSlot } from "./schedule-cron.mjs";

/**
 * The one schedule's id. Kebab-case because `saveSchedule` insists (it throws
 * otherwise), and fixed because there is one — so creating a second schedule
 * for an agent overwrites the first rather than accumulating orphans nothing
 * lists.
 */
export const SCHEDULE_ID = "default";

/** How long a prompt may be. Long enough for a real question with context. */
const MAX_PROMPT = 4000;

/**
 * The agent's directory, having checked there is an agent in it.
 *
 * `agentDir` validates the SLUG — that is the path-traversal defence — and
 * says nothing about whether the folder holds an agent. Without this check
 * `saveSchedule` happily mkdir's `agents/<anything>/schedules/`, and in repo
 * mode saveEdit then commits and pushes a folder containing a schedule for an
 * agent that does not exist. Measured, not imagined: a probe against a running
 * server put exactly that on the learning branch.
 *
 * agent.yaml is the test because that is what makes a directory an OpenGAP
 * agent (spec §13) and what the runtime itself loads.
 */
function existingAgentDir(agentsDir, slug) {
  const dir = agentDir(agentsDir, slug);
  if (!existsSync(join(dir, "agent.yaml"))) throw new Error("no such agent");
  return dir;
}

/**
 * The agent's schedule, with everything the UI needs derived, or null.
 *
 * `nextRunAt` is computed here rather than stored, because a stored next-run
 * is a second copy of a fact the cron already holds and the two can disagree
 * the moment a run is late.
 */
export async function readSchedule(agentsDir, slug) {
  const dir = existingAgentDir(agentsDir, slug);
  const [schedule] = await discoverSchedules(dir);
  if (!schedule) return null;
  return decorate(slug, schedule);
}

/** Every agent's schedule, for the tick. Agents without one are absent. */
export async function listSchedules(agentsDir, slugs) {
  const found = [];
  for (const slug of slugs) {
    try {
      const schedule = await readSchedule(agentsDir, slug);
      if (schedule) found.push(schedule);
    } catch {
      // A slug that is not a directory, or a schedules/ we cannot read. One
      // agent must not be able to stop the tick for every other agent.
    }
  }
  return found;
}

/** Which of them should run now. */
export async function dueSchedules(agentsDir, slugs, now = new Date()) {
  const all = await listSchedules(agentsDir, slugs);
  return all.filter((s) => isDue(s, now));
}

/**
 * Create or replace the agent's schedule.
 *
 * The cron is generated from an ANCHOR — the next 15-minute mark — so the
 * modal's "First run at 4:45 PM" is the truth rather than an approximation of
 * it. Re-anchoring happens when the interval changes and not when only the
 * prompt or the enabled flag does: editing the wording of a question should
 * not silently move when it runs.
 *
 * @param {{prompt:string, every:number, unit:string, enabled?:boolean}} spec
 */
export async function writeSchedule(agentsDir, slug, spec, { now = new Date() } = {}) {
  const dir = existingAgentDir(agentsDir, slug);
  const prompt = String(spec?.prompt ?? "").trim();
  if (!prompt) throw new Error("a schedule needs a question to ask");
  if (prompt.length > MAX_PROMPT) throw new Error("that question is too long to schedule");

  const every = Number(spec?.every);
  const unit = String(spec?.unit ?? "");
  const existing = (await discoverSchedules(dir))[0] ?? null;
  const was = existing ? intervalFor(existing.cron) : null;
  const changed = !was || was.every !== every || was.unit !== unit;

  // cronFor throws on an interval the dropdown does not offer, which is the
  // whole validation: a request naming "every 5 minutes" is refused here
  // rather than saved as a cron the matcher would honour.
  const cron = changed ? cronFor(nextSlot(now), { every, unit }) : existing.cron;

  await saveSchedule(dir, {
    id: SCHEDULE_ID,
    prompt,
    cron,
    mode: "repeat",
    enabled: spec?.enabled !== false,
    createdAt: existing?.createdAt ?? now.toISOString(),
    // Carried through a save. `saveSchedule` writes a fresh object from a
    // fixed key list, so anything not named here is dropped — and dropping
    // lastRunAt would make the schedule due again immediately.
    ...(existing?.lastRunAt ? { lastRunAt: existing.lastRunAt } : {}),
    ...(existing?.lastResult ? { lastResult: existing.lastResult } : {}),
  });

  return await readSchedule(agentsDir, slug);
}

/** Remove it. Absent is not an error — the button and the file can disagree. */
export async function removeSchedule(agentsDir, slug) {
  const dir = existingAgentDir(agentsDir, slug);
  try {
    await deleteSchedule(dir, SCHEDULE_ID);
  } catch {
    return false;
  }
  // The framework leaves the directory behind. An empty schedules/ is what
  // `discoverSchedules` reads as "no schedules", so this is tidiness rather
  // than correctness — but a stray empty directory in the agent's repo would
  // be committed and pushed by saveEdit and read as a schedule that is not
  // there.
  try {
    rmSync(join(dir, "schedules"), { recursive: true, force: true });
  } catch {
    // Non-fatal.
  }
  return true;
}

/** The stored schedule plus what is derived from it, which is what the UI reads. */
function decorate(slug, schedule) {
  const interval = intervalFor(schedule.cron);
  const next = schedule.enabled ? nextRunAt(schedule.cron) : null;
  return {
    ...schedule,
    agent: slug,
    interval,
    // A cron nobody here generated still renders — as the expression itself,
    // rather than as one of ours that it is not.
    label: interval ? describeInterval(interval) : schedule.cron,
    nextRunAt: next ? next.toISOString() : null,
  };
}
