// Postgres: the one pool, and the rule about when it is absent.
//
// Here rather than under app/ because both the agent's tools and the web
// server may need it, and the agent may not import from app/.
//
// The database is OPTIONAL. With no DATABASE_URL, `pool()` returns null and
// every caller falls back: search drops to the JSON index and then to live
// retrieval, history stays in the browser. A clone of this repo has to run
// from the CLI with nothing but a Composio key.
//
// Connection notes, measured against Supabase:
//
//   - The URL must be the transaction pooler (port 6543). The direct
//     connection is IPv6-only without the paid add-on and Cloud Run egresses
//     over IPv4, so a direct URL works locally and fails in production.
//   - Transaction mode does not support prepared statements. node-postgres
//     issues them only for queries given a `name`, so nothing here names one.
//   - --max-instances 1 and --concurrency 20, so a small pool is right.
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
    // Not the default of forever: a hung connect must fall through to the
    // index rather than hold the request open.
    connectionTimeoutMillis: 10_000,
    // connectionTimeoutMillis bounds only the handshake, so a pooler that
    // accepts TCP and never answers — a paused Supabase project — hangs the
    // boot-time index pull in front of server.listen and crash-loops the
    // revision.
    query_timeout: 10_000,
    // Supabase's chain has no root Node ships. This encrypts the channel but
    // does not authenticate the server; pinning their root cert is the fix if
    // the data ever stops being fictional.
    ssl: { rejectUnauthorized: false },
  });

  // A pool emitting 'error' with no listener takes the process down, and an
  // idle connection dropped by the pooler is routine.
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
