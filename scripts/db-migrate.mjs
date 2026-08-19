// Apply the SQL files in migrations/, in name order, exactly once each.
//
//     npm run db:migrate            apply anything outstanding
//     npm run db:migrate -- --status  say what is applied and what is not
//
// No ORM and no migration framework. Five tables do not need one, and a
// dependency whose whole job is running SQL files in order is a dependency
// whose behaviour you then have to learn instead of read.
//
// Two properties worth stating because they are the ones that matter when a
// migration goes wrong at 2am:
//
//   Each file runs inside a transaction, together with the row that records
//   it. A file that fails leaves nothing behind — not half a schema, and not
//   a ledger claiming it succeeded.
//
//   Files are named <timestamp>_<slug>.sql and applied in lexical order,
//   which for that format is chronological order. The name is the key, so
//   renaming an applied migration makes it run again — don't.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { pool, closeDb } from "../tools/scripts/_db.mjs";

const DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

function migrationFiles() {
  return readdirSync(DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

async function applied(client) {
  await client.query(`
    create table if not exists schema_migration (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const { rows } = await client.query("select name from schema_migration");
  return new Set(rows.map((r) => r.name));
}

async function main() {
  const db = pool();
  if (!db) {
    console.error(
      "DATABASE_URL is not set.\n" +
        "Add the Supabase TRANSACTION POOLER string (port 6543) to .env —\n" +
        "the direct connection is IPv6-only and will fail on Cloud Run.",
    );
    process.exit(1);
  }

  const statusOnly = process.argv.includes("--status");
  const client = await db.connect();

  try {
    const done = await applied(client);
    const files = migrationFiles();
    const pending = files.filter((name) => !done.has(name));

    if (statusOnly) {
      for (const name of files) console.log(`${done.has(name) ? "applied" : "PENDING"}  ${name}`);
      if (!files.length) console.log("no migrations on disk");
      return;
    }

    if (!pending.length) {
      console.log(`nothing to do — ${files.length} migration(s) already applied`);
      return;
    }

    for (const name of pending) {
      const sql = readFileSync(join(DIR, name), "utf8");
      process.stdout.write(`applying ${name} … `);
      // The migration and its ledger entry commit together, or neither does.
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migration (name) values ($1)", [name]);
        await client.query("commit");
        console.log("ok");
      } catch (err) {
        await client.query("rollback");
        console.log("failed");
        throw err;
      }
    }
    console.log(`${pending.length} migration(s) applied`);
  } finally {
    client.release();
    await closeDb();
  }
}

main().catch((err) => {
  console.error(`\nmigration failed: ${err.message}`);
  process.exit(1);
});
