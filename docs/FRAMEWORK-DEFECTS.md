# Thirteen defects found by building on gitagent — the teaching record

Written 2026-08-21. This is the consolidated, citable list of what broke while
building Badger on the framework and the OpenGap spec, with the proof for each
one read out of the **installed** runtime rather than the docs.

Two artifacts render this material for a reader:

- **Problems only, for filing / sharing with the team** —
  <https://claude.ai/code/artifact/6c3ebff1-e6bb-45b9-8272-9ab9e9e62438>
- **How the runtime works, end to end** (components, full query lifecycle,
  self-learning loop, where Badger departs and why) —
  <https://claude.ai/code/artifact/6b6198b8-2cff-48a0-99c7-e3de34ee820e>

**Relationship to `docs/UPSTREAM.md`.** UPSTREAM.md is the deeper, submission-
facing document and already carries six findings with reproductions
(validator-vs-runtime, spec-valid-tool-invisible, the ledger race, `abort()`,
multi-agent composition, plus a long smaller-notes section). This file is the
*learning-loop* cluster, which UPSTREAM.md does not yet cover, plus the items
where the two overlap, marked as such. **They should be merged — Alan's call
which file wins.** Do not silently maintain both.

All line numbers are from `@open-gitagent/gitagent@2.1.0` as installed at
`/opt/homebrew/lib/node_modules/@open-gitagent/gitagent/dist/`. Every one was
re-read on 2026-08-21; none is carried over from an earlier note.

---

## The learning loop

### 1. No skill can ever match, so the skill system never fires

**What happened.** Badger has four skills and used none of them, ever. It went
straight to searching every time and nothing reported a problem.

**Proof.** The matcher divides shared words by the length of the *longer* text,
which is always the skill description:

```js
// dist/tools/task-tracker.js:36
return matches / Math.max(a.length, b.length);
//   a = task objective          (4–9 words)
//   b = skill name + description (50–62 words)
```

So the score measures *how much of the description the objective covered*, not
how well the two match. A 4-word objective against a 51-word description caps at
4/51 = **0.078**, against the fixed gate `relevance > 0.1` (line 68). It cannot
pass however perfect the match. Measured across four representative objectives
× four skills: **0 of 16 matched.** The ranking is even correct —
`recent-activity` scores highest for "what shipped in the last two weeks" — it
simply cannot clear the bar.

It also punishes the descriptions the framework asks for: `dist/skills.js:106`
tells authors to list trigger phrases, and every phrase added lengthens the
denominator and lowers every score for that skill.

**Fix.** This is a similarity measure (Jaccard-style, correct for two texts of
comparable size) used where one text is deliberately a superset of the other.
Use containment: `Math.min`, or divide by `a.length`. With nothing else changed
the right skill ranks first in three of four cases and ties first in the fourth.

**Contributing cause on our side, now fixed.** `dist/loader.js:203` injects only
a skill's name, description, `<location>` and confidence — never the body. Our
own `SYSTEM_SUFFIX` wrongly told the model its skills were "procedures already
in your prompt", so it had no reason to fetch them. Fixed in `e91f891` /
`51f3e65` by injecting the skill body into the question inside a `<skill>`
block. **This does not soften the finding**: the 0-of-16 result is arithmetic
over files with no model or prompt involved, and either cause alone is
sufficient. Disclose it when filing — owning our half makes theirs harder to
wave away.

### 2. "No matching skills found" is stated as fact, and the agent believes it

**Proof.** Two parts of the runtime say opposite things and the wrong one wins.
The system prompt:

```
// dist/skills.js:106
Before attempting ANY task — simple or complex — you MUST
check if an installed skill handles it.
```

The tool result, flat, with no scores and no hedging:

```
// dist/tools/task-tracker.js:182
"No matching skills found. Solve from scratch."
```

Because of defect 1 this fires for *every* question. A specific fact inside a
tool result beats a general instruction in the prompt, so the agent skips its
own skills and looks like it chose to.

**Fix.** Report top candidates with scores — "closest: recent-activity (0.09),
below threshold 0.1" — so a broken matcher is visible instead of invisible.

### 3. One capital letter ends the learning loop, silently

**What happened.** The model closed a task with `{"action":"end","outcome":"Success"}`.
The run was perfect; the loop stopped dead and the answer looked normal.

**Proof.** `outcome` is three exact literals, no trim, no case fold:

```js
// dist/tools/shared.js:42
outcome: Type.Union([ Type.Literal("success"),
                      Type.Literal("failure"),
                      Type.Literal("partial") ])
```

`"Success"` is rejected, the task stays `active`, and the following
`skill_learner` call refuses with "did not succeed (status: active)".

