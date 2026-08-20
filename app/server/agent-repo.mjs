// Where the agent's own repository lives while it is running, so that what it
// learns survives the instance that learned it.
//
// The problem this solves. GAP's thesis is that the agent IS a git repo and
// that its learned skills and self-written memory are commits you can read.
// That is true when Badger runs from a clone on a laptop. It is NOT true in
// the container: .dockerignore excludes .git, the image never installs git,
// and so `skill_learner crystallize` writes a real SKILL.md, reports
// "crystallized and committed", and commits nothing — the git call is wrapped
// in a bare catch and the success text is unconditional
// (dist/tools/skill-learner.js:73-86, 213). The file is real while the
// instance is warm and gone at scale-to-zero. Production learned and forgot.
//
// The framework has a first-class answer and it is not a workaround we
// invented: `query({ repo: { url, token, dir, session } })` clones the repo
// with the token, runs the agent inside that clone, and on the way out calls
// commitChanges() + push() (dist/sdk.js:100-112, dist/session.js:100-125).
// OpenGAP's README names the resulting shape as one of its architectural
// patterns — "Human-in-the-Loop for RL Agents: when an agent learns a new
// skill or writes to memory, it opens a branch + PR for human review before
// merging". This module is that pattern, wired up.
//
// ── The three things that had to be solved ────────────────────────────────
//
// 1. A branch per question. With no `session` passed, session.js:71-73 mints
//    gitagent/session-<hex> and pushes it — one branch per question on a
//    public repo. Passing a FIXED session id instead makes it one long-lived
//    branch that every run checks out, pulls and appends to. `main` is never
//    touched by the agent; a human merges the branch, which is the review gate
//    the pattern is named for.
//
// 2. Concurrent runs cannot share one clone. This is not theoretical: with a
//    shared dir, a second run entering initLocalSession does `checkout
//    <default>` and `reset --hard` on the working tree that the first run is
//    reading files out of, and its closing `git add -A` would commit whatever
//    the first run had half-written. So each run gets its own copy. The copy
//    is local — the network clone happens once at boot into a template — and
//    initLocalSession takes its "directory already exists" branch, which is a
//    fetch and a pull rather than a clone.
//
// 3. The clone is not the image. Two things the agent needs are deliberately
//    NOT in git and therefore not in the copy: node_modules, which the
//    declarative tools' node subprocesses resolve by walking up from
//    tools/scripts/, and .gitagent/, which holds the search index that
//    tools/scripts/_index.mjs resolves relative to its own module URL. Both
//    are symlinked back to the image. Both are gitignored, so `git add -A`
//    steps over them rather than trying to commit a symlink.
//
// ── The fallback matters as much as the feature ───────────────────────────
//
// With no repo URL or no token this module returns dir mode and the server
// behaves exactly as it did before: query({ dir: ROOT }). A missing secret
// must never be able to take the product down, and a clone that fails at boot
// degrades to the same place with a warning. Learning still works in that
// mode — it just does not outlive the instance, which is the honest status
// quo rather than a new failure.

