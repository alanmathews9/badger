// Running a schedule: what happens between "it is due" and "there is a row to
// read".
//
// **The trigger is one Cloud Scheduler job, not an in-process cron.** Cloud
// Run scales to zero — `--max-instances 1` with no `min-instances` — so
// `startScheduler` would load every schedule into a process that is not
// running when they fire. `badger-tick` posts to /api/schedules/tick every 15
// minutes for the life of the product, whatever schedules exist, so the files
// stay the only truth: add, edit, disable, delete or rename, and the
// infrastructure never has to be told.
//
// The alternative — one Cloud Scheduler job per schedule — fires at the exact
// minute and costs a write credential into our own infrastructure, granted to
// a service account whose whole story is that it only reads. It would also
// store each schedule twice, in a file and in a cloud resource, which is the
// same one-fact-in-two-places generator behind the skill-origin bugs.
//
// `executeScheduledJob` is the framework's, unchanged. It dedupes a job
// against itself, calls the `runPrompt` we hand it, appends its own JSONL log,
// and stamps lastRunAt/lastResult back into the YAML — which is what stops the
// next tick firing the same schedule again.
import { executeScheduledJob } from "@open-gitagent/gitagent";
import { join } from "node:path";
import { listAgents } from "./agents-store.mjs";
import { dueSchedules, readSchedule } from "./schedules-store.mjs";
import { finishRun, startRun } from "./executions.mjs";
import { claimAskSlot } from "./limits.mjs";
import { RunError, runAgent } from "./run-agent.mjs";
import { redact } from "./agent-repo.mjs";

/**
 * Run every schedule that is due. Returns what it did, for the tick's reply.
 *
 * Sequential, not parallel. The concurrency cap in limits.mjs is two, and a
 * tick that fired six schedules at once would spend the whole cap on work
 * nobody is waiting for while a person's typed question is refused.
 */
export async function runDue(paths, now = new Date()) {
  const slugs = listAgents(paths.agentsDir).map((a) => a.slug);
  const due = await dueSchedules(paths.agentsDir, slugs, now);

  const ran = [];
  for (const schedule of due) {
    ran.push(await execute(paths, schedule));
  }
  return { checked: slugs.length, due: due.length, ran };
}

/**
 * Run one agent's schedule immediately, whether or not it is due.
 *
 * Behind the passphrase, from the modal's Run now. It exists because a feature
 * that can only be demonstrated in fifteen-minute increments cannot be
 * demonstrated: this is the same code path with the waiting removed, so what a
 * reviewer sees is what the tick does.
 */
export async function runOnce(paths, slug) {
  const schedule = await readSchedule(paths.agentsDir, slug);
  if (!schedule) throw new Error("that agent has no schedule");
  return await execute(paths, schedule);
}

/**
 * One run, recorded either way.
 *
 * The row is opened BEFORE the model is asked anything, so a run that dies
 * with the instance is visible as one that never finished. Nothing here
 * throws: a schedule that fails must not stop the schedules after it in the
 * same tick.
 */
async function execute(paths, schedule) {
  const agent = schedule.agent;
  const triggeredAt = new Date();
  const runId = await startRun(agent, schedule.id, schedule.prompt, triggeredAt);

  // A scheduled answer costs exactly what a typed one costs, so it is limited
  // by exactly the same budget. Claimed here rather than inside runAgent
  // because a refusal has to be RECORDED — a schedule that quietly ate the
  // day's budget, or quietly did not run because it was gone, would be worse
  // than one that visibly failed.
  const slot = claimAskSlot();
  if (slot.error) {
    await finishRun(runId, { status: "error", error: slot.error });
    return { agent, id: runId, status: "error" };
  }

  // The step trail, collected from the same frames the browser renders. The
  // scheduled run has no browser attached, so this is where they go.
  const steps = [];
  let result = null;
  let failure = null;

  const collect = (event, data) => {
    if (event === "tool") steps.push({ index: data.index, name: data.name, args: data.args ?? {} });
    else if (event === "results") {
      const step = steps.find((s) => s.index === data.index);
      if (step) step.results = data.results;
    }
    // `delta` and `warning` are dropped: the deltas are the answer, which
    // arrives whole in the result, and a warning is a live-progress signal
    // with nobody live to signal.
  };

  try {
    // The framework's runner, so its dedupe, its log and its lastRunAt stamp
    // all apply — and its agentDir is the SUB-AGENT's folder, which is where
    // the schedule YAML it updates actually lives.
    await executeScheduledJob(
      { ...schedule, id: schedule.id },
      {
        agentDir: join(paths.agentsDir, agent),
        // No browser is connected and this is not a conversation, so both of
        // the runner's callbacks are no-ops. An execution is filed in
        // schedule_run, not in chat history — see the migration for why.
        broadcastToBrowsers: () => {},
        appendToHistory: () => {},
        runPrompt: async (prompt) => {
          result = await runAgent({
            question: prompt,
            agent,
            emit: collect,
            paths,
          });
          // The runner wants a string and stores it in its own JSONL log. The
          // rich result is captured in the closure above, because that is what
          // the Executions view renders.
          return result.answer ?? "";
        },
      },
    );
  } catch (err) {
    // Redacted: an error out of query() can carry the git URL with its token.
    failure = err instanceof RunError ? err.message : redact(err?.message || String(err));
    console.error(`[scheduler] ${agent}`, redact(err?.stack || err?.message || err));
  } finally {
    slot.release();
  }

  // runPrompt never running at all — the framework's own dedupe declining a
  // job it thinks is already in flight — reads as a failure rather than as a
  // success with no answer.
  if (!failure && !result) failure = "The run did not produce an answer.";

  await finishRun(runId, {
    status: failure ? "error" : "success",
    result: failure ? null : { ...result, steps },
    error: failure,
  });
  return { agent, id: runId, status: failure ? "error" : "success" };
}
