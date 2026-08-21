// Where the agent's own repository lives while it is running, so that what it
// learns survives the instance that learned it.
//
// In the container the agent cannot commit: .dockerignore excludes .git and
// the image never installs git, so `skill_learner crystallize` writes a real
// SKILL.md, reports "crystallized and committed", and commits nothing — the
// git call sits in a bare catch and the success text is unconditional
// (dist/tools/skill-learner.js:73-86, 213). The file dies at scale-to-zero.
//
// The framework's answer is `query({ repo: { url, token, dir, session } })`,
// which clones with the token, runs the agent in that clone, and on the way
// out commits and pushes (dist/sdk.js:100-112, dist/session.js:100-125).
// OpenGAP names the resulting shape "Human-in-the-Loop for RL Agents".
//
// Three constraints shape what is below:
//
// 1. Pass a FIXED session id. Without one, session.js:71-73 mints
//    gitagent/session-<hex> per run — a branch per question on a public repo.
//    One long-lived branch instead; `main` is only ever merged by a human.
//
// 2. One private copy of the repo per run. Sharing a clone corrupts it: a
//    second run's `checkout` + `reset --hard` lands on the tree the first is
//    reading, and its closing `git add -A` commits the first's half-written
//    state. The network clone happens once at boot into a template; each run
//    copies that locally.
//
// 3. node_modules and .gitagent are not in git, and the agent needs both —
//    the tool subprocesses resolve modules by walking up from tools/scripts/,
//    and the search index is resolved relative to _index.mjs. Both are
//    symlinked back to the image, and both are gitignored so `git add -A`
//    steps over them.
//
// With no repo URL or token this returns dir mode and the server runs as it
// did before: query({ dir: ROOT }). Learning then works but does not outlive
// the instance. A missing secret must not be able to take the product down.

import { execFile, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, symlinkSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_BRANCH = "gitagent/learning";

// The identity openAgentRepo() configures on the template. Passed explicitly
// with -c on the sub-agent commit so authorship holds even in a copy whose
// config did not come across.
const AGENT_NAME = "badger";
const AGENT_EMAIL = "badger@users.noreply.github.com";

// Boot-time git. Synchronous on purpose: the clone must finish before the port
// opens, or Cloud Run sends a request into a half-copied agent.
function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
    // No terminal to prompt on in a container: fail rather than stall.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

// https://github.com/o/r → https://<token>@github.com/o/r. session.js:122
// strips it back out in finalize(), and the run directory is deleted after.
function authedUrl(url, token) {
  return url.replace(/^https:\/\//, `https://${encodeURIComponent(token)}@`);
}

/**
 * Strip credentials out of anything on its way to a log.
 *
 * The token travels in the clone URL, so it is in the command's argv and
 * execFileSync puts the whole command into `err.message`. Logging a git error
 * raw publishes a live credential — this cost one rotation already.
 *
 * Both the PAT prefixes and the generic user:password@host form, so another
 * credential shape cannot walk through the gap the first pattern leaves.
 */
export function redact(text) {
  return String(text ?? "")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_***")
    .replace(/ghp_[A-Za-z0-9]+/g, "ghp_***")
    .replace(/(https?:\/\/)[^@\/\s]+@/g, "$1***@");
}

/** Everything a failed git command can tell us, with the credential removed. */
function gitFailure(err) {
  const parts = [
    String(err?.message ?? "").split("\n")[0],
    String(err?.stderr ?? "").trim(),
    String(err?.stdout ?? "").trim(),
  ].filter(Boolean);
  return redact(parts.join(" | ")).slice(0, 600);
}

/**
 * Commit whatever a sub-agent run left behind, so the push path below can
 * carry it. A sub-agent runs under `dir:` rather than `repo:`, so the runtime
 * does no git at all and its memory entry or crystallised skill would die with
 * the run copy.
 *
 * The message is fixed and names the slug. No model-written text reaches git's
 * argv. Never throws: a failure warns and the caller falls through to the
 * existing push path rather than taking the answer down.
 *
 * @returns {Promise<boolean>} whether a commit was made
 */
export async function commitAgentWrites(dir, slug) {
  const name = String(slug ?? "").replace(/[^a-z0-9-]/gi, "") || "unknown";
  return commitTree(dir, `agent: ${name} learning from a run`, `what agent ${name} wrote`);
}

/**
 * Stage and commit everything in a working tree.
 *
 * `message` is composed by this module from a fixed vocabulary — no caller
 * text and no model text reaches git's argv. Never throws: recording a change
 * failing must not take down the thing that made it.
 *
 * @returns {Promise<boolean>} whether a commit was made
 */
async function commitTree(dir, message, describing) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: dir, env });
    if (!stdout.trim()) return false;
    await execFileAsync("git", ["add", "-A"], { cwd: dir, env });
    await execFileAsync(
      "git",
      ["-c", `user.name=${AGENT_NAME}`, "-c", `user.email=${AGENT_EMAIL}`, "commit", "-m", message],
      { cwd: dir, env }
    );
    return true;
  } catch (err) {
    console.warn(`[agent-repo] could not commit ${describing}: ${gitFailure(err)}`);
    return false;
  }
}

