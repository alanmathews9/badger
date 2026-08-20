/**
 * Refuse the two runtime tools whose arguments reach a shell or the filesystem
 * unchecked. Returns a reason to block on, or null to let the call through.
 *
 * `disallowedTools` removes cli, write and edit from the model's schema, which
 * cannot fail open. It does NOT remove `read`, `memory`, `task_tracker` or
 * `skill_learner` — those are the learning loop and Badger wants them — and
 * `hooks/allow-tools.sh` is not a second line of defence for them, because
 * dist/hooks.js treats a crash, a timeout and any non-JSON output as "allow"
 * (:83-107). So the checks that matter happen here, in process.
 *
 * Both holes are the same shape: an argument the model writes, interpolated
 * into a path or a command without validation. Neither guard can fire on a
 * legitimate call — the agent reads `skills/<name>/SKILL.md` and names skills
 * in kebab-case — so this changes nothing it does.
 */
export function guardRuntimeTool(toolName, args = {}) {
  // `read` resolves an absolute path as-is, expands `~`, and applies no
  // containment to `..` (dist/tools/read.js:5-9). The run directory is a clone
  // of the agent's own repo whose `.git/config` holds the push token in the
  // remote URL for the length of the run (dist/session.js:43), so an
  // unrestricted read is a credential read — and the answer carrying it goes
  // to the browser and into chat_message.
  if (toolName === "read") {
    const path = String(args.path ?? "");
    if (path.startsWith("/") || path.startsWith("~") || path.split(/[\\/]/).includes("..")) {
      return "read is scoped to the agent directory. Use a relative path such as skills/<name>/SKILL.md.";
    }
    if (/(^|[\\/])\.git([\\/]|$)/.test(path)) {
      return "the .git directory is not readable.";
    }
  }

  // `skill_learner` validates skill_name against kebab-case only in its
  // crystallize branch (dist/tools/skill-learner.js:164). `update` (:309) and
  // `delete` (:333) join it onto a path unchecked, so `..` resolves to the
  // agent clone root — which `delete` then rm -rf's before `git add -A`
  // commits the deletion of every file to the learning branch. Its commit
  // message interpolates the same value into a shell (:341).
  if (toolName === "skill_learner" && args.skill_name != null) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(args.skill_name))) {
      return "skill_name must be kebab-case, e.g. reconcile-two-policies.";
    }
  }

  return null;
}
