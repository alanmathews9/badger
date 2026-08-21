// Conversations and past searches, stored in Postgres.
//
// Everything here is keyed on the session cookie's uid, which is a random
// per-browser string with no account behind it. So this is per-browser
// history, not per-person history, and `persisted: false` from a server with
// no database is a first-class answer rather than an error — the client falls
// back to localStorage and the product keeps working.
//
// **The client's shape is the contract, not the table's.** Chat is written in
// turns — a question and everything its run produced — while the table stores
// messages, which is Onyx's shape and the one that survives contact with any
// future feature. The translation lives here, in one place, rather than being
// half-done at both ends.
import { query, pool, dbConfigured } from "../../tools/scripts/_db.mjs";

export { dbConfigured };

/**
 * This browser's conversations, newest first. Titles only — no turns.
 *
 * `agent` partitions the list rather than filtering it: a null agent is a
 * thread in /chat and a slug is a thread in that agent's Playground, and
 * neither list should ever show the other's.
 */
export async function listChats(uid, { agent = null, limit = 20 } = {}) {
  const { rows } = await query(
    `select id, title, agent, extract(epoch from updated_at) * 1000 as updated_at
       from chat_session
      where uid = $1 and not deleted
        and agent is not distinct from $2
      order by updated_at desc
      limit $3`,
    [uid, agent, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    agent: r.agent,
    updatedAt: Number(r.updated_at),
  }));
}

/**
 * One conversation, rebuilt into the turns the client renders.
 *
 * Scoped by uid as well as id: a conversation id is short and guessable, so
 * without this a changed digit would hand you someone else's conversation.
 * A miss and a not-yours are the same answer on purpose — null — because
 * distinguishing them tells a prober which ids exist.
 */
export async function getChat(uid, id) {
  const { rows: sessions } = await query(
    `select id, title, agent, extract(epoch from updated_at) * 1000 as updated_at
       from chat_session
      where id = $1 and uid = $2 and not deleted`,
    [id, uid],
  );
  if (!sessions.length) return null;

  const { rows: messages } = await query(
    `select role, body, steps, result, error
       from chat_message
      where session_id = $1
      order by id`,
    [id],
  );

  // Messages come back in pairs — a question, then what the run produced. An
  // assistant row with no user row before it cannot happen through saveChat,
  // and is skipped rather than rendered as a turn with no question.
  const turns = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({
        question: message.body,
        answer: {
          running: false,
          activity: null,
          steps: [],
          text: "",
          result: null,
          error: null,
        },
      });
      continue;
    }
    const turn = turns.at(-1);
    if (!turn) continue;
    turn.answer = {
      running: false,
      activity: null,
      steps: message.steps ?? [],
      text: message.body,
      result: message.result ?? null,
      error: message.error,
    };
  }

  return {
    id: sessions[0].id,
    title: sessions[0].title,
    agent: sessions[0].agent,
    updatedAt: Number(sessions[0].updated_at),
    turns,
  };
}

/**
 * Follow a renamed sub-agent.
 *
 * An agent's folder is its identity, so renaming one moves it — and every
 * Playground conversation filed under the old slug would otherwise be
 * unreachable: still in the table, listed by no page.
 */
export async function renameAgentChats(from, to) {
  await query("update chat_session set agent = $2 where agent = $1", [from, to]);
}

/**
 * Write a conversation, replacing whatever was there.
 *
 * Delete-then-insert rather than a diff. A conversation is a handful of
 * messages that only ever grows at the end, and computing which ones are new
 * would be more code than rewriting them, with more ways to be subtly wrong.
 * The whole thing is one transaction, so a failure leaves the previous version
 * intact rather than a half-written conversation.
 */
export async function saveChat(uid, id, { title, turns, agent = null }) {
  const client = await pool().connect();
  try {
    await client.query("begin");

    // The uid is in the insert AND in the update's where clause, so a request
    // naming someone else's conversation id writes nothing rather than
    // overwriting theirs.
    //
    // `agent` is set on insert and never updated. Which agent answered a
    // conversation is fixed when it starts, the way Onyx's
    // update_chat_session() refuses to move a session's persona.
    const { rowCount } = await client.query(
      `insert into chat_session (id, uid, title, agent, updated_at)
            values ($1, $2, $3, $4, now())
       on conflict (id) do update
               set title = excluded.title, updated_at = now()
             where chat_session.uid = $2`,
      [id, uid, title, agent],
    );
    if (!rowCount) {
      await client.query("rollback");
      return false;
    }

    await client.query("delete from chat_message where session_id = $1", [id]);

    for (const turn of turns) {
      await client.query(
        "insert into chat_message (session_id, role, body) values ($1, 'user', $2)",
        [id, turn.question],
      );
      const answer = turn.answer ?? {};
      await client.query(
        `insert into chat_message (session_id, role, body, steps, result, error)
              values ($1, 'assistant', $2, $3, $4, $5)`,
        [
          id,
          answer.result?.answer ?? answer.text ?? "",
          JSON.stringify(answer.steps ?? []),
          answer.result ? JSON.stringify(answer.result) : null,
          answer.error ?? null,
        ],
      );
    }

    await client.query("commit");
    return true;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/** This browser's recent searches, newest first, one row per distinct query. */
export async function listSearches(uid, limit = 8) {
  const { rows } = await query(
    `select distinct on (lower(query)) query, extract(epoch from created_at) * 1000 as at
       from search_query
      where uid = $1
      order by lower(query), created_at desc`,
    [uid],
  );
  return rows
    .map((r) => ({ query: r.query, at: Number(r.at) }))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

/**
 * Record a search. The query and the facts already on screen — never the
 * results, because re-running is both cheaper and fresher than a replay.
 * That is Onyx's rule, stated in their own search_query table.
 */
export async function recordSearch(uid, { query: text, resultCount, path, tookMs, apiCalls }) {
  await query(
    `insert into search_query (uid, query, result_count, path, took_ms, api_calls)
          values ($1, $2, $3, $4, $5, $6)`,
    [uid, text, resultCount ?? null, path ?? null, tookMs ?? null, apiCalls ?? null],
  );
}
