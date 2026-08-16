# Badger

Glean-style workplace search agent, built on the GAP standard (gitagent.sh).
Submission for a hiring task.

## The task, as given

> Use https://www.gitagent.sh/ to build a Glean equivalent. Your ability to do
> your own research, understand the agent framework, visualize good designs,
> build, and host the agent will be critical for us to evaluate.

So the evaluation is on five axes, not one: **research, framework
understanding, design, build, hosting.** Anything that only moves "build"
forward is underweighting four fifths of the grade.

## Architecture — decided, do not redesign

- **Built on GAP.** The agent *is* a git repo: `agent.yaml`, `SOUL.md`,
  `RULES.md`, `skills/`. Identity and behaviour are version-controlled files.
- **Federated search, no indexing.** Live queries to Gmail, Google Drive and
  GitHub via their MCP servers at ask-time. No crawler, no index, no copy of
  user data. This is the product thesis and the main departure from Glean.
- **Read-only, everywhere.** Search and retrieval tools only. Never send,
  write, edit, delete or share. See `RULES.md`.

## Phases

1. **Runtime + scaffold** — done. See "Session log".
2. **MCP wiring + skill prompts** — next. Credentials, `pre_tool_use` deny
   hook, the five skills in `skills/`.
3. **Custom search + chat UI.**
4. **Hosting on a VPS.**
5. **One scheduled digest agent.**

Do not pull later phases forward.

## Git policy

The history is part of the deliverable. For a submission whose thesis is *the
agent is a git repo*, `git log` is the first thing a reviewer reads. Write
commit messages like changelog entries — what changed and why, not "wip".

**Always run Badger through `./scripts/badger.sh`, not `gitagent` directly.**
The runtime auto-commits on every invocation and there is no flag to disable
it: `ensureRepo()` emits "Scaffold gitagent agent" and the web UI emits
"auto-save before new chat". Nine such commits accumulated in the first
session. The wrapper records HEAD, runs the agent, then soft-resets the
runtime's commits so their file changes survive as staged work and a human
writes the real message. It deliberately leaves `memory` and `skill_learner`
commits alone, since those carry meaningful messages, and it aborts the cleanup
entirely if it sees any commit it does not recognise.

If noise accumulates anyway, squash **per milestone** — at phase boundaries,
not continuously. The safe sequence, which was used to create the baseline:

    git branch backup-pre-squash
    git reset --soft $(git rev-list --max-parents=0 HEAD)
    git commit --amend -F <message-file>
    git diff backup-pre-squash          # must be empty
    # compare `git rev-parse HEAD^{tree}` against the backup's tree too

Two independent checks, then delete the backup. Never rewrite history without
that branch existing first.

## Working notes

`NOTES.md` holds everything verified about gitagent 2.1.0 — MCP config shape,
tool namespacing, the absent tool allowlist, silent failure modes, CLI
gotchas, the bundled web UI. Read it before touching `agent.yaml` or writing a
skill. It records the shipped code's behaviour where that differs from the
published docs, which it does in several places.

Three things from it that change how you work in this repo:

- **`gitagent` scaffolds an agent into whatever directory you run it from**,
  before parsing arguments. Always pass `-d`.
- **There is no tool allowlist and `tools:` in `agent.yaml` is ignored.** Every
  MCP tool a server exposes gets registered, and `cli` (a shell) is always
  loaded. Read-only is enforced by `hooks/allow-read-only.sh` — an explicit
  allowlist of exact tool names in `hooks/allowed-tools.txt`. Adding a source
  in phase 2 means adding its read tools there, or Badger cannot call them.
  That friction is the design: unknown tools fail closed.
- **Model ids must be `provider:model` and known to the runtime.** Unknown ids
  crash with an unrelated-looking `baseUrl` error. `anthropic:claude-opus-4-6`
  works; `anthropic:claude-opus-5` does not.

## Model

`google:gemini-3-flash-preview`, fallback `google:gemini-flash-latest`, via a
Google AI Studio key in `.env` as `GEMINI_API_KEY`. Both keep the 1M context
window that federated search needs — one query pulls back whole threads and
documents from three sources at once.

Two traps, both live-verified:

- The `google:` prefix is load-bearing. The same ids exist under the
  `github-copilot` provider; only `google:` routes to AI Studio.
- **A model resolving in the runtime's registry does not mean your key can call
  it.** `gemini-2.5-pro`, `gemini-2.5-flash` and `gemini-3-pro-preview` all
  load fine and then 404 as closed to new projects — permanently, on any key.
  `gemini-3.1-pro-preview` 429s with a free-tier limit of 0, which is a billing
  gate rather than a retirement. Run `./scripts/probe-models.sh` before
  changing the model — see NOTES.md §7.

**Upgrade path:** enable billing on the AI Studio project and switch
`preferred` to `google:gemini-3.1-pro-preview`. Worth doing if Flash proves too
weak once the skills exist and Badger is reconciling three sources per query.

## Session log

**2026-08-16 — framework verification and scaffold**

- Installed `@open-gitagent/gitagent@2.1.0` and `@open-gitagent/voice@1.0.0`
  globally via npm.
- Cloned `architect` from registry.gitagent.sh and ran it. Runtime loads
  manifest, 8 builtin tools and 6 skills correctly; its manifest needed a
  `-m anthropic:…` override to run at all.
- Verified the web UI on `:3333` — HTTP 200, chat/skills/scheduler/logs tabs,
  file browser, `/api/chat` and `/api/schedules` endpoints. Unauthenticated by
  default.
- Read the runtime's `dist/` (`index.js`, `mcp/manager.js`, `env-utils.js`,
  `tools/index.js`, `hooks.d.ts`) rather than trusting the docs. Findings in
  `NOTES.md`.
- Scaffolded this repo: `agent.yaml`, `SOUL.md`, `RULES.md`, `skills/`,
  `.gitignore`, `NOTES.md`.
- Not done: no credentials configured, no MCP server connected, no skill
  prompts written, Badger itself has not been run against a live source.

**2026-08-16 — switched to Gemini**

- Verified the runtime's Gemini support against the installed model registry:
  `google` is a first-class provider with 27 Gemini/Gemma models, mapped to
  `GEMINI_API_KEY` and dispatched to `generativelanguage.googleapis.com`.
- Probed seven Gemini models against the real key: only
  `gemini-3-flash-preview` and `gemini-flash-latest` are callable on a fresh
  free-tier AI Studio key. Settled `agent.yaml` on those two.
- Created `.env` from `env.template` for the AI Studio key.
- **First live run of Badger succeeded.** It introduced itself in persona and
  volunteered its read-only constraint unprompted — SOUL.md and RULES.md are
  reaching the model. Still no MCP sources connected.
