# Where Badger diverges from the standard, and why it is not Badger's fault

Badger is built on GAP, so the first honest question is: does it actually
conform? The standard ships a validator, so this is measurable rather than
arguable.

```
npm run validate    # opengap validate --compliance
npm run audit       # opengap audit
```

Today that reports:

```
✓ agent.yaml — valid
✓ SOUL.md — valid
✓ hooks/hooks.yaml — valid
✗ skills/ — invalid
✗   skills/find-expert/SKILL.md frontmatter /: must NOT have additional properties   (×5)
✗   skills/onboard-to-project/SKILL.md frontmatter /: must NOT have additional properties   (×5)
✗   skills/trace-decision/SKILL.md frontmatter /: must NOT have additional properties   (×5)

Compliance Validation
✓ Compliance configuration — valid

✗ Validation failed: 15 errors, 23 warnings
```

Everything that is ours passes. All 15 errors and 10 of the 23 warnings are
two divergences **between the reference runtime and the published spec**, both
reproduced below from a clean two-file agent that has nothing to do with
Badger. Of the rest, ten are Badger's own tool naming — explained in the README
— and three are the separation-of-duties roles `DUTIES.md` deliberately leaves
unassigned.

A note on the packages, because it took a while to work out. The runtime is
`@open-gitagent/gitagent@2.1.0`; the standard's reference CLI is now
`@open-gitagent/opengap@0.5.0`, published 2026-07-02, which installs the
`gitagent` command as an alias. They are different codebases with different
version lines, and where they disagree, this document records which one.

---

## 1. Using the learning loop makes your agent fail the validator

**Severity: this is the framework's headline feature invalidating its own
standard.** GAP's pitch is an always-learning agent whose skills are
version-controlled files. Run that loop once and the files stop conforming.

### Reproduction

A minimal agent — `agent.yaml`, `SOUL.md`, and one skill whose frontmatter is
exactly what the Agent Skills standard specifies:

```yaml
---
name: demo-skill
description: A skill written exactly as the Agent Skills standard specifies
---
```

```
$ opengap validate
✓ skills/ — valid
✓ Validation passed (0 warnings)
```

Now let the runtime record **one successful use** of that skill — which is what
happens whenever the model passes `skill_used` to `task_tracker end`:

```js
import { loadSkillStats, adjustConfidence, saveSkillStats }
  from "@open-gitagent/gitagent/dist/learning/reinforcement.js";
await saveSkillStats(dir, adjustConfidence(await loadSkillStats(dir), "success"));
```

The file is now:

```yaml
---
name: demo-skill
description: A skill written exactly as the Agent Skills standard specifies
confidence: 1
usage_count: 1
success_count: 1
failure_count: 0
negative_examples: []
---
```

```
$ opengap validate
✗ skills/ — invalid
✗   skills/demo-skill/SKILL.md frontmatter /: must NOT have additional properties   (×5)
✗ Validation failed: 5 errors, 0 warnings
```

### The two sides

- `learning/reinforcement.js:82-86` writes `confidence`, `usage_count`,
  `success_count`, `failure_count` and `negative_examples` at the **top level**
  of the frontmatter.
- `spec/schemas/skill.schema.json` adopts the Agent Skills standard
  (agentskills.io) verbatim: `name`, `description`, `license`,
  `compatibility`, `allowed-tools`, `metadata`, and `additionalProperties:
  false`.

### Why moving them under `metadata` does not fix it

The obvious repair is to nest the stats under `metadata`, which the schema
allows for extensions. It does not work, for two independent reasons:

1. `metadata` is typed `additionalProperties: {"type": "string"}`. Four of the
   five values are numbers and the fifth is an array.
2. `skills.js:67-74` and `reinforcement.js:66-72` both read the stats from the
   top level. Move them and the runtime reads its defaults instead — every
   skill silently resets to `confidence: 1.0` — and then writes them back to
   the top level on the next use.

So there is no arrangement of a SKILL.md that both satisfies the schema and
survives the learning loop. **This is not fixable downstream**, which is why
Badger's three used skills are still failing and why we have not "fixed" them
by hand.

### What would fix it upstream

Either add the five keys to `skill.schema.json` (they are already a de facto
part of the format — `skills.js` parses them and `formatSkillsForPrompt` puts
`confidence` in the system prompt), or relax `metadata` to accept non-string
values and change `reinforcement.js` to read and write there.

The first is smaller and matches what the runtime already does.

### The tell

Badger has four skills and only three of them fail. The fourth,
`recent-activity`, has never been used — so the loop has never written to it.
The errors appear exactly where the framework has been working.

---