A second, worse version of the same typo is latent where validation is relaxed
or bypassed — an exact comparison that files anything not-`success` as a
failure, including a legitimate `partial`:

```js
// dist/tools/task-tracker.js:221
task.status = outcome === "success" ? "succeeded" : "failed";
```

**These are alternative failure modes of one typo, not sequential ones** — the
schema catches the value before line 221 sees it on any path that validates.
State it that way when filing or a maintainer will (correctly) push back.

A mis-recorded failure is not neutral. `dist/learning/reinforcement.js` is
deliberately asymmetric: failure subtracts a flat **0.2**, success adds
`0.1 × (1 − confidence)` — which at the starting confidence of 1.0 is **exactly
zero**. A newly crystallized skill can only ever move down; five mis-recorded
runs push it under the 0.4 line where `isSkillFlagged` marks it for deletion.

A fourth wrinkle: `adjustConfidence`'s `switch` has **no `default` branch**, so
an unrecognised outcome increments `usage_count` and changes nothing else —
`tasks.json` can say "failed" via the ternary while the skill's own frontmatter
records neither a success nor a failure. The two stores disagree in silence.

**Why it is a design point, not just a bug.** The caller is a language model,
not a person filling a form; casing varies run to run. An exact-match enum with
no normalising assumes a caller that never varies, and when it does the failure
is invisible — the answer looks fine and only the audit log knows.

**Fix.** Lowercase and trim `outcome` and `action` before validating and before
comparing — one line in each place. Every legal value is already lowercase, so
this can only turn an invalid argument into the one the caller plainly meant.
Add a `default` branch that reports an unrecognised outcome rather than
absorbing it.

**Badger's workaround** (`51f3e65`): the `preToolUse` hook lower-cases both
fields for both tools, in the tool layer rather than asking the model to be
careful.

### 4. Nothing can ever become a skill, because steps are never recorded

**What happened.** Half the headline feature had never run. Reinforcement works
and commits; crystallisation had fired **zero** times across 57 tracked tasks,
and all four skills in the repo were hand-written (none carries `learned_from`).

**Proof.** `skill_learner evaluate` judges worthiness from recorded steps —
`multi_step` wants 3, `non_trivial` wants 2
(`dist/tools/skill-learner.js:113–118`). Steps exist only if the model called
`task_tracker action "update"` during the run, nothing enforces that, and after
`"end"` it is too late to add them. Across 57 tasks exactly **one** ever had
three steps, so `evaluate` could never return worthy.

**Fix.** Ask for `update` explicitly in the injected prompt and say what
skipping it costs, or infer steps from the tool calls the runtime already has
in the session.

**Badger's workaround** (`e91f891`): the suffix asks for a one-line step after
each distinct move, and makes "have you called update twice?" a precondition of
calling `end`.

### 5. A duplicate skill passes the duplicate check 4-for-4

**Proof.** Four checks run before saving and **any 3 of 4 passing** is enough
(`dist/tools/skill-learner.js:132`). Only one looks for duplicates, and it
compares *words*, not meaning — Jaccard overlap above 0.5 (line 123).

Worked example. Existing skill: *"Find the expert on any topic by checking who
wrote and reviewed the code."* New 4-step task: *"Identify who knows about
payments by searching commit history and mail threads."* Same job, almost no
shared words after stopword stripping, so the duplicate check **passes**. Four
steps clears both step-count checks; no file paths in the steps clears
generalizable. **4/4 — a perfect score for a duplicate.**

And a *caught* duplicate still wins: 3 of 4 passes without novelty, so the
novelty vote only ever decides the outcome for 2-step tasks — which the
step-count check itself calls not skill-worthy. It is structurally incapable of
blocking the class of duplicate it exists to catch. Confidence scoring cannot
recover it later: that measures "does this skill work when used", and a
duplicate works fine forever.

Also note `evaluate` is optional, `override_heuristic` skips it entirely, and
`crystallize` — the step that actually writes the file — checks only that the
task succeeded.

**Fix.** Make novelty a hard gate on `crystallize` and compare meaning rather
than words; at minimum show the model the nearest existing skills and require an
explicit justification to save alongside them.

### 6. Every agent is ordered to call a tool it may not have, with no off switch

**What happened.** Badger is read-only, so the two writing tools were removed
via `allowedTools`. The agent then answered users with "I cannot access
`task_tracker`" and never did the work. Three eval questions failed this way
before the cause was found — it looked like model timidity for two days.

**Proof.** Pushed into every agent's system prompt unconditionally — no manifest
key, no config, no gate:

```
// dist/loader.js:250
# Task Learning & Skill Discovery
1. FIRST: Call `task_tracker` action "begin" with your objective
IMPORTANT: Do NOT skip step 1.
```

