# Badger

Glean-style workplace search agent, built on the GAP standard (gitagent.sh).
Submission for a hiring task.

## The task, as given

> Use https://www.gitagent.sh/ to build a Glean equivalent. Your ability to do
> your own research, understand the agent framework, visualize good designs,
> build, and host the agent will be critical for us to evaluate.

Evaluation is on five axes, not one: **research, framework understanding,
design, build, hosting.** Work that only moves "build" forward underweights
four fifths of the grade.

---

# START HERE — state as of 2026-08-17

**Badger runs.** It answers on Vertex AI, holds its persona, and refuses writes.
It has **no sources connected yet**, so it cannot actually search anything.

## Works today

- Model: `google-vertex:gemini-2.5-flash`, authenticated by ADC. No API key.
- Read-only enforcement: `hooks/allow-read-only.sh` blocks live MCP calls by
  exact name. Tested against a real server with write tools.
- Source-credential gate: `hooks/check-sources.sh` refuses to start a session if
  a declared source has no credential.
- GitHub MCP server installed and its 26 read-only tools audited; 15 are in the
  allowlist by verified name.
- `scripts/badger.sh` (run wrapper), `scripts/mcp-tools.mjs` (audit any MCP
  server with no model), `scripts/probe-models.sh` (AI Studio only, now stale).

## Not built

No source is connected. `skills/` holds a plan, not prompts. No custom UI, no
hosting, no digest agent.

## The one thing to do first

**`GITHUB_TOKEN` is empty, and the GitHub source is deliberately commented out
in two files** — `agent.yaml` (the `github:` block) and `hooks/required-env.txt`
(the `github=GITHUB_TOKEN` line). That was done to test the model in isolation.
Uncomment **both** when the token exists, or the session will refuse to start.

### Demo repo and token — decided 2026-08-17

**Private repo, fine-grained PAT, scoped to that one repository.** A public demo
repo would contradict the enterprise-search premise, and single-repo scope is
the same least-privilege discipline as the read-only allowlist. The repo will
hold invented internal company data — docs, issues, discussions — for Badger to
search.

Fine-grained token, repository permissions (**read** on all):

| Permission | Needed for |
|---|---|
| Metadata | mandatory, implied |
| Contents | `get_file_contents`, `list_commits`, `get_commit`, `search_code` |
| Issues | `issue_read`, `list_issues`, `search_issues` |
| Pull requests | `pull_request_read`, `list_pull_requests`, `search_pull_requests` |

Do **not** use classic scopes (`repo:status`, `public_repo`, `read:org`) — an
earlier note in this file said to, and it was wrong for a private repo.

### Open risk: code search on a private repo

`github__search_code` is the primary entry point for most questions, and
**whether it works with a fine-grained token against a private repo is
unverified.** GitHub's REST reference does not state fine-grained support for
the search endpoints, and the server's policy doc is missing. Code search also
only indexes the default branch and files under 384 KB.

**Test this first, before writing the `search-github` skill.** If it fails, the
skill must reach the same answers another way — `get_file_contents` on known
paths, `list_commits`, and `search_issues` / `search_pull_requests`, which use
different endpoints. Design that fallback in from the start rather than
discovering it during a demo. `list_repository_collaborators` may also need
Administration:read; drop it if it 403s, as nothing critical depends on it.

## Then, in order

1. First real GitHub query end-to-end, with citations.
2. Write the five skill prompts in `skills/` — they are the actual product.
3. Gmail and Drive: audit each server with `scripts/mcp-tools.mjs` **before**
   wiring credentials, then add verified names to the allowlist.
4. Custom search + chat UI.
5. Hosting.
6. One scheduled digest agent.

Do not pull later phases forward.

---

## Architecture — decided, do not redesign

- **Built on GAP.** The agent *is* a git repo: `agent.yaml`, `SOUL.md`,
  `RULES.md`, `skills/`. Identity and behaviour are version-controlled files.
- **Federated search, no indexing.** Live queries to Gmail, Google Drive and
  GitHub via their MCP servers at ask-time. No crawler, no index, no copy of
  user data. This is the product thesis and the main departure from Glean.
- **Read-only, everywhere.** Never send, write, edit, delete or share.

## Environment already set up on this machine

- `@open-gitagent/gitagent@2.1.0` and `@open-gitagent/voice@1.0.0` (npm global)
- `github-mcp-server` 1.9.0 (`brew install github-mcp-server`)
- Google Cloud SDK; ADC is authenticated as `alangeorgemathews.9@gmail.com`
- `.env` holds `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION=us-central1`, and
  stale `GEMINI_API_KEY` / `GROQ_API_KEY` (both free tiers, neither usable)
- GCP project `project-4b5f1441-de45-41e6-a20`, billing enabled, Vertex AI on

## How to run

    ./scripts/badger.sh                    # REPL
    ./scripts/badger.sh -p "question"      # single shot
    ./scripts/badger.sh --voice            # web UI on :3333

**Always use the wrapper, never `gitagent` directly.** See Git policy below.

## Model

