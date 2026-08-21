# Scheduler and Executions — plan

**Delete this file once the work is done.** It is a handoff, not
documentation. What survives belongs in the code, in `git log`, and in
`docs/FRAMEWORK-DEFECTS.md`.

Agreed with Alan on 2026-08-21. Nothing here is built yet.

---

## What this is

An agent can run on its own on an interval, and there is a record of every run
you can open and read. Read tools only: a schedule is a saved question and the
output is an answer you come and read. No write tools, no notification, no
retries.

**Exactly one schedule per agent**, and only sub-agents have them — schedules
live in `agents/<slug>/schedules/`, and Badger itself has no agent page to hang
the UI off.

---

## What the framework gives us, and what it does not

Read from the installed `@open-gitagent/gitagent@2.1.0` `dist/` on 2026-08-21,
not from the docs.

**`dist/schedules.js` and `dist/schedule-runner.js` are real and complete**, and
both are exported from the package root. A schedule is
`schedules/<id>.yaml` in the agent directory with `id`, `prompt`, `cron`,
`mode`, `runAt`, `enabled`, `createdAt`, `lastRunAt`, `lastResult`.
`executeScheduledJob()` dedupes a job against itself, calls a `runPrompt`
callback you supply, appends a JSONL log under
`.gitagent/schedule-logs/<id>.jsonl`, and stamps `lastRunAt` / `lastResult`
back into the YAML.

**Nothing in the runtime calls `startScheduler`.** Grepped all of `dist/`: the
only references are the two export lines. The CLI does not start it and neither
does the bundled web UI. It is a library for embedders, and Badger is the
embedder. Using it is using the framework as intended, unlike the git case
where there was no mechanism and `AGENT.saveEdit` had to be written.

**`workflows/` is not what it looks like — do not build on it.** The GAP spec
gives it a `workflow.schema.json` with `steps`, `depends_on`,
`${{ steps.x.outputs.y }}`, conditions and `error_handling.escalation_target`,
and `examples/full/workflows/regulatory-review.yaml` reads like an
orchestration engine. There is no engine. `dist/workflows.js` lists the files
and injects a block into the system prompt saying "use the `read` tool to load
a workflow's full definition when you need to follow it". No step runner, no
dependency resolution, no expression evaluation. `loadFlowDefinition` and
`saveFlowDefinition` have **zero callers anywhere in `dist/`**, and the prompt
advertises an `@flow_name` trigger that nothing implements. Same class as
`delegation` and `a2a` in `docs/FRAMEWORK-DEFECTS.md` — specified, schema'd,
not implemented. A workflow is a markdown procedure the model may choose to
read, which is what `skills/` already is for us. **Add it as a finding; do not
build on it.**

**The schedule model is cron-only, and there is no extension point.** There is
nowhere to put "every 3 days", and cron cannot express it: `*/3` on the day
field resets at each month boundary, so it would fire on the 1st, 4th, 7th and
then the 1st again. Both `discoverSchedules` and `saveSchedule` build a fresh
object from a fixed key list, so **any extra key in the YAML is silently
dropped on read and on write**.

Alan's call, and it is the right one: **bend the UI to cron and use the
framework's store unchanged.** Owning the file format would have meant a third
lookalike store beside `agents-store.mjs` and `skills-store.mjs` for the sake
of "every 3 days". Worth a finding, not worth a fork.

---

## The interval options, and the anchor

Every schedule is anchored to **the next 15-minute mark after it was created**,
and the cron is generated from that anchor. Created at 16:35 on the 21st gives
an anchor of 16:45:

| Choice | Cron |
|---|---|
| every 15 minutes | `*/15 * * * *` |
| every 30 minutes | `15,45 * * * *` |
| every N hours (1, 2, 3, 4, 6, 8, 12) | `45 */N * * *` |
| every 1 day | `45 16 * * *` |
| every N months (1, 2, 3, 4, 6) | `45 16 21 */N *` |

The dropdown offers exactly those values and nothing else. Every one of them is
faithfully expressible in cron, which is the whole point of restricting the
list.

**The anchor is what makes the info banner literally true** rather than
approximately true, for every unit including days and months. Without it,
"every 30 minutes" created at 16:35 would first run at 17:00 while the banner
promised 16:45.

The 15-minute minimum enforces itself: the smallest option is `*/15`.

---

## What triggers a run

**One Cloud Scheduler job, `badger-tick`, `*/15 * * * *`, posting to
`POST /api/schedules/tick`.** It is created once and never changes for the life
of the product, whatever schedules users create or delete.

**Why a tick rather than one Cloud Scheduler job per schedule.** Cloud Run runs
`--max-instances 1` with no `min-instances`, so it scales to zero and an
in-process `node-cron` never fires. `min-instances 1` is ~$12/month and off the
free tier, so that is out. Of the two remaining shapes:

- One job per schedule fires at the exact minute, but our server would have to
  create and delete Google Cloud resources at runtime. That needs an IAM role
  that writes to our own infrastructure, granted to a service account whose
  entire story is that it only reads. And the schedule would then exist in two
  places that can disagree — delete an agent and its YAML goes while the cloud
  job keeps firing. That is the same one-fact-stored-twice generator that gave
  us the skill-origin bugs, and the reason `agent` is a column rather than
  something packed into the chat id.
- One tick job means the files are the only truth. Add, edit, delete, disable,
  rename an agent: all of it is a file changing, and the infrastructure never
  knows.

The free tier is **3 jobs**, where a job is a timer entry, not a run — a job
fires as often as its cron says at no extra cost. The tick uses 1 of the 3
forever and supports any number of schedules. Per-schedule jobs would have
capped us at 3 free schedules.