**Fix.** A manifest key — `learning: off` — so the repo is the whole truth about
what the model reads. Same for the workspace-directory block, dead advice for a
read-only agent. The only lever today is `systemPromptSuffix`
(`dist/sdk.js:122`), which is one instruction arguing with another.

> **Note, 2026-08-19:** Badger's original response — deleting both tools —
> was reversed on Alan's direction. `task_tracker` and `skill_learner` write to
> the agent's *own repo*, never to a source, so they were never on the wrong
> side of the read-only boundary. The suffix now steers the loop instead of
> denying it.

---

## Configuration and safety

### 7. The spec's own field name produces a tool that never loads

Overlaps `docs/UPSTREAM.md` §2, which has the fuller reproduction.

```js
// dist/tool-loader.js:68
const scriptPath = join(agentDir, "tools", def.implementation.script);
```

The spec says `implementation.path`; the runtime reads `implementation.script`.
A file missing a required key is skipped inside a bare `catch {}` — no error, no
warning. The path also resolves under `tools/`, so `scripts/x.mjs` means
`tools/scripts/x.mjs`, which is undocumented.

**Fix.** Accept both keys, and make `validate` report a tool file it could not
load instead of dropping it.

### 8. Broken configuration fails silently in four different ways

**What happened.** With an empty `GITHUB_TOKEN` the agent started normally with
**zero sources** and answered as if it had searched. For a search product that
turns "the source is down" into a confident "I found nothing".

**Proof.** Four measured paths: a dead MCP server logs one stderr line and the
agent starts without it; an unset `${VAR}` substitutes an empty string and
connects anyway; a skill listed in `agent.yaml` but missing on disk loads
nothing and warns nothing; a malformed tool YAML is swallowed by `catch {}`.

**Fix.** Fail loudly at startup, or at minimum tell the *model* which sources
are live. An agent that knows it is blind can say so; today it cannot know.

**Badger's workaround.** `hooks/check-sources.sh` on `on_session_start` refuses
to start when a declared source has no credential.

### 9. Hooks fail open — a broken guard grants permission

Overlaps `docs/UPSTREAM.md` §6, which adds that `hooks.schema.json` defines
`fail_open` and defaults it to `false` — so the schema and the runtime disagree.

```
// dist/hooks.js
line  84 — if hook doesn't return JSON, treat as allow
line  92 — timeout: allow
line 106 — "Hook errors don't block execution by default"
line 109 — default return { action: "allow" }
```

A typo, a missing dependency or a slow disk turns a security control off without
a word. Badger's hooks are dependency-free POSIX `sh` that always exit 0 with
printed JSON purely to dodge this — never add a `jq` dependency.

**Fix.** Honour the schema's `fail_open: false`, or let the hook declare
`on_error: block`.

### 10. You cannot check the agent's answer before it reaches the user

```js
// dist/index.js:122
runHooks(hooksConfig.hooks.post_response, agentDir, {
    event: "post_response",
    session_id: sessionId,
}).catch(() => { });
```

Two independent blockers: it is not awaited and its result is discarded, running
after the text is already written out — so it cannot block or modify; and the
payload is only `{event, session_id}`, so the hook never receives the response
text and has nothing to inspect. The SDK's `options.hooks.postResponse` is the
same.

**Fix.** Pass the response text and await the result, as `pre_tool_use` already
does. Until then document `post_response` as a notification, not a control.

**Badger's workaround.** Citation verification lives in the SDK caller, the one
place holding both the tool outputs and the final answer.

### 11. The docs describe a build that does not exist, and the CLI edits your repo

**Proof.** `grep -ri composio dist/` on 2.1.0 returns nothing while the docs
describe connecting services through a Composio integration. The site shows
`spec_version: 0.4.0` and harness v1.5.0; the spec repo and every published
agent say `0.1.0`, and npm ships 2.1.0. The registry's own example shows
`gitagent run -d ./x` — there are no subcommands, so that sends the word "run"
as the prompt.

Separately, every invocation scaffolds and auto-commits into the current
directory before parsing arguments, with no flag to stop it.

**Fix.** Version the docs against the published package, and add a
`--no-commit` / `--dev` flag that never scaffolds and never commits into a repo
with staged human changes.

**Badger's workaround.** `scripts/badger.sh` records HEAD, runs the agent, then
soft-resets commits it does not recognise, aborting if it sees an unfamiliar one.

---

## Scheduling and workflows

Both found on 2026-08-21 while building Badger's scheduler. They are the same
shape as finding 5 in `docs/UPSTREAM.md` — specified, schema'd, exported, and
in one case never called by anything.

### 12. `workflows/` is a schema and a prompt paragraph, not an engine

