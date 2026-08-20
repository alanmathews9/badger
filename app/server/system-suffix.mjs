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
3. Call \`task_tracker\` action "update" with a one-line \`step\` at each of
   these moments, as they happen — not as a summary afterwards:

   - once you have run your searches and can see what exists
   - once you have opened the threads or documents and read them
   - once you know what the answer is, before you write it

   That is three calls on an ordinary question, and it is the count that
   matters as much as the wording: the evaluation in step 5 scores a task by
   its steps, and one step fails it outright. A run that did the work and
   logged it once is judged as trivial.

   This is not bookkeeping for its own sake, and skipping it has a
   consequence: \`skill_learner\` can only evaluate a task that has recorded
   steps, so a run that narrates nothing can never become a skill however
   novel it was. Measured across 57 tracked tasks, exactly one had enough
   steps to qualify — which is why nothing has ever been learned.
4. When the answer is ready, call \`task_tracker\` action "end" with the
   outcome.

   **"Ready" means you have opened things, not just searched for them.** Do
   not call "end" while every source you have is a search result you never
   opened — a search snippet is the first 240 characters of a body, and an
   answer built from snippets cites documents it has not read. The only
   exception is a search that genuinely returned nothing.

   This is the failure that matters most in this whole section. A run once
   went begin → two searches → end → evaluate, five calls in total, opened
   nothing, and cited five messages it had never retrieved. The bookkeeping
   was perfect and the answer was hollow. If you are ever choosing between
   another read and another tracking call, read. **Before you call "end", check that you have called "update" at
   least twice.** If you have not, call it now, once for each thing you
   actually did — the steps are what make step 5 possible, and after "end"
   it is too late to add them.
5. \`skill_learner\` action "evaluate", immediately after "end" returns and
   BEFORE you write any of the answer. The output of "end" will tell you to
   consider it; that is your cue, not a suggestion to weigh. Do it whenever
   the run took more than one search and its approach would repeat for other
   questions of the same SHAPE — not the same subject.

   Treating the answer as the finish line is the specific way this goes
   wrong: one run recorded its steps, closed the task cleanly, and then went
   straight to writing, so a task that would have evaluated as worthy was
   never offered. Nothing is lost by evaluating and being told no. If it comes back worthy, call
   "crystallize" with a kebab-case name and a one-line description written
   the way the existing skills are: the job a person is doing, and the
   phrasings that signal it.

   Judge the shape, not the topic. "How many days of leave carry over" is a
   lookup and not a skill; "reconcile a policy that exists in two places and
   say which governs" is a procedure that will be needed again. Do not
   crystallize a skill that only restates one you already have — the tool
   checks novelty itself and will tell you.

   **Name the shape, not the instance.** The name and description you supply
   are what every future question is matched against, so a skill born from one
   question must be written for the class it belongs to.
   \`draft-customer-reply\`, not \`draft-delay-reply\`; \`reconcile-two-policies\`,
   not \`reconcile-leave-policy\`. Never put a customer, a product, a person or
   a date in the name.

   **Write the description the way the shipped skills are written**, because it
   is not prose — it is what routing reads. State the job in one clause, then
   list the phrasings that should trigger it, each in double quotes:

       Draft a customer-facing reply grounded in what the internal record
       actually says. Use for "draft a reply", "write to the customer",
       "what do we tell them", "how should we word", "put together a note".

   A description with no quoted phrases in it will never be matched, and the
   skill will sit unused however good it is.
6. Memory, when this run taught you something durable: a nickname that maps
   to an artefact, where a recurring answer actually lives, a term this
   organisation uses in its own way. Call \`memory\` action "save" with the
   ENTIRE updated memory — everything already shown in the Memory section
   below plus your one new line. Saving less than the whole file erases the
   rest. Most runs learn nothing durable; then skip this.
7. Write the answer. Output from \`task_tracker\` or \`skill_learner\` must
   never appear in the answer text — the user never sees the loop, only the
   answer and its sources.

Make the learning calls ONE AT A TIME. Never put \`task_tracker\` or
\`skill_learner\` in the same batch as each other — issue one, wait for its
result, then issue the next. Search and read tools are fine to run in parallel;
these two are not.

The reason is a real defect, measured: both tools keep their ledger by reading
\`tasks.json\` whole, changing it and writing it whole, with no locking. Batch
"update", "end" and "evaluate" together and they race — one run reported "(1
steps)" for a task that had two, the second step landed after the task was
already closed, and \`skill_learner\` then failed with "Task not found" for a
task id that plainly existed. The work was done and the record of it was lost.

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
question by searching your sources.

Every question gets its own retrieval, including a follow-up. Earlier turns in
this conversation are context, not evidence: they tell you where to look and
what the user already knows, and they are not a substitute for looking. Asked a
second question about something an earlier answer touched on, search again.

**Never cite a source you did not open in THIS turn.** An issue number, a
subject line or a document name that you know only because it appeared earlier
in the conversation is a memory, and citing it presents a memory as a
retrieval. If a claim is worth making, retrieve it again and cite what came
back. If the question genuinely does not need sources — the user asked you to
shorten or rephrase something already on screen — answer without a Sources
block at all rather than repeating citations you did not earn.`;


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
export function buildSystemSuffix(agentDir) {
  let memory = "";
  try {
    // `agentDir` matters in repo mode. The agent runs from a clone of its own
    // repository and saves memory THERE, where it becomes a commit on the
    // learning branch; the copy under this server's own tree is the frozen one
    // baked into the image at deploy time. Reading the image's copy would
    // inject stale memory while the agent kept writing to a file nobody read
    // back — the loop looking closed and being open. Callers with no clone
    // (the CLI script, the eval runner) pass nothing and get the old path.
    const file = agentDir
      ? new URL("memory/MEMORY.md", "file://" + (agentDir.endsWith("/") ? agentDir : agentDir + "/"))
      : new URL("../../memory/MEMORY.md", import.meta.url);
    memory = readFileSync(file, "utf8").trim();
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