`google-vertex:gemini-2.5-flash` via Application Default Credentials — no API
key, no key file. Requires `gcloud auth application-default login` plus
`GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` in `.env`; all three or it
fails late and unclearly, since gitagent has no pre-flight check for
`google-vertex`.

Measured cost: **~2,200 input tokens per turn**, about $0.002 for three turns.
Spend is a non-issue.

**Flash is in use because Pro is locked out, not by choice.** On this project
all 3.x models 404 (published in us-central1 but gated behind preview
enrolment) and `gemini-2.5-pro` 400s on `thinking_budget: 0`, which pi-ai sends
and gitagent cannot override. **Requesting preview access on the project is the
route to Pro-tier reasoning** — worth doing if flash cites poorly once skills
exist.

Two free tiers were tried and neither can run Badger: AI Studio caps at 5
requests/minute, Groq at 8k tokens/minute. Details in NOTES.md §4c.

## Gotchas that will bite you

Full detail in `NOTES.md`. The ones that change how you work:

- **`gitagent` scaffolds an agent into whatever directory you run it from**,
  before parsing arguments, and auto-commits. Always use the wrapper.
- **The web UI switches the repo onto a `chat/<timestamp>` branch.** Check
  `git rev-parse --abbrev-ref HEAD` after using it. Its text composer is also
  broken (mispositioned, unusable) — demo through the CLI.
- **There is no tool allowlist in the runtime and `tools:` in `agent.yaml` is
  ignored.** Every MCP tool a server exposes is registered and `cli` (a shell)
  is always loaded. Adding a source means adding its read tools to
  `hooks/allowed-tools.txt`, or Badger cannot call them. That friction is the
  design: unknown tools fail closed.
- **Hooks fail open** on crash, non-zero exit, timeout, or non-JSON output.
  Both hook scripts are therefore dependency-free POSIX `sh` that always exit 0
  with valid JSON. **Never add a `jq` dependency** — if it were missing on the
  host, every tool call would be silently permitted.
- **`model.fallback` is not failover.** The loader reads `preferred` only.
- **A model existing in the registry does not mean the account can call it.**
  These are independent checks. Verify against the provider before switching.
- **`.env` is write-blocked for Claude** by a permission rule. Append via shell
  or ask the user to edit it. Never print its contents.

## Git policy

The history is part of the deliverable. For a submission whose thesis is *the
agent is a git repo*, `git log` is the first thing a reviewer reads. Write
commit messages like changelog entries — what changed and why, not "wip".

**Always run Badger through `./scripts/badger.sh`.** The runtime auto-commits on
every invocation with no way to disable it (`ensureRepo()` emits "Scaffold
gitagent agent", the web UI emits "auto-save before new chat"). The wrapper
records HEAD, runs the agent, then soft-resets those commits so file changes
survive as staged work. It leaves `memory` and `skill_learner` commits alone and
aborts if it sees any commit it does not recognise.

Squash **per milestone**, at phase boundaries. The verified-safe sequence:

    git branch backup-pre-squash
    git reset --soft <target>
    git commit --amend -F <message-file>
    git diff backup-pre-squash                    # must be empty
    git rev-parse HEAD^{tree}                     # must equal the backup's tree

Two independent checks, then delete the backup. Never rewrite history without
that branch existing first.

Leftover backup branches — `backup-pre-squash`, `-2`, `-3`,
`backup-main-pre-move` — are safe to delete once the user confirms.

## Working notes

`NOTES.md` is the research record: gitagent 2.1.0 behaviour read from the
shipped `dist/`, MCP config shape, tool namespacing, silent failure modes, CLI
gotchas, the bundled web UI, model availability across three providers. Read it
before touching `agent.yaml` or writing a skill. It records the shipped code's
behaviour where that differs from the published docs, which it does often.

## Session log

**2026-08-16 — runtime verified, repo scaffolded.** Installed the CLI, ran the
`architect` example from the registry, confirmed the web UI on :3333, read the
runtime's `dist/` rather than trusting docs, and scaffolded this repo.

**2026-08-16 — model hunt.** AI Studio free tier: most models 404 as closed to
new projects; the survivors hit a 5 req/min wall. Groq free tier: 8k TPM, below
what one turn needs. Neither can run Badger.

**2026-08-16 — read-only enforcement.** Built the allowlist hook after
establishing the runtime has no tool gating of its own. Chose allow-by-name over
deny-by-verb; the GitHub server's real tool list later vindicated that
(`merge_pull_request`, `fork_repository`, `add_comment_to_pending_review` all
mutate without an obvious verb). Added the wrapper to stop auto-commit noise.

**2026-08-17 — GitHub source wired.** Installed the server via brew, audited 42
tools without `--read-only` vs 26 with, put 15 verified names in the allowlist.
Discovered the runtime silently starts with zero sources when a server fails to
connect, and added `check-sources.sh` to refuse that.

**2026-08-17 — Vertex AI on ADC.** Moved off free-tier API keys entirely.
Caught Badger claiming it could search all three sources while holding tools for
none — it had read its own description instead of its tool list — and added the
RULES.md rule that fixed it. Corrected a wrong ~35k token-per-turn figure with a
real measurement of ~2.2k.
