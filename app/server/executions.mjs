// What a scheduled run produced, in Postgres.
//
// The framework writes its own JSONL log under `.gitagent/schedule-logs/`
// during `executeScheduledJob`. That directory is gitignored and lives in a
// clone under tmpdir() that the instance throws away, so it is incidental.
// This table is the durable record and the only thing the UI reads.
//
// Deliberately separate from history.mjs. That file is per-browser
// conversation history keyed on the session cookie; this is per-agent output
// with no browser behind it, and mixing the two would put a uid on rows that
// have no user.
import { query, dbConfigured } from "../../tools/scripts/_db.mjs";

/** How much of a failure message is worth keeping. */
const MAX_ERROR = 2000;

/**
 * Open a run. Returns its id, or null when there is no database.
 *
 * The row is written BEFORE the agent is asked anything, with status
 * 'running'. So a run that dies with the instance — the ordinary Cloud Run
 * case, since it recycles after a few minutes of quiet — is visible as one
 * that never finished, rather than as one that never happened.
 *
 * `trigger` is "schedule" or "manual", and both go in the same list. See the
 * migration for why that is one list rather than two.
 */
export async function startRun(agent, scheduleId, input, triggeredAt = new Date(), trigger = "schedule") {
  if (!dbConfigured()) return null;
  const { rows } = await query(
    `insert into schedule_run (agent, schedule_id, triggered_at, status, input, trigger_source)
          values ($1, $2, $3, 'running', $4, $5)
       returning id`,
    [agent, scheduleId, triggeredAt.toISOString(), input, trigger === "manual" ? "manual" : "schedule"],
  );
  return String(rows[0].id);
}

/** Close it, with whatever came back. */
export async function finishRun(id, { status, result = null, error = null }) {
  if (!id || !dbConfigured()) return;
  await query(
    `update schedule_run
        set status = $2, finished_at = now(), result = $3, error = $4
      where id = $1`,
    [id, status, result ? JSON.stringify(result) : null, error ? String(error).slice(0, MAX_ERROR) : null],
  );
}

/**
 * One agent's runs, newest first. Summaries only — the answer body is the
 * expensive column and the table does not show it.
 */
export async function listRuns(agent, limit = 50) {
  if (!dbConfigured()) return [];
  const { rows } = await query(
    `select id, agent, schedule_id, status, error, trigger_source,
            extract(epoch from triggered_at) * 1000 as triggered_at,
            extract(epoch from finished_at) * 1000 as finished_at,
            left(input, 300) as input,
            result -> 'answer' as answer
       from schedule_run
      where agent = $1
      order by triggered_at desc
      limit $2`,
    [agent, limit],
  );
  return rows.map(summarise);
}

/**
 * One run in full.
 *
 * Scoped by agent as well as id, so a row cannot be read through the wrong
 * agent's page — the id is a plain sequence and the next one along belongs to
 * somebody else's schedule.
 */
export async function readRun(agent, id) {
  if (!dbConfigured()) return null;
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await query(
    `select id, agent, schedule_id, status, input, result, error, trigger_source,
            extract(epoch from triggered_at) * 1000 as triggered_at,
            extract(epoch from finished_at) * 1000 as finished_at
       from schedule_run
      where id = $1 and agent = $2`,
    [id, agent],
  );
  if (!rows.length) return null;
  return { ...summarise(rows[0]), result: rows[0].result ?? null };
}

/**
 * Follow a renamed agent, the way renameAgentChats does.
 *
 * The schedule YAML travels with the folder when an agent is renamed, so
 * without this its history would stay filed under a slug no page asks for.
 */
export async function renameAgentRuns(from, to) {
  if (!dbConfigured()) return;
  await query("update schedule_run set agent = $2 where agent = $1", [from, to]);
}

function summarise(row) {
  return {
    id: String(row.id),
    agent: row.agent,
    scheduleId: row.schedule_id,
    status: row.status,
    trigger: row.trigger_source,
    triggeredAt: Number(row.triggered_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
    input: row.input,
    // Present on a listing (a truncated answer for the row) and absent on a
    // full read, where `result` carries it.
    ...(row.answer === undefined ? {} : { answer: row.answer }),
    error: row.error ?? null,
  };
}