Cost is not the argument; both are effectively free. The argument is that the
tick needs no write credential and cannot drift.

Side benefit: the instance is more often warm when a reviewer opens the
product.

### The endpoint has to sit outside the passphrase gate

Cloud Scheduler cannot hold a session cookie. `POST /api/schedules/tick` takes
a shared secret in a header, held in Secret Manager as `badger-tick-secret` and
compared **constant-time**, the same way `auth.mjs` compares the passphrase.
The route is matched before the cookie check.

**This is a sixth secret, and `--set-secrets` REPLACES the whole set.** Update
the deploy command in CLAUDE.md in the same breath, or the deploy that ships
this silently drops `BADGER_AGENT_REPO_TOKEN` and `DATABASE_URL` and kills repo
mode and Postgres together. Derive the command from
`gcloud run services describe badger --region us-central1 --format=json`
rather than from any command written down.

### Run now

A **Run now** button on the modal fires the same code path with no waiting. It
exists so the feature is demonstrable in the video and testable in one session
rather than in fifteen-minute increments.

---

## How the tick decides what is due

Every cron we generate fires only on 15-minute boundaries. So the tick walks
the 15-minute slots between the schedule's `lastRunAt` and now, capped at **24
hours back**, and fires **once** if any slot matched.

The cap is what stops a redeploy or a missed tick from firing five times to
catch up. Firing once on return is the honest behaviour for a digest: you want
the current answer, not four stale ones.

Field matching against `*`, `*/N` and a literal list is about 30 lines, and it
is unit-testable with no model call, no network and no database. Write those
tests first — this is the part that will be wrong in a way nobody notices for a
week, because a scheduler that fires slightly too rarely looks like nothing at
all.

`node-cron` is not used for matching. It has no next-run or prev-run API, and
`startScheduler` is not called, so it never enters the picture. It stays a
transitive dependency of the runtime.

---

## What runs it

`executeScheduledJob()` from the framework, unchanged, with `runPrompt` being
`handleAsk` minus the SSE. `broadcastToBrowsers` and `appendToHistory` are
no-ops on this path.

A scheduled run **claims an answer slot** exactly like a typed question. If the
daily budget is gone the run is recorded as failed saying so, rather than
silently not happening. A schedule that quietly ate the day's budget before a
reviewer asked anything would be worse than one that visibly failed.

After a schedule is created, edited or deleted, call **`AGENT.saveEdit()`**,
exactly as the agent and skill write routes do. In repo mode `AGENT.agentDir`
is a clone under `tmpdir()` and the instance recycles after a few minutes of
quiet, so without it the schedule is gone before anyone comes back to it.

The framework's JSONL log lands under `.gitagent/`, which is gitignored. It is
incidental. **Postgres is the durable record.**

---

## Where executions live

A new table, `schedule_run`:

| column | |
|---|---|
| `id` | |
| `agent` | slug |
| `schedule_id` | for when one-per-agent stops being true |
| `triggered_at` | the exact trigger time |
| `finished_at` | |
| `status` | `success` / `error` |
| `input` | the prompt as it ran |
| `result` | jsonb: answer, step trail, citations, cost |
| `error` | |

**Not a `chat_session`.** An execution is a record you read, not a conversation
you continue. Putting them in the sessions table means every scheduled run has
to be filtered out of two other lists forever, and a run that failed before
producing anything still needs a row — which is exactly what the status column
is for.

The detail view reuses the existing answer and step-trail components, so an
unverified citation or a refusal is as visible in an execution as it is in
chat.

---

## The UI

Agent page tabs become **Build | Playground | Executions**. Routes follow the
existing shape: `/agents/:slug/executions` and `/agents/:slug/executions/:id`.

A **Schedule** action in the page header opens the modal.

**The modal** is Alan's mock minus the tab strip and minus retries. Max retries
and retry delay are deliberately gone: without write tools there is nothing
partial to recover, and a failed run just shows as failed and waits for the
next interval.

- An interval number field with the unit dropdown on the right (minutes /
  hours / days / months), offering only the values in the table above.
- A large prompt field, so what will be executed is obvious.
- An info banner naming the **actual** first run time, computed from the
  anchor: "First run at 4:45 PM".
- Create.

After creating, it swaps to a confirmation line linking to the Executions tab.
Reopening it on an agent that already has a schedule shows that schedule with
its next run, an enable toggle, Run now, and Delete.

**Executions** is a table of trigger time and status, newest first. Clicking a
row opens the detail: trigger time, status, input, output.

---

## Order of work

1. The cron generator and the due-slot matcher, with tests. No server, no UI.
2. `schedules-store` wrapper over the framework's four functions, plus
   `saveEdit` on every write. Tests against a real temp git repo, as
   `agent-repo-commit.test.mjs` does.
3. The `schedule_run` migration and its read/write functions.
4. `POST /api/schedules/tick` and the shared secret, plus the agent CRUD routes
   for the schedule itself.
5. The modal, the Executions tab, the detail view.
6. Deploy once, with the corrected `--set-secrets`, then create the Cloud
   Scheduler job.

Steps 1 to 4 are testable with no model call and no deploy. Do not start the UI
before the matcher has tests.

---

## Open, and deliberately

- **Timezone.** The server is UTC; the browser is not. The banner and the
  Executions table should render in the viewer's local time, and the YAML
  stores UTC. Decide before the modal is built, not after.
- **A deleted agent orphans its `schedule_run` rows**, the same way it already
  orphans its `chat_session` rows. Same fix, whenever that one is made.
- **Nobody has run a sub-agent end to end yet.** That is still Alan's to do,
  and it gates this: a schedule is a sub-agent answering a question with no
  human watching, so a sub-agent that cannot answer one with a human watching
  will fail invisibly here.