## 2. A spec-valid tool is invisible to the runtime, silently

**Severity: silent.** No warning, no error, no log line. The tool simply is not
there, and the model reports that it cannot do the thing.

### Reproduction

A tool file written exactly as `spec/schemas/tool.schema.json` requires:

```yaml
name: echo-thing
description: A tool written exactly as spec/schemas/tool.schema.json requires
input_schema:
  type: object
  properties:
    text: { type: string, description: text to echo }
  required: [text]
implementation:
  type: script
  path: echo-thing.mjs
  runtime: node
```

```
$ opengap validate
✓ tools/echo-thing.yaml — valid
```

```js
import { loadDeclarativeTools } from "@open-gitagent/gitagent/dist/tool-loader.js";
await loadDeclarativeTools(dir);
// → tools registered: 0  []
```

### The two sides

- `tool-loader.js:177` requires `def.implementation.script` and skips the file
  otherwise — inside a `try/catch` that swallows the skip without a message.
- `spec/schemas/tool.schema.json` requires `implementation.type`, names the
  script path `path`, and sets `additionalProperties: false` — so adding
  `script:` alongside `path:` to satisfy both makes the file spec-invalid.

The two shapes are mutually exclusive. There is no tool YAML that is both
valid and loadable.

### What Badger does

Badger's ten tools carry **both** spellings: `type` and `path` for the schema,
`script` for the loader. A tool that validates and does not exist is worse than
a tool that exists and warns, so `script` is the one that cannot be dropped —
but everything else the schema asks for is supplied, which satisfies all three
of its conditional branches and leaves exactly one unavoidable error per file:

```
!   /implementation: must NOT have additional properties
```

That is the whole of the deadlock, stated once per tool. Supplying the schema's
keys alongside the loader's took the warning count from 103 to 23 and changed
nothing at runtime — `tool-loader.js:177` tests only for `script`, and
`createDeclarativeTool` (`:68`) reads only `.script` and `.runtime`.

The remaining ten warnings are `/name: must match pattern "^[a-z][a-z0-9-]*$"`.
**That one is ours, not the runtime's**, and it is explained in the README
rather than here: `docs/UPSTREAM.md` is for defects in the standard and its
runtime, and a tool named `github_search` on an agent whose spec says
kebab-case is Badger's own deliberate choice, not somebody else's bug.

### What would fix it upstream

Accept `path` as an alias for `script` in `tool-loader.js`, and log the skip
rather than swallowing it. A tool file that is present, parseable, and silently
ignored is the worst of the three outcomes.

---

## 3. The learning ledger races against the model's own parallel tool calls

**Severity: silent data loss, in the feature the framework is named for.**

`task_tracker` and `skill_learner` share one file, `.gitagent/learning/tasks.json`,
and both read it whole, mutate the object and write it back whole
(`task-tracker.js:8-22`, `skill-learner.js:7-16`). There is no lock, no
compare-and-swap, and no append.

That is safe for a human typing one command at a time. It is not safe for the
caller these tools actually have: a model that issues several tool calls in a
single turn. Gemini batches routinely, and the agent loop runs the batch
concurrently.

### What it looks like when it goes wrong

One run, from the audit log, in the order the events actually landed:

```
CALL  task_tracker {"action":"update","step":"Drafted the reply…"}
CALL  task_tracker {"action":"end","outcome":"success"}
CALL  skill_learner {"action":"evaluate","task_id":"e294a75f-…"}

  -> end:      Task e294a75f-… completed successfully (1 steps).
  -> update:   Step 2 recorded: Drafted the reply…
  -> evaluate: Task not found: e294a75f-…
```

Three things wrong in three lines. `end` scored a task that had two steps as
having one, because the second had not been written yet. `update` then wrote
its copy of the store back over `end`'s, undoing the close. And `skill_learner`
read a store in which the task no longer existed at all — for an id that had
been valid seconds earlier.

The consequence is not an error the user sees. The answer was written and
delivered normally. What was lost was the record: a task that did the work,
recorded its steps and would have been evaluated, scored as trivial and then
vanished.

### Why it bites this feature specifically

`skill_learner` decides worthiness from the step count — `multi_step` wants 3
and `non_trivial` wants 2. So a race that drops a single step is the difference
between a skill being created and the run being dismissed as trivial. The
feature's own gate is the thing most sensitive to the corruption.

### What would fix it upstream

Serialise the writes. The smallest version is an in-process promise chain
around load/save, since both tools live in the same process; a more robust one
writes to a temporary file and renames, or appends events rather than rewriting
a document. Any of the three removes the class.

### What Badger does meanwhile

