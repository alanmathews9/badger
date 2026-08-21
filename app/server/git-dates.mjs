// When each entry under a directory was last committed.
//
// From git, not from a file's mtime. In repo mode the agent runs out of a
// fresh clone made per run, so every mtime is the clone's — one identical
// timestamp on every row, which is worse than no date at all. Git is the only
// place the real date survives, and it is also the interesting one: for a
// skill or an agent the last commit is when it last actually changed.
import { execFileSync } from "node:child_process";

/**
 * Last commit date per immediate child of `<repoDir>/<prefix>/`, ISO 8601.
 *
 * One `git log` for the whole directory rather than one per entry, and a
 * failure is an empty map rather than a throw — a tree with no history, or a
 * host with no git, must still list what is on disk.
 *
 * @returns {Record<string, string>} slug → ISO date
 */
export function lastCommitDates(repoDir, prefix) {
  const dates = {};
  let out;
  try {
    out = execFileSync(
      "git",
      ["-C", repoDir, "log", "--pretty=format:%cI", "--name-only", "--", `${prefix}/`],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return dates;
  }

  // Newest commit first, so the FIRST time a path appears is its last change.
  const path = new RegExp(`^${prefix}/([^/]+)/`);
  let at = "";
  for (const line of out.split("\n")) {
    if (/^\d{4}-\d{2}-\d{2}T/.test(line)) {
      at = line.trim();
      continue;
    }
    const match = line.match(path);
    if (match && at && !dates[match[1]]) dates[match[1]] = at;
  }
  return dates;
}