import { execFile, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, symlinkSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_BRANCH = "gitagent/learning";

// Boot-time git. Synchronous on purpose: the clone has to be finished before
// the port opens, for the same reason hydrateFromDb does — Cloud Run sends
// traffic the instant it can, and a request landing mid-clone would answer
// from a half-copied agent.
function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
    // A hung credential prompt would hang the boot. There is no terminal to
    // prompt on in a container, so make that explicit rather than discovering
    // it as a stall.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

// https://github.com/o/r → https://<token>@github.com/o/r. The token never
// reaches disk in this form for longer than the run: session.js:122 strips it
// out of the remote URL in finalize(), and the run directory is deleted after.
function authedUrl(url, token) {
  return url.replace(/^https:\/\//, `https://${encodeURIComponent(token)}@`);
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
      // A missing link is not fatal on its own: without node_modules the tool
      // subprocesses fail loudly, and without .gitagent the search tools fall
      // back to live queries. Both are visible, neither is silent corruption.
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
  // Badger's whole read-only story rests on it holding no GitHub credential of
  // its own — Composio holds the source connection server-side — and
  // env.template says in as many words that nothing reads GITHUB_TOKEN. This
  // token is a different animal with a different blast radius: it writes to
  // the agent's OWN repository and must reach nothing else. Giving it its own
  // name keeps the two from being confused for one another by anyone reading
  // the deploy command, and keeps that line in env.template true.
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
      // A FULL clone, deliberately, and the missing --depth 1 is the point.
      //
      // Shallow looked obviously right — the agent needs the files, not the
      // history — and it broke the loop in a way that only showed up under
      // test. With depth 1 the clone holds exactly one commit of the default
      // branch, so once the learning branch exists and main moves on there is
      // no common ancestor between them, and the boot merge below dies on
      // "fatal: refusing to merge unrelated histories". The agent then never
      // sees a change to main again.
      //
      // The saving was never worth defending: this repository is ~9MB of git
      // objects and clones in about 1.4 seconds, once per container start.
      git(["clone", authedUrl(url, token), template]);
    }
    // Strip the token straight back out of the stored remote. Every run sets
    // it again inside its own copy and finalize() strips it there too, so the
    // long-lived directory never holds a credential.
    git(["remote", "set-url", "origin", url], template);
    git(["config", "user.email", "badger@users.noreply.github.com"], template);
    git(["config", "user.name", "badger"], template);

    // The learning branch has to exist locally before the first run, and this
    // is not a nicety. session.js:57-63 does `checkout <session>` and, on
    // failure, `checkout -b <session> origin/<session>` — with no third
    // fallback. On a repo where the branch exists in neither place both throw,
    // initLocalSession throws, and query() reports an error instead of an
    // answer. Not "learning silently does not persist": every question fails.
    // So create it here, from the default branch, before anything runs.
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
    // And check it out, which is load-bearing rather than tidy. The template
    // is what every run is copied from, so whatever branch IT sits on is where
    // each copy's local `gitagent/learning` ref points. Left on main, the
    // template's copy of the branch never advances: run 1 pushes, run 2 starts
    // from the stale ref, and its push is rejected non-fast-forward — measured,
    // not imagined. Sitting on the branch is also what makes sync() below pull
    // the right thing.
    git(["checkout", branch], template);

    // Bring the default branch INTO the learning branch, every boot.
    //
    // Without this the loop is one-way and the agent quietly freezes. The
    // runtime checks out the session branch and pulls only that branch
    // (session.js:64-68), so once gitagent/learning exists it never sees main
    // again — which means editing a skill, fixing RULES.md or deploying a new
    // version of the agent would have NO effect on the running agent, forever.
    // Found by fixing a skill and realising the fix could not reach it.
    //
    // A conflict is possible in principle: a person edits a SKILL.md body on
    // main while the agent rewrites the same file's frontmatter counters here.
    // In practice those are different hunks and git merges them cleanly. When
    // it does not, abort and keep running on the branch as it stands — a stale
    // agent is bad, a half-merged one is worse — and say so loudly, because
    // this is the one case that needs a person.
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
          `main until this is resolved by hand: ${String(err.message).split("\n")[0]}`
      );
    }

    linkRuntimeDirs(template, root);
  } catch (err) {
    console.warn(
      `[agent-repo] could not prepare the agent clone (${err.message.split("\n")[0]}) — ` +
        "running from the image."
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
     */
    async queryTarget() {
      const dir = join(tmpdir(), `badger-run-${randomBytes(4).toString("hex")}`);
      try {
        await mkdir(dir, { recursive: true });
        // Async, and dereference:false. Async because this sits in the request
        // path and one instance serves three concurrent answers — a
        // synchronous copy of the repo would stall the other two. And
        // dereference:false so the node_modules and .gitagent symlinks are
        // copied as links rather than as 460MB of files.
        await cp(template, dir, { recursive: true, dereference: false, force: true });
        linkRuntimeDirs(dir, root);
      } catch (err) {
        console.warn(`[agent-repo] run copy failed (${err.message}) — this run uses the image.`);
        await rm(dir, { recursive: true, force: true }).catch(() => {});
        return { dir: root, release: async () => {} };
      }
      return {
        // Passing `session` is what keeps this to one branch instead of one
        // per question. Passing `dir` at a path that already exists is what
        // keeps it to a fetch instead of a clone.
        repo: { url, token, dir, session: branch },

        // Reconcile, then delete. Two answers running at once each commit to
        // the same branch from the same base, so the second push of the pair
        // is rejected non-fast-forward — and sdk.js:473-477 wraps finalize()
        // in a bare catch, so the runtime drops that on the floor without
        // telling anyone. Measured with two concurrent runs: one pushed, one
        // was rejected, and nothing anywhere said so. A lost answer would be
        // loud; lost learning was silent, which is worse.
        //
        // So before throwing the copy away, ask whether it still holds
        // commits the remote does not. If it does, rebase onto the branch and
        // push again. If that still fails, say so — a warning in the log is
        // the minimum a dropped commit deserves.
        release: async () => {
          try {
            const { stdout } = await execFileAsync(
              "git",
              ["log", "--oneline", `origin/${branch}..HEAD`],
              { cwd: dir, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }
            );
            if (stdout.trim()) {
              // finalize() stripped the credential out of the remote on its
              // way past (session.js:122), so put it back for this one push.
              // The directory is deleted immediately after either way.
              const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
              await execFileAsync("git", ["remote", "set-url", "origin", authedUrl(url, token)], { cwd: dir, env });

              // Three attempts, because the ordinary case is a race rather
              // than a disagreement: another run pushed in the gap between our
              // pull and our push, and trying again simply wins. What retrying
              // cannot fix is two runs editing the same lines of the same file
              // — a real conflict — and that is the case the warning below is
              // for. Auto-resolving it would be inventing memory the agent
              // never wrote.
              let pushed = false;
              for (let attempt = 1; attempt <= 3 && !pushed; attempt++) {
                try {
                  await execFileAsync("git", ["pull", "--rebase", "origin", branch], { cwd: dir, env });
                  await execFileAsync("git", ["push", "origin", branch], { cwd: dir, env });
                  pushed = true;
                } catch (e) {
                  // Leave no half-finished rebase behind for the next attempt
                  // to trip over.
                  await execFileAsync("git", ["rebase", "--abort"], { cwd: dir, env }).catch(() => {});
                  if (attempt === 3) throw e;
                }
              }
              console.log(
                `[agent-repo] recovered ${stdout.trim().split("\n").length} learning ` +
                  "commit(s) that lost a concurrent push"
              );
            }
          } catch (err) {
            // origin/<branch> not existing yet is the ordinary first-run case
            // and is not worth a warning; anything else is.
            const msg = String(err.stderr || err.message || "");
            if (!msg.includes("unknown revision") && !msg.includes("bad revision")) {
              console.warn(`[agent-repo] a learning commit could not be pushed: ${msg.split("\n")[0]}`);
            }
          }
          await rm(dir, { recursive: true, force: true }).catch(() => {});
        },
      };
    },

    /**
     * Bring the template up to date with what the last run pushed, so the
     * Skills screen shows skills the agent learned rather than only the ones
     * that shipped. `pull --rebase` and not `reset --hard`: a skill a person
     * added through the UI is a local commit here that has not been pushed
     * yet, and a reset would throw it away. Best-effort by design — a failure
     * leaves a slightly stale skill list and nothing else.
     */
    async sync() {
      try {
        await execFileAsync("git", ["pull", "--rebase", "origin", branch], {
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
