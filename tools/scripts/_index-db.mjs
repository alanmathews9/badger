// The index's durable home: push it to Postgres, pull it back.
//
// **Why this is a separate module from _index.mjs.** `_index.mjs` is imported
// by `_index-tool.mjs`, which runs inside every agent tool subprocess — a
// process that lives for milliseconds. Importing `pg` there would load a
// database driver on every single tool call to reach a database the tool never
// queries. So the driver stays here, and only two callers import it: the
// builder, and the server at boot.
//
// **What this is not: a search path.** A warm Postgres round trip measured
// 220ms from a laptop and would be perhaps 30ms from Cloud Run; the in-process
// searcher answers in 3ms. Postgres is therefore never on the search path. It
// exists so the copy survives a container dying, which today costs the next
// visitor a 5.4s live search plus a 40-second, 173-call rebuild. Pulling it
// back is one query.
//
// The JSON file keeps its job and loses its rank: it was the source of truth
// and is now a derived cache, regenerated from here at boot. Both readers —
// the server's in-memory searcher and the agent's tool subprocesses — go on
// reading it exactly as before.
import { pool, dbConfigured } from "./_db.mjs";

export { dbConfigured };

/** Insert in chunks: one statement per document is 178 round trips, and one
 *  statement for all of them is a parameter list nobody wants to debug. */
const CHUNK = 40;

/**
 * Replace the stored index with this one, inside a transaction.
 *
 * Replace rather than merge, even for an incremental refresh: the builder has
 * already merged, so its doc set IS the index, and writing exactly that cannot
 * drift from what the JSON file holds. Readers see the old set until commit —
 * there is no window where the corpus looks empty.
 *
 * @param {object} index  the same object saveIndex() writes
 * @returns {Promise<{docs: number, runId: number}>}
 */
export async function pushIndex(index) {
  const client = await pool().connect();
  try {
    await client.query("begin");

    const { rows: run } = await client.query(
      "insert into index_run (started_at) values (now()) returning id",
    );
    const runId = run[0].id;

    await client.query("delete from document");

    const docs = index.docs ?? [];
    for (let i = 0; i < docs.length; i += CHUNK) {
      const slice = docs.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      slice.forEach((doc, n) => {
        const b = n * 9;
        values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`);
        params.push(
          doc.id,
          doc.source,
          doc.type,
          doc.title ?? "",
          doc.body ?? "",
          doc.author ?? null,
          // Day-precision ISO strings in the index; an empty one is null
          // rather than an epoch date that would sort as 1970.
          doc.date || null,
          doc.url ?? null,
          JSON.stringify(doc.meta ?? {}),
        );
      });
      await client.query(
        `insert into document (id, source, type, title, body, author, doc_date, url, meta)
         values ${values.join(",")}`,
        params,
      );
    }

    // Everything about the index except its documents, so a pull reconstructs
    // the exact object the searcher expects.
    const { docs: _docs, ...header } = index;
    await client.query(
      `update index_run
          set finished_at = now(), doc_count = $2, ok = true, meta = $3
        where id = $1`,
      [runId, docs.length, JSON.stringify(header)],
    );

    await client.query("commit");
    return { docs: docs.length, runId };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Read the stored index back, or null when there is nothing usable.
 *
 * Null covers every "there is no durable copy" case — no database configured,
 * no successful run, no documents — because the caller's response to all of
 * them is identical: carry on with whatever the disk holds, and fall back to
 * live if that is missing too.
 */
export async function pullIndex() {
  if (!dbConfigured()) return null;
  const db = pool();
  if (!db) return null;

  const { rows: runs } = await db.query(
    "select meta from index_run where ok and meta is not null order by finished_at desc limit 1",
  );
  if (!runs.length) return null;

  const { rows } = await db.query(
    `select id, source, type, title, body, author,
            to_char(doc_date, 'YYYY-MM-DD') as date, url, meta
       from document`,
  );
  if (!rows.length) return null;

  return {
    ...runs[0].meta,
    docs: rows.map((r) => ({
      id: r.id,
      source: r.source,
      type: r.type,
      title: r.title,
      body: r.body,
      author: r.author ?? "",
      date: r.date ?? "",
      url: r.url ?? "",
      meta: r.meta ?? {},
      // Reserved for embeddings, and still unused — see the note in
      // _index.mjs. Restored as null so a pulled doc and a crawled doc are
      // the same shape.
      vector: null,
    })),
  };
}