Instructs the model, in `SYSTEM_SUFFIX`, to issue these two tools one at a time
and never in the same batch as each other. Search and read tools still run in
parallel, because they hold no shared state. It is a mitigation and not a fix —
the race is still there for anyone who batches — which is why it is written up
here.

## 4. `query().abort()` does not abort anything

**Severity: silent, and it undercuts a compliance claim.** No error. The call
returns, the caller believes the run is stopped, and the run continues to
`maxTurns` — spending model and API budget into a socket nobody is reading.

### Reproduction

Three greps against the shipped `dist/`, no run required:

```
$ grep -n '\bac\b' dist/sdk.js
63:    const ac = options.abortController ?? new AbortController();
537:            ac.abort();

$ grep -c signal dist/sdk.js
0

$ grep -n 'abort()' node_modules/@mariozechner/pi-agent-core/dist/agent.js
194:    abort() {
195:        this.activeRun?.abortController.abort();
```

An `AbortController` is created at `sdk.js:63` and aborted at `sdk.js:537`. Its
`signal` is never read: the string does not occur in the file. It is passed
neither to `new Agent({...})` (`sdk.js:256`) nor to `agent.prompt()`
(`sdk.js:446`), and no `AbortSignal` reaches the provider call. Meanwhile the
underlying `pi-agent-core` `Agent` carries a working `abort()` that cancels the
active run — `sdk.js` holds the agent instance and never calls it.

So `query().abort()` is a no-op in 2.1.0.

### Why this one matters more than it looks

It is the only stop control the SDK surface offers, so any agent with a stop
button in its UI has a stop button that lies. And it is the natural thing to
cite for `compliance.supervision.kill_switch`, which `opengap audit` prints as
a green tick without checking that anything is behind it — a control that
validates, reports as present, and does nothing.

### What Badger does

`app/server/server.mjs` calls `run.abort?.()` on client disconnect anyway, so
the code is correct the day the runtime is, and releases the concurrency slot
in the same handler — which is the half that works and was the real defect it
was written for. `agent.yaml` rests `kill_switch` on the daily answer ceiling
and the per-run turn bound instead, and says so in a comment.

### What would fix it upstream

One line: pass `ac.signal` through to the agent run, or have `generator.abort()`
call the agent's own `abort()`. The mechanism already exists one layer down.

---

## 5. Smaller notes, recorded but not worth an issue

- **`annotations.read_only` is read by nothing.** The spec defines it
  (§8) and `tool-loader.js` never mentions the block. Badger sets it anyway,
  as a declaration rather than an enforcement, and says so in the tool files.
- **`hooks` fail open.** `hooks.schema.json` defines `fail_open` and defaults
  it to `false`; `hooks.js` swallows every error, treats non-JSON output as
  allow, and treats a timeout the same way. Badger's hooks are therefore
  dependency-free POSIX `sh` that always exit 0 with valid JSON — a hook that
  cannot fail does not need the runtime to agree about what failure means.
- **`runtime.max_turns` is not read** by 2.1.0; only the caller's bound
  applies.
- **`agents/` and read-only are mutually exclusive.** Sub-agent delegation is
  not a runtime mechanism at all: `formatSubAgentsForPrompt`
  (`agents.js:80`) emits the instruction *"To delegate to a sub-agent, use the
  `cli` tool to run: `gitagent --dir {agent_path} -p ...`"*. It is a shell-out.
  Any agent that withholds `cli` — which every read-only agent must — has an
  `agents/` directory the model is told to reach through a tool it does not
  hold. Badger declines `agents/` for that reason as much as for the cost.
- **`agent.yaml: skills:` is a filter, not a list.** `loader.js:194` treats it
  as an allowlist, so naming your skills there silently drops every skill the
  agent later learns or a person adds. Badger deliberately omits the key.
- **`compliance` keys disagree between runtime and spec.** `compliance.js`
  reads `risk_level`, `data_classification` and `human_in_the_loop` at the top
  of the block; the schema defines `risk_tier`,
  `data_governance.data_classification` and `supervision.human_in_the_loop`.
  Badger uses the spec's spelling, because those three keys feed only
  `validateCompliance()`, whose warnings are printed on the CLI path and never
  read on the SDK path — so the spec's spelling costs nothing. The one key with
  behaviour behind it, `recordkeeping.audit_logging`, is spelled the same in
  both.
- **`AuditLogger` is only wired into the CLI.** `sdk.js` never touches
  `audit.js`, so an agent declaring `audit_logging: true` and running through
  the SDK logs nothing. Badger reimplements it in `app/server/audit.mjs`,
  same file and same JSONL shape, so CLI and SDK runs interleave into one log.
