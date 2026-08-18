/**
 * Text appended to the system prompt on every SDK invocation, by all three
 * callers, to countermand an instruction the runtime injects and we cannot
 * switch off.
 *
 * ---------------------------------------------------------------------------
 * **What the runtime does.** `dist/loader.js:250` pushes a "Task Learning &
 * Skill Discovery" block into the system prompt of every agent it runs. It is
 * unconditional — no manifest flag, no config, no gate — and it says, in
 * capitals:
 *
 *     1. FIRST: Call `task_tracker` action "begin" with your objective
 *     IMPORTANT: Do NOT skip step 1. Even for tasks that seem simple, always
 *     check for skills first.
 *
 * **Why that breaks Badger.** `task_tracker` and `skill_learner` write —
 * `task_tracker` persists `tasks.json` and `skill_learner` writes new skills
 * into `skills/` — so neither is in `hooks/allowed-tools.txt`, and the SDK's
 * `allowedTools` removes both from the model's schema entirely (NOTES.md §10b).
 * The result is an agent ordered in capitals to call a tool it cannot see.
 *
 * Gemini obeys the order, receives "Tool task_tracker not found", and treats it
 * as a blocked task rather than a missing tool. Observed on the flagship query:
 * the answer card opened with "I cannot access `task_tracker`", narrated a
 * search plan it never carried out, and reported no citations — while the
 * retrieval pass beside it had already returned the right issue first.
 *
 * **Why a prompt fix here rather than a tool fix.** The house rule is to encode
 * a guardrail in data rather than prose, and it does not apply: there is no tool
 * to fix. The defect is a system-prompt instruction, so the only lever that
 * reaches it is another system-prompt instruction. `options.systemPromptSuffix`
 * is appended after everything else (`dist/sdk.js:122`), which is what makes
 * this work — it is the last thing the model reads.
 *
 * Allowing the tools instead was considered and rejected: it would trade a
 * cosmetic defect for a real write capability, which is the one thing Badger
 * promises it does not have.
 *
 * `RULES.md` carries the same instruction. That is deliberate belt and braces —
 * RULES.md covers the CLI path, which does not go through the SDK and so never
 * sees this suffix.
 * ---------------------------------------------------------------------------
 */
export const SYSTEM_SUFFIX = `# Your actual tool list — this section overrides every instruction above

The "Task Learning & Skill Discovery" section above is injected into every agent
this runtime starts. It does not describe you, and following it will waste the
user's question.

- \`task_tracker\` and \`skill_learner\` are **not available to you**. They are
  absent from your tool list and calling either one fails.
- Ignore steps 1 to 4 of that section entirely. There is no "begin" step.
- Never tell the user that a tool is unavailable or that you cannot access
  something. They cannot install it, it is not their problem, and it is not an
  answer to their question.

Your skills are already loaded above; there is nothing to discover. Answer the
question by searching your sources, starting with your first tool call.`;