/**
 * Push the branch, reconciling only if something else got there first.
 *
 * PUSH FIRST, pull on rejection — not the other way round. Pulling first looks
 * more careful and is wrong in the case that matters: on the very first save
 * the branch does not exist on the remote yet, `git pull origin <branch>` dies
 * with "couldn't find remote ref", and the push never happens at all. A test
 * against a real bare remote is what found that. Pushing first also spends no
 * round trip in the ordinary case, where nothing else has landed.
 *
 * Three attempts, because the failure that retrying wins is a race between two
 * runs pushing the same branch. A real conflict is not retryable and is left
 * to the caller — auto-resolving would invent content nobody wrote.
 *
 * **`rebase` is per caller and is not a preference.** A RUN COPY holds only
 * its own new commits on top of origin, so replaying them is safe and keeps
 * the branch linear. The TEMPLATE also holds main's commits, arriving through
 * the boot merge — rebasing there gives them new hashes, the same commit then
 * exists twice, and every later boot merge conflicts in files the branch never
 * touched. That cost a force-push and a rebuilt branch once already; see
 * `sync()` below, which merges for the same reason.
 *
 * The credential goes in for the push and comes back out in `finally`, so a
 * long-lived directory never keeps it.
 */
async function pushBranch(dir, url, token, branch, { rebase }) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const reconcile = rebase
    ? ["pull", "--rebase", "origin", branch]
    : ["pull", "--no-rebase", "--no-edit", "origin", branch];
  try {
    await execFileAsync("git", ["remote", "set-url", "origin", authedUrl(url, token)], { cwd: dir, env });
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await execFileAsync("git", ["push", "origin", branch], { cwd: dir, env });
        return;
      } catch (rejected) {
        if (attempt === 3) throw rejected;
        try {
          await execFileAsync("git", reconcile, { cwd: dir, env });
        } catch (conflict) {
          // Leave no half-finished merge or rebase behind, and report the
          // reconciliation failure rather than the push rejection — the
          // conflict is the thing a person has to resolve.
          await execFileAsync("git", ["rebase", "--abort"], { cwd: dir, env }).catch(() => {});
          await execFileAsync("git", ["merge", "--abort"], { cwd: dir, env }).catch(() => {});
          throw conflict;
        }
      }
    }
  } finally {
    await execFileAsync("git", ["remote", "set-url", "origin", url], { cwd: dir, env }).catch(() => {});
  }
}

