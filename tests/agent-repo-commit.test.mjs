// The sub-agent commit, against a real git repository — no mocks, no network.
//
// A sub-agent run uses `dir:` rather than `repo:`, so the runtime does no git
// and whatever the agent wrote would die with the run copy. commitAgentWrites
// is what stages and commits it, before the existing push path carries it out.
//
// What matters here and is easy to lose: the message is fixed and carries no
// model-written text, the author is the agent, a clean tree is left alone, and
// a git failure warns rather than throwing — because a failure to record what
// was learned must never take an answer down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAgentWrites, openAgentRepo } from "../app/server/agent-repo.mjs";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" }).trim();
}

// A bare "remote" plus a clone of it, so the working copy under test has an
// origin and a real history rather than an orphan init.
function scratchClone() {
  const root = mkdtempSync(join(tmpdir(), "badger-agent-repo-"));
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const clone = join(root, "clone");

  git(["init", "--bare", "-b", "main", remote], root);
  git(["init", "-b", "main", seed], root);
  writeFileSync(join(seed, "README.md"), "seed\n");
  git(["add", "-A"], seed);
  git(["-c", "user.name=seed", "-c", "user.email=seed@example.com", "commit", "-m", "seed"], seed);
  git(["remote", "add", "origin", remote], seed);
  git(["push", "origin", "main"], seed);

  git(["clone", remote, clone], root);
  return { root, clone };
}

function log(dir, format) {
  return git(["log", "-1", `--format=${format}`], dir);
}