**What the spec promises.** `workflow.schema.json` gives a workflow `steps`,
`depends_on`, `${{ steps.x.outputs.y }}` expressions, conditions and
`error_handling.escalation_target`, and
`examples/full/workflows/regulatory-review.yaml` reads like an orchestration
engine — multi-step, dependency-ordered, with escalation.

**What the runtime does.** `dist/workflows.js` is 134 lines. It lists the
files and injects a block into the system prompt:

```js
// dist/workflows.js:133
return `# Workflows\n\n<available_workflows>\n${entries}\n</available_workflows>\n\n
Use the \`read\` tool to load a workflow's full definition when you need to follow it.`
```

There is no step runner, no dependency resolution and no expression
evaluation anywhere in `dist/`. `loadFlowDefinition` and `saveFlowDefinition`
are exported from the package root and have **zero callers** — the only
mentions in the whole of `dist/` are their own definitions and the export
line. The prompt block also advertises a trigger that nothing implements:

```js
// dist/workflows.js:125
`SkillFlows can be triggered with @flow_name in chat (e.g. ${...})`
```

Grepping `dist/` for anything that parses an `@name` out of a prompt returns
nothing. So the model is told a mechanism exists, and if it uses it the text
goes to the model as an ordinary sentence.

**Why it matters more than it sounds.** A workflow is therefore exactly what a
skill already is — a markdown procedure the model may choose to read — while
looking, in the spec and the examples, like a guarantee about execution order.
That is the confidently-wrong-indicator trap: a reader who writes
`depends_on` believes something enforces it.

**Fix.** Either implement the engine or shrink the schema to what the runtime
honours (`name`, `description`, prose) and drop the `@flow_name` sentence.
Until then, `validate` should warn on any workflow key the runtime ignores.

**Badger's decision.** Not built on. Badger's scheduler drives the agent
directly and its procedures stay in `skills/`, which is the same mechanism
without the promise.

### 13. The scheduler is complete, exported, and started by nothing

`dist/schedules.js` and `dist/schedule-runner.js` are real and work — a
schedule is `schedules/<id>.yaml`, `executeScheduledJob` dedupes, logs to
JSONL and stamps `lastRunAt` back into the file. Both are exported from the
package root.

**Nothing in the runtime ever calls `startScheduler`.** Grepping all of
`dist/` returns three lines: the export, the definition, and `reloadSchedules`
calling it. Neither the CLI nor the bundled web UI starts it. So an agent
directory can contain a perfectly valid schedule that never fires, with
nothing anywhere reporting that.

**Two smaller things inside it.** The model is cron-only with no extension
point, and there is no cron for "every 3 days" — a step of 3 on the day field
restarts at each month boundary. And **any key not on the fixed list is
silently dropped, on read and on write**: `discoverSchedules` and
`saveSchedule` both build a fresh object from the same nine keys, so a field
added to the YAML disappears the next time anything saves.

**Fix.** Start the scheduler when the runtime is long-lived, or document
plainly that scheduling is a library for embedders. Preserve unknown keys, or
say that the file is owned by the runtime.

**Badger's decision.** Used as intended — as a library. Badger is the embedder:
`app/server/scheduler.mjs` calls `executeScheduledJob` with its own
`runPrompt`, triggered by one Cloud Scheduler job rather than an in-process
cron, because Cloud Run scales to zero and an in-process cron would never
fire. The dropped-key behaviour is why `writeSchedule` carries `lastRunAt` and
`lastResult` through every save by hand, with a test pinning it.

## Build-time proposals (not defects — gaps in the guidance)

The framework documents how a finished agent *runs*. It says nothing about the
build-time situation: a person, usually with an AI harness, developing the agent
inside the very repo the runtime also writes to. Four cheap additions:

1. **A builder contract.** State which files belong to the author
   (`SOUL.md`, `RULES.md`, `skills/`, `knowledge/`) and which belong to the
   agent (`memory/`, `tasks.json`, learned skills). Nothing today tells a
   builder that `memory/` is the agent's own notebook — hand-writing
   `MEMORY.md` during development is the natural mistake, and seeded facts
   belong in `knowledge/`. Publish it machine-readably, since agents are
   increasingly built *by* harnesses.
2. **A development mode.** `--dev` / `--no-commit`: don't scaffold unless
   asked, don't commit runtime state, never touch a repo with staged human
   changes.
3. **Fail loud at build time.** Make `gitagent validate` cross-check the
   manifest against disk — every declared skill exists, every tool YAML parses,
   every `${VAR}` is documented — and recommend it as a pre-commit step.
4. **Manifest knobs for injected behaviour.** `learning: off`,
   `workspace: off`, so what the builder wrote in the repo is the whole story of
   what the model reads.