// node_modules and .gitagent are not in git, so a fresh copy of the repo has
// neither. Link rather than copy: node_modules is ~460MB and the index is the
// one the whole container shares.
function linkRuntimeDirs(dir, root) {
  // Keep git's hands off the two links, in the clone itself rather than only
  // in the tracked .gitignore. This is the second half of a bug that cost a
  // test run to find: .gitignore said `node_modules/`, a trailing slash means
  // "directory", a symlink is not a directory, and so finalize()'s `git add -A`
  // committed both links onto the learning branch — after which every later
  // pull failed with "untracked working tree files would be overwritten", the
  // learning branch stopped advancing, and each run's push was rejected
  // non-fast-forward. .gitignore is fixed too; this line is what protects a
  // copy whose branch still carries the old one.
  try {
    const exclude = join(dir, ".git", "info", "exclude");
    const have = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
    const missing = ["node_modules", ".gitagent"].filter(
      (n) => !have.split(/\r?\n/).includes(n)
    );
    if (missing.length) appendFileSync(exclude, `\n${missing.join("\n")}\n`, "utf8");
  } catch {
    // No .git yet, or read-only — the tracked .gitignore is the other half.
  }

  for (const name of ["node_modules", ".gitagent"]) {
    const target = join(root, name);
    const link = join(dir, name);
    if (!existsSync(target) || existsSync(link)) continue;
    try {
      symlinkSync(target, link, "dir");
    } catch {
      // Not fatal: without node_modules the tool subprocesses fail loudly,
      // without .gitagent the search tools fall back to live queries.
    }
  }
}

/**
 * Decide once, at boot, whether this process can run the agent from a git
 * clone. Never throws: every failure path returns dir mode.
 */
