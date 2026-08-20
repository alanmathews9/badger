// Postgres: the one pool, and the rule about when it is absent.
//
// Why here and not under app/: both the agent's tools and the web server may
// need the database, and the agent may not import from app/ — the boundary
// `npm run check:agent` enforces. Same placement logic as _rank.mjs and
// _index.mjs, and app/server re-exports in the one direction the boundary
// allows.
//
// **The database is optional by design.** With no DATABASE_URL, `pool()`
// returns null and every caller falls back: search drops to the JSON index and
// then to live federated retrieval, and history stays in the browser. That is
// not defensive habit — it is what keeps the submission's thesis true. A clone
// of this repo has to run from the CLI with nothing but a Composio key, or
// "the agent is a git repo you can clone and run" stops being a claim we can
// make. The boundary test proves the imports; this keeps the runtime honest.
//
// Connection notes, all measured against Supabase rather than assumed:
//
//   - The URL must be the **transaction pooler** (port 6543,
//     `*.pooler.supabase.com`). Supabase's direct connection is IPv6-only
//     without the paid IPv4 add-on, and Cloud Run egresses over IPv4 — so a
//     direct URL works on a laptop and fails in production, which is the worst
//     place to find out.
//   - Transaction mode does not support prepared statements. node-postgres
//     only issues them for queries given a `name`, so nothing here ever names
//     one.
//   - Cloud Run runs with --max-instances 1 and --concurrency 20, so a small
//     pool is right: more connections than concurrent requests buys nothing
//     and Supabase's free tier counts them.
import pg from "pg";
import { loadEnvFile } from "./_env.mjs";

loadEnvFile(new URL("../../.env", import.meta.url));

let cached;

/**
 * The shared pool, or null when no database is configured.
 * @returns {pg.Pool | null}
 */
export function pool() {
  if (cached !== undefined) return cached;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    cached = null;
    return cached;
  }

  cached = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    // Ten seconds, not the default of forever: a hung connect on the search
    // path must fall through to the index rather than hold the request open.
    connectionTimeoutMillis: 10_000,
    // And ten on the query itself. connectionTimeoutMillis bounds only the
    // handshake, so a pooler that accepts TCP and then never answers — the
    // shape a paused Supabase free-plan project takes — left the boot-time
    // index pull hanging forever in front of server.listen. The port never
    // opened, Cloud Run's startup probe killed the container, and the
    // revision crash-looped while live search, which needs no database at
    // all, would have worked fine.
    query_timeout: 10_000,
    // Supabase terminates TLS with a certificate chain Node does not ship a
    // root for. The alternative is bundling their root cert and pinning it;
    // this is a demo corpus of fictional data over a link that is still
    // encrypted, and the honest note is that this authenticates the channel
    // but not the server.
    ssl: { rejectUnauthorized: false },
  });

  // A pool that emits 'error' with no listener takes the process down. An
  // idle connection dropped by the pooler is routine and must not.
  cached.on("error", (err) => {
    console.warn(`[db] idle client error: ${err.message}`);
  });

  return cached;
}

/** Is a database configured at all? Callers branch on this, never on a throw. */
export function dbConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Run a query. Never give it a `name` — see the prepared-statement note above.
 * @param {string} text
 * @param {unknown[]} [values]
 */
export async function query(text, values = []) {
  const p = pool();
  if (!p) throw new Error("no DATABASE_URL configured");
  return p.query(text, values);
}

/** Close the pool so a script can exit. A no-op when none was opened. */
export async function closeDb() {
  if (cached) await cached.end();
  cached = undefined;
}
