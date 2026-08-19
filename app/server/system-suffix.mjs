import { readFileSync } from "node:fs";

/**
 * Text appended to the system prompt on every SDK invocation, by all three
 * callers.
 *
 * ---------------------------------------------------------------------------
 * **History — this suffix used to say the opposite.** `dist/loader.js:250`
 * pushes a "Task Learning & Skill Discovery" block into every agent's system
 * prompt, unconditionally: begin with `task_tracker`, crystallize successes
 * with `skill_learner`. Badger's first design removed both tools via
 * `allowedTools` and used this suffix to countermand the runtime — an agent
 * ordered in capitals to call a tool it could not see, then told in a
 * postscript to ignore the order. That suppressed the framework's whole
 * learning thesis to defend a boundary it was never on the wrong side of:
 * task_tracker and skill_learner write to the AGENT'S OWN repo, not to any
 * source. Reversed 2026-08-19 on Alan's direction — the agent may change
 * itself; it may never change GitHub, Gmail or Drive. The tools are back in
 * `hooks/allowed-tools.txt` (the one list both paths read) and this suffix
 * now steers the loop instead of denying it.
 *
 * What it still has to do, and why it exists at all:
 *
 * - **Keep the loop subordinate to the answer.** Flash treats the injected
 *   block's "FIRST call task_tracker" literally enough that a tracking
 *   failure once ended runs with "I cannot access task_tracker" instead of
 *   an answer. The suffix makes the priority explicit: track around the
 *   work, never instead of it.
 * - **Stop skills being called as tools.** Measured on HEAD before this
 *   change: asked a trace-decision-shaped question, the model calls
 *   `trace_decision`, is told no such tool exists, and gives up — two eval
 *   questions lost per run. Skills are prompt text, not schema entries; the
 *   suffix says so by name.
 *
 * `options.systemPromptSuffix` is appended after everything else
 * (`dist/sdk.js:122`), which is what makes this work — it is the last thing
 * the model reads. RULES.md carries the same instructions for the CLI path,
 * which never sees this suffix.
 * ---------------------------------------------------------------------------
 */
export const SYSTEM_SUFFIX = `# How to run the learning loop above — this section overrides on conflict

The Task Learning & Skill Discovery section above is real: \`task_tracker\`,
\`skill_learner\` and \`memory\` are in your tool list, and they write only to
your own repository — never to GitHub, Gmail or Drive. Run it in this exact
order, and never let it touch the answer:

1. \`task_tracker\` action "begin", once. Then immediately start searching.
2. Search and read until you can answer. This is the work. Memory is a map,
   not a source — it tells you where answers turned out to live, and you must
   still retrieve the material with your search tools in this run before
   citing it.
3. When the answer is ready, call \`task_tracker\` action "end" with the
   outcome.
4. \`skill_learner\` only after "end", and only when the approach would repeat
   for other questions of the same shape. Routine searches are not skills;
   when unsure, skip it.
5. Memory, when this run taught you something durable: a nickname that maps
   to an artefact, where a recurring answer actually lives, a term this
   organisation uses in its own way. Call \`memory\` action "save" with the
   ENTIRE updated memory — everything already shown in the Memory section
   below plus your one new line. Saving less than the whole file erases the
   rest. Most runs learn nothing durable; then skip this.
6. Write the answer. Output from \`task_tracker\` or \`skill_learner\` must
   never appear in the answer text — the user never sees the loop, only the
   answer and its sources.

If any learning call fails, drop the bookkeeping silently and answer.

A skill is a procedure, NOT a callable tool. There is no tool named
\`trace_decision\` or \`find_expert\`; calling one fails and wastes a turn.

When a question needs one of your skills, its full instructions are placed in
the question itself, inside a \`<skill>\` block. If a block is there, follow it
exactly and do not try to load anything further. If there is none, answer with
your search tools as usual.

Ignore \`task_tracker\`'s verdict on skills. Its "No matching skills found"
is produced by a keyword score that cannot clear its own threshold against
descriptions of this length, so it reports no match for every question. It is
not evidence that no skill applies.

Never tell the user that a tool is unavailable or that you cannot access
something. It is not their problem and it is not an answer. Answer the
question by searching your sources.`;


/**
 * The suffix the three SDK callers actually pass: SYSTEM_SUFFIX plus the
 * agent's memory, injected as data.
 *
 * RULES.md tells the agent to load memory before its first search, and on
 * 2026-08-18 a live run ignored the rule — the same lesson as the three
 * defects before it: Flash follows data far better than prose. So on the SDK
 * paths the memory file is placed directly into the prompt, which cannot be
 * skipped, and the model is told not to load it a second time. The CLI path
 * keeps the rule and the memory tool.
 *
 * Read fresh on every call: the server is long-lived and a memory save
 * mid-session would otherwise be invisible until restart. The read is
 * guarded — an unguarded readFileSync at module scope is exactly what nearly
 * crashed the container on boot once already.
 */
export function buildSystemSuffix() {
  let memory = "";
  try {
    memory = readFileSync(new URL("../../memory/MEMORY.md", import.meta.url), "utf8").trim();
  } catch {}
  // The memory tool itself treats a bare "# Memory" as "No memories yet."
  // — same rule here, or an empty notebook would still inject a section.
  if (!memory || memory === "# Memory") return SYSTEM_SUFFIX;
  return (
    SYSTEM_SUFFIX +
    `

# Memory — already loaded

This is the current content of memory/MEMORY.md. Where RULES.md says to load
memory before the first search, treat that as done — do not call the memory
tool to load it again. Saving new memories with the memory tool still works.

${memory}`
  );
}