export function openAgentRepo(root) {
  const url = process.env.BADGER_AGENT_REPO_URL;
  // Deliberately NOT falling back to GITHUB_TOKEN, though sdk.js:101 would.
  // This token writes to the agent's OWN repository and must reach nothing
  // else; a separate name keeps it from being confused with a source
  // credential, which Badger does not hold at all.
  const token = process.env.BADGER_AGENT_REPO_TOKEN;
  const branch = process.env.BADGER_LEARNING_BRANCH || DEFAULT_BRANCH;

  const dirMode = {
    mode: "dir",
    // What the Skills screen lists and what skill-match reads. In dir mode
    // that is the image itself, exactly as before.
    agentDir: root,
    branch: null,
    // The options the server spreads into query(). In dir mode, one key.
    queryTarget: async () => ({ dir: root, release: async () => {} }),
    sync: async () => {},
    // Nothing to do: in dir mode an edit lands in the real working tree, and
    // committing it is a person's job the way every other change here is.
    saveEdit: async () => false,
  };

  if (!url || !token) {
    if (url && !token) {
      console.warn(
        "[agent-repo] BADGER_AGENT_REPO_URL is set but no token — " +
          "running from the image. Learned skills will not outlive this instance."
      );
    }
    return dirMode;
  }

  const template = process.env.BADGER_AGENT_DIR || join(tmpdir(), "badger-agent");
  try {
    if (!existsSync(template)) {
      // A FULL clone. With --depth 1 there is no common ancestor between the
      // learning branch and main, so the boot merge below dies on "refusing to
      // merge unrelated histories" and the agent stops seeing main. ~9MB and
      // ~1.4s, once per container start.
      git(["clone", authedUrl(url, token), template]);
    }
    // Strip the token back out of the stored remote, so the long-lived
    // directory never holds a credential.
    git(["remote", "set-url", "origin", url], template);
    git(["config", "user.email", "badger@users.noreply.github.com"], template);
    git(["config", "user.name", "badger"], template);

    // The learning branch must exist locally before the first run.
    // session.js:57-63 tries `checkout <session>` then `checkout -b <session>
    // origin/<session>` and has no third fallback, so if the branch exists in
    // neither place query() throws and every question fails.
    try {
      git(["rev-parse", "--verify", "--quiet", branch], template);
    } catch {
      try {
        // Already on the remote from a previous deploy — track it.
        git(["fetch", "origin", `${branch}:${branch}`], template);
      } catch {
        // Genuinely new. Branch off whatever the clone came down on, and let
        // the first run's finalize() push it.
        git(["branch", branch], template);
      }
    }
    // And check it out. Every run is copied from the template, so the branch
    // it sits on is where each copy's ref points. Left on main, run 2 starts
    // from a stale ref and its push is rejected non-fast-forward.
    git(["checkout", branch], template);

    // Bring the template up to date with its OWN branch first: boot fetched
    // only the default branch, so a skill the agent pushed would be on GitHub
    // and invisible here.
    //
    // Fast-forward when possible, else rebase — the template may hold local
    // commits (a skill added through the UI) that a reset would discard.
    try {
      git(["fetch", "origin", branch], template);
      try {
        git(["merge", "--ff-only", `origin/${branch}`], template);
      } catch {
        // Merge, never rebase. See sync() below for what rebasing cost.
        git(["merge", "--no-edit", `origin/${branch}`], template);
      }
    } catch (err) {
      // The branch may not exist on the remote yet, which is the ordinary
      // first-run case and not worth a warning.
      void err;
    }

    // Bring the default branch INTO the learning branch, every boot. The
    // runtime pulls only the session branch (session.js:64-68), so without
    // this the agent never sees main again and no deploy can reach it.
    //
    // A conflict needs a person: abort and keep running on the branch as it
    // stands, loudly. A stale agent is bad, a half-merged one is worse.
    try {
      const defaultBranch = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], template)
        .replace(/^origin\//, "");
      git(["fetch", "origin", defaultBranch], template);
      const behind = git(["rev-list", "--count", `HEAD..origin/${defaultBranch}`], template);
      if (behind !== "0") {
        git(["merge", "--no-edit", `origin/${defaultBranch}`], template);
        console.log(`[agent-repo] merged ${behind} commit(s) from ${defaultBranch} into ${branch}`);
      }
    } catch (err) {
      try {
        git(["merge", "--abort"], template);
      } catch {
        /* nothing to abort */
      }
      console.warn(
        `[agent-repo] could NOT merge the default branch into ${branch} — the agent is ` +
          "running on the learning branch as it stands and will not pick up changes to " +
          `main until this is resolved by hand: ${gitFailure(err)}`
      );
    }

    linkRuntimeDirs(template, root);
  } catch (err) {
    console.warn(
      `[agent-repo] could not prepare the agent clone — running from the image. ` +
        `Learned skills will not outlive this instance. Cause: ${gitFailure(err)}`
    );
    return dirMode;
  }

  console.log(`[agent-repo] agent runs from ${template} on branch ${branch}`);

  return {
    mode: "repo",
    agentDir: template,
    branch,

    /**
     * One private copy of the repo for one run. The copy is local and cheap;
     * the network work (fetch, checkout, pull, and the closing commit+push)
     * is the runtime's, inside query().
     *
     * `agentSlug` names a sub-agent run, whose writes release() has to commit
     * itself. Omitted for the Badger path, where the runtime commits.
     */
    async queryTarget(agentSlug) {
      const dir = join(tmpdir(), `badger-run-${randomBytes(4).toString("hex")}`);
      try {
        await mkdir(dir, { recursive: true });
        // Async because this is on the request path and would stall the other
        // concurrent answers. dereference:false so the node_modules and
        // .gitagent symlinks stay links rather than 460MB of files.
        await cp(template, dir, { recursive: true, dereference: false, force: true });
        linkRuntimeDirs(dir, root);
      } catch (err) {
        console.warn(`[agent-repo] run copy failed (${redact(err.message)}) — this run uses the image.`);
        await rm(dir, { recursive: true, force: true }).catch(() => {});
        return { dir: root, release: async () => {} };
      }
      return {
        // Passing `session` is what keeps this to one branch instead of one
        // per question. Passing `dir` at a path that already exists is what
        // keeps it to a fetch instead of a clone.
        repo: { url, token, dir, session: branch },

        // Reconcile, then delete. Two concurrent answers commit to the same
        // branch from the same base, so the second push is rejected
        // non-fast-forward — and sdk.js:473-477 swallows that in a bare catch.
        // So before deleting the copy, check for commits the remote lacks and
        // rebase-and-push them; warn if that still fails.
        release: async () => {
          if (agentSlug) await commitAgentWrites(dir, agentSlug);
          try {
            const { stdout } = await execFileAsync(
              "git",
              ["log", "--oneline", `origin/${branch}..HEAD`],
              { cwd: dir, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }
            );
            if (stdout.trim()) {
              // finalize() stripped the credential (session.js:122); pushBranch
              // puts it back for the push and takes it out again. Rebasing is
              // safe here and only here — see the note on pushBranch.
              await pushBranch(dir, url, token, branch, { rebase: true });
              console.log(
                `[agent-repo] recovered ${stdout.trim().split("\n").length} learning ` +
                  "commit(s) that lost a concurrent push"
              );
            }
          } catch (err) {
            // origin/<branch> not existing yet is the first-run case.
            const msg = String(err.stderr || err.message || "");
            if (!msg.includes("unknown revision") && !msg.includes("bad revision")) {
              console.warn(`[agent-repo] a learning commit could not be pushed: ${redact(msg).split("\n")[0]}`);
            }
          }
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        },
      };
    },

    /**
     * Commit and push a change the PRODUCT just made — an agent or a skill
     * created, edited or deleted through the UI.
     *
     * Without this the change is an untracked file in a clone under `tmpdir()`
     * and lives exactly as long as the container. Cloud Run runs
     * `--max-instances 1` with no `min-instances`, so it scales to zero after a
     * few quiet minutes: create an agent, come back later, and it is gone. That
     * was measured, not feared.
     *
     * **Not `initLocalSession`**, though the runtime exports it and it is the
     * framework's own git mechanism. Its update path is
     * `checkout <default> && reset --hard origin/<default>` (session.js:41-45),
     * written for starting a run from a clean tree — pointed at this directory
     * it would discard the very edit being saved. Its first-run path is
     * `clone --depth 1`, which is the shallow clone that breaks the boot merge.
     * So this uses the same SHAPE the framework uses — add -A, commit on the
     * session branch, push — through the reconciliation this file already
     * needs for concurrent runs.
     *
     * Best effort. The file is written either way, so a push that fails warns
     * and leaves the product working for this instance rather than failing the
     * request.
     *
     * @param {"agent"|"skill"|"schedule"} what
     * @param {"create"|"update"|"delete"} action
     * @param {string} slug
     */
    async saveEdit(what, action, slug) {
      const name = String(slug ?? "").replace(/[^a-z0-9-]/gi, "") || "unknown";
      // A fixed vocabulary, not the caller's string: the message is written
      // into a public repository by a web request, so what a route passes is
      // mapped onto one of these rather than interpolated.
      const kind = ["agent", "schedule"].includes(what) ? what : "skill";
      const verb = ["create", "update", "delete"].includes(action) ? action : "change";
      const message = `ui: ${verb} ${kind} ${name}`;
      if (!(await commitTree(template, message, `the ${kind} just ${verb}d`))) return false;
      try {
        await pushBranch(template, url, token, branch, { rebase: false });
        return true;
      } catch (err) {
        console.warn(`[agent-repo] ${message} is committed but not pushed: ${gitFailure(err)}`);
        return false;
      }
    },

    /**
     * Bring the template up to date with what the last run pushed, so the
     * Skills screen shows learned skills too. `pull --rebase` not `reset
     * --hard`: a skill or agent added through the UI is a commit here — see
     * `saveEdit` — and a reset would discard it if the push had not landed.
     * Best-effort; a failure leaves a stale list and nothing else.
     */
    async sync() {
      try {
        // `--no-rebase`, and the flag is the whole point of this comment.
        //
        // This was `--rebase`, which rewrites whatever the template holds on
        // top of the remote branch. What it held was main's commits, arriving
        // through the boot merge — so rebasing gave them new object ids. The
        // same commit then existed twice, once on main and once here with a
        // different hash, and from that moment the two branches shared an
        // ancestor ten commits back. Every later boot merge failed with a
        // conflict in a file the branch had never touched, and the agent
        // stopped seeing changes to main entirely. Merging keeps both
        // histories intact and the merge base where it belongs.
        await execFileAsync("git", ["pull", "--no-rebase", "--no-edit", "origin", branch], {
          cwd: template,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        });
      } catch {
        // The branch does not exist on the remote until the first run pushes
        // it, so this is expected to fail once and then stop failing.
      }
    },
  };
}
