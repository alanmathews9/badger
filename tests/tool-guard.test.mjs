// The two runtime tools whose arguments reach a shell or the filesystem
// unchecked, and the guard that refuses them.
//
// Half of these cases are the attacks. The other half matter more: they pin
// the calls the agent actually makes, because a guard that blocks legitimate
// work is a worse bug than the hole it closes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { guardRuntimeTool } from "../app/server/tool-guard.mjs";

// ── read: the run directory holds the push token in .git/config ──────────

test("read of a skill procedure is allowed — this is the common case", () => {
  assert.equal(guardRuntimeTool("read", { path: "skills/find-expert/SKILL.md" }), null);
});

test("read of a skill's references and of memory is allowed", () => {
  assert.equal(guardRuntimeTool("read", { path: "skills/trace-decision/references/sources.md" }), null);
  assert.equal(guardRuntimeTool("read", { path: "memory/MEMORY.md" }), null);
  assert.equal(guardRuntimeTool("read", { path: "RULES.md" }), null);
});

test("read cannot reach .git/config, where the run's push token lives", () => {
  assert.match(guardRuntimeTool("read", { path: ".git/config" }), /\.git/);
  assert.match(guardRuntimeTool("read", { path: "./.git/config" }), /\.git/);
});

test("read refuses an absolute path", () => {
  assert.ok(guardRuntimeTool("read", { path: "/etc/passwd" }));
  assert.ok(guardRuntimeTool("read", { path: "/proc/self/environ" }));
});

test("read refuses ~ expansion, which dist/tools/read.js honours", () => {
  assert.ok(guardRuntimeTool("read", { path: "~/.aws/credentials" }));
  assert.ok(guardRuntimeTool("read", { path: "~" }));
});

test("read refuses traversal out of the agent directory", () => {
  assert.ok(guardRuntimeTool("read", { path: "../../etc/passwd" }));
  assert.ok(guardRuntimeTool("read", { path: "skills/../../.env" }));
  assert.ok(guardRuntimeTool("read", { path: "skills\\..\\..\\.env" }));
});

test("a filename that merely contains the traversal characters is fine", () => {
  // `..` has to be a whole path segment. "release-notes..md" is not traversal
  // and a guard that refused it would be the false positive this file is for.
  assert.equal(guardRuntimeTool("read", { path: "docs/release-notes..md" }), null);
  assert.equal(guardRuntimeTool("read", { path: "skills/git-log/SKILL.md" }), null);
});

// ── skill_learner: skill_name is joined onto a path and into a shell ──────

test("a kebab-case skill name passes on every action", () => {
  for (const action of ["crystallize", "update", "delete"]) {
    assert.equal(
      guardRuntimeTool("skill_learner", { action, skill_name: "reconcile-two-policies" }),
      null,
    );
  }
});

test("skill_learner calls carrying no skill_name are untouched", () => {
  // "evaluate" names no skill, and blocking it would break the loop.
  assert.equal(guardRuntimeTool("skill_learner", { action: "evaluate", task_id: "abc" }), null);
});

test("skill_learner refuses a name that would escape skills/", () => {
  // dist/tools/skill-learner.js validates kebab-case only inside crystallize.
  // `delete` rm -rf's join(agentDir, "skills", name), so ".." is the clone root.
  assert.ok(guardRuntimeTool("skill_learner", { action: "delete", skill_name: ".." }));
  assert.ok(guardRuntimeTool("skill_learner", { action: "update", skill_name: "../../etc" }));
});

test("skill_learner refuses a name that would reach the shell", () => {
  // The delete branch interpolates the name into `git commit -m "..."`.
  assert.ok(guardRuntimeTool("skill_learner", { action: "delete", skill_name: 'x$(id)' }));
  assert.ok(guardRuntimeTool("skill_learner", { action: "delete", skill_name: "x`id`" }));
});

// ── everything else is none of this guard's business ─────────────────────

test("the search and read tools the agent actually uses are never touched", () => {
  for (const tool of ["github_search", "gmail_thread", "drive_file", "task_tracker", "memory"]) {
    assert.equal(guardRuntimeTool(tool, { query: "../../etc/passwd", path: "/etc/passwd" }), null);
  }
});

test("a missing args object does not throw", () => {
  assert.equal(guardRuntimeTool("read"), null);
  assert.equal(guardRuntimeTool("skill_learner"), null);
});