test("a dirty tree is committed with a fixed message and the agent as author", async () => {
  const { root, clone } = scratchClone();
  try {
    const before = git(["rev-parse", "HEAD"], clone);
    mkdirSync(join(clone, "memory"), { recursive: true });
    writeFileSync(join(clone, "memory", "MEMORY.md"), "# Memory\n\n- learned something\n");

    assert.equal(await commitAgentWrites(clone, "hr-badger"), true);

    assert.notEqual(git(["rev-parse", "HEAD"], clone), before);
    assert.equal(log(clone, "%s"), "agent: hr-badger learning from a run");
    assert.equal(log(clone, "%an"), "badger");
    assert.equal(log(clone, "%ae"), "badger@users.noreply.github.com");
    assert.equal(git(["status", "--porcelain"], clone), "");
    // The whole tree, not just tracked files: a crystallised skill is new.
    assert.match(git(["show", "--stat", "--format=", "HEAD"], clone), /memory\/MEMORY\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a modified tracked file is committed too", async () => {
  const { root, clone } = scratchClone();
  try {
    writeFileSync(join(clone, "README.md"), "seed\nchanged\n");
    assert.equal(await commitAgentWrites(clone, "eng-badger"), true);
    assert.equal(log(clone, "%s"), "agent: eng-badger learning from a run");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a clean tree produces no commit", async () => {
  const { root, clone } = scratchClone();
  try {
    const before = git(["rev-parse", "HEAD"], clone);
    assert.equal(await commitAgentWrites(clone, "hr-badger"), false);
    assert.equal(git(["rev-parse", "HEAD"], clone), before);
    assert.equal(git(["rev-list", "--count", "HEAD"], clone), "1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a git failure warns and returns false rather than throwing", async () => {
  const root = mkdtempSync(join(tmpdir(), "badger-agent-repo-"));
  const notARepo = join(root, "plain");
  mkdirSync(notARepo);
  writeFileSync(join(notARepo, "file.txt"), "x\n");

  const warnings = [];
  const original = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    assert.equal(await commitAgentWrites(notARepo, "hr-badger"), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /could not commit what agent hr-badger wrote/);
  } finally {
    console.warn = original;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a slug that is not kebab-case cannot shape the commit message", async () => {
  const { root, clone } = scratchClone();
  try {
    writeFileSync(join(clone, "note.txt"), "x\n");
    await commitAgentWrites(clone, "hr badger\n-m evil");
    assert.equal(log(clone, "%s"), "agent: hrbadger-mevil learning from a run");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


// ── saveEdit: what the PRODUCT writes ─────────────────────────────────────
//
// An agent or skill created through the UI is written straight into the
// template clone. In repo mode that clone lives under tmpdir() on an instance
// that scales to zero, so without a commit the whole Agents feature loses data
// the moment the container recycles — measured on 2026-08-21, not feared.
//
// These run a real openAgentRepo against a real bare "remote", so the branch
// setup, the commit and the push are all the shipped code path.

/** A repo-mode agent-repo pointed at a scratch remote, with env restored. */
async function scratchRepo() {
  const { root, clone } = scratchClone();
  const remote = join(root, "remote.git");
  // The template is cloned by openAgentRepo itself; hand it a path that does
  // not exist yet so the full-clone branch is the one under test.
  const template = join(root, "template");
  rmSync(clone, { recursive: true, force: true });

  const saved = {
    url: process.env.BADGER_AGENT_REPO_URL,
    token: process.env.BADGER_AGENT_REPO_TOKEN,
    dir: process.env.BADGER_AGENT_DIR,
    branch: process.env.BADGER_LEARNING_BRANCH,
  };
  // A file:// remote takes no credential, and authedUrl leaves it untouched —
  // which is the point: no token is needed to exercise the push path.
  process.env.BADGER_AGENT_REPO_URL = remote;
  process.env.BADGER_AGENT_REPO_TOKEN = "unused-for-a-local-remote";
  process.env.BADGER_AGENT_DIR = template;
  process.env.BADGER_LEARNING_BRANCH = "gitagent/learning";

  const repo = openAgentRepo(root);
  const restore = () => {
    for (const [key, value] of Object.entries({
      BADGER_AGENT_REPO_URL: saved.url,
      BADGER_AGENT_REPO_TOKEN: saved.token,
      BADGER_AGENT_DIR: saved.dir,
      BADGER_LEARNING_BRANCH: saved.branch,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  };
  return { repo, template, remote, restore };
}

test("an agent written by the UI is committed and pushed to the learning branch", async () => {
  const { repo, template, remote, restore } = await scratchRepo();
  try {
    assert.equal(repo.mode, "repo", "the scratch env should put this in repo mode");

    mkdirSync(join(template, "agents", "hr-badger"), { recursive: true });
    writeFileSync(join(template, "agents", "hr-badger", "agent.yaml"), "name: hr-badger\n");

    assert.equal(await repo.saveEdit("agent", "create", "hr-badger"), true);

    assert.equal(log(template, "%s"), "ui: create agent hr-badger");
    assert.equal(git(["status", "--porcelain"], template), "");
    // On the REMOTE, which is the whole point — a commit that never left the
    // instance is the bug this closes.
    assert.match(
      git(["show", "--stat", "--format=", "gitagent/learning"], remote),
      /agents\/hr-badger\/agent\.yaml/,
    );
  } finally {
    restore();
  }
});

test("saveEdit composes its own message and never lets caller text into argv", async () => {
  const { repo, template, restore } = await scratchRepo();
  try {
    writeFileSync(join(template, "note.md"), "x\n");
    await repo.saveEdit("skill", "delete", "find-expert; rm -rf /");
    // The slug is stripped to its safe characters and the verb is taken from a
    // fixed set, so the message is ours whatever the caller passed.
    assert.equal(log(template, "%s"), "ui: delete skill find-expertrm-rf");

    writeFileSync(join(template, "note.md"), "y\n");
    await repo.saveEdit("agent", "$(whoami)", "eng-badger");
    assert.equal(log(template, "%s"), "ui: change agent eng-badger");

    writeFileSync(join(template, "note.md"), "z\n");
    await repo.saveEdit("schedule", "create", "hr-badger");
    assert.equal(log(template, "%s"), "ui: create schedule hr-badger");

    // A kind nobody here passes falls back to "skill" rather than reaching
    // the message, so the vocabulary really is closed.
    writeFileSync(join(template, "note.md"), "w\n");
    await repo.saveEdit("`id`", "update", "hr-badger");
    assert.equal(log(template, "%s"), "ui: update skill hr-badger");
  } finally {
    restore();
  }
});

test("a clean tree saves nothing, so opening an agent does not make a commit", async () => {
  const { repo, template, restore } = await scratchRepo();
  try {
    const before = git(["rev-parse", "HEAD"], template);
    assert.equal(await repo.saveEdit("agent", "update", "hr-badger"), false);
    assert.equal(git(["rev-parse", "HEAD"], template), before);
  } finally {
    restore();
  }
});

test("in dir mode saveEdit is a no-op rather than a git call", async () => {
  const saved = process.env.BADGER_AGENT_REPO_URL;
  delete process.env.BADGER_AGENT_REPO_URL;
  try {
    const repo = openAgentRepo(process.cwd());
    assert.equal(repo.mode, "dir");
    assert.equal(await repo.saveEdit("agent", "create", "hr-badger"), false);
  } finally {
    if (saved === undefined) delete process.env.BADGER_AGENT_REPO_URL;
    else process.env.BADGER_AGENT_REPO_URL = saved;
  }
});
