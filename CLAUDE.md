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
The demo corpus exists and every GitHub retrieval path is verified — but **the
GitHub source is still commented out in `agent.yaml`, so Badger itself cannot
yet search it.** Everything verified so far was tested outside the agent.

## Works today

- Model: `google-vertex:gemini-2.5-flash`, authenticated by ADC. No API key.
- Read-only enforcement: `hooks/allow-read-only.sh` blocks live MCP calls by
  exact name. Tested against a real server with write tools.
- Source-credential gate: `hooks/check-sources.sh` refuses to start a session if
  a declared source has no credential.
- GitHub MCP server installed and its 26 read-only tools audited; 15 are in the
  allowlist by verified name.
- **`GITHUB_TOKEN` is set** — fine-grained PAT, scoped to the demo repo, all
  paths verified (see below).
- **Demo corpus exists**: `alanmathews9/arkind-internal`, private. 18 files, 20
  issues, 5 PRs. Fictional consultancy, Arkind Consultants.
- `scripts/mcp-tools.mjs` now **calls** tools, not just lists them:
  `MCP_SCHEMA=<tool>` and `MCP_CALL=<tool> MCP_ARGS=<json>`. No model, no spend.
  Use it to probe every new source before wiring it.
- `scripts/badger.sh` (run wrapper), `scripts/probe-models.sh` (stale).

## Not built

`skills/` holds a plan, not prompts. No custom UI, no hosting, no digest agent.

## The two things to do next, in order

### 1. Research how the framework's authors build agents — DONE 2026-08-17

Seventeen public `shreyas-lyzr` repos read in full by six parallel subagents.
**Findings are in `RESEARCH-GAP-IDIOM.md`. Read it before writing any skill.**

The four things that change what we build:

- **Skills are decomposed by user-facing task, never by data source**, and no
  agent in the corpus has a routing skill. Our planned `search-gmail` /
  `search-drive` / `search-github` / `federate` / `cite` split is unidiomatic —
  per-source mechanics belong in `skills/<name>/references/`, and citation is an
  output-format block repeated per skill, not a skill.
- **No published agent declares an MCP source, and `exa-lead-gen-agent`
  deliberately migrated off MCP** for engine portability. Our MCP wiring, our
  `hooks/`, and our `scripts/` are all departures with no precedent. Each is
  defensible; each now has to be argued in the README instead of left to look
  like ignorance of the idiom.
- **`agent-designer` argues for agent-driven search over RAG in as many words** —
  "let the agent drive", "add RAG only if the agent consistently fails". That is
  Badger's federated-no-index thesis, stated by the framework's own author, and
  citing it is a direct hit on two graded axes.
- **SOUL/RULES have fixed heading templates** (five and four), and load-bearing
  constraints are deliberately restated across SOUL, RULES, skill and README
  rather than cross-referenced. A fourth file, `DUTIES.md`, holds the per-task
  order of operations.

### 2. Composio is the integration layer — decided 2026-08-17

**This supersedes the per-source MCP plan below.** Badger becomes a hosted
product: users log in, connect their tools through an OAuth flow, land on a
search results page, and chat on top of it. Glean's actual shape.

**The decisive reason is multi-user, not convenience.** Today Badger reads
`GITHUB_TOKEN` from `.env` on one laptop — one token, one user, one machine.
Nothing about that serves a stranger connecting their own Gmail. Composio
assigns each end user an ID, stores and isolates their tokens per user, refreshes
OAuth automatically, and hosts the connect page you redirect to. It is the only
one of the two options that can do what the product needs.

Free tier is real and ample: 100k tool calls/month, 50k trigger events, no credit
card, hard-capped so it cannot produce a bill. Our measured usage is a few calls
per query.

**What this does to the architecture.** Badger splits in two, which the framework
sanctions — the GitAgent SDK is pitched as "the production entry point", imported
into a Node app and driven by `query()`:

- **the agent repo** — `agent.yaml`, `SOUL.md`, `RULES.md`, `skills/`. The brain.
  Unchanged, still git-native, still the thesis.
- **a web app around it** — login, connect buttons, results page, chat.

**Read-only stops being free, and this is the part that needs care.** Ten sources
means hundreds of tools, many of which write. The current guarantee rests on a
hand-audited list of 15 exact GitHub tool names; nobody hand-audits 200 apps.
The mechanism survives — Composio supports per-action allowlists and read-only
OAuth scope configs, and `hooks/allow-read-only.sh` still gates by exact name at
call time — but it becomes real work per source. Ship five sources genuinely
locked down over ten waved at. "It never writes" is the claim everything rests on.

**Order of work — decided, do not invert.** One source end-to-end before breadth.
Get GitHub answering a real question with citations through Composio, confirm the
read-only gate still holds, then add sources in a batch. Once one source works,
the next eight are mostly configuration; if retrieval is bad, ten sources make it
bad ten times. We currently have **zero** working sources, so breadth-first risks
impressive plumbing attached to answers that don't cite.

**Settled: Composio exposes a hosted MCP endpoint, so it drops straight into
`mcp_servers:`.** No SDK detour needed for the agent itself.

    https://backend.composio.dev/v3/mcp/<SERVER_ID>?user_id=<USER_ID>

authenticated by an `x-api-key` header, which is exactly the `type: http` + `url`
+ `headers` shape already verified against `dist/mcp/manager.js` (NOTES.md) and
already drafted in the commented-out block at the foot of `agent.yaml`.

Three properties that matter:

- **`allowed_tools` is set server-side on the MCP server config**, by exact tool
  name (`GMAIL_FETCH_EMAILS`). That is a second, independent read-only layer
  above `hooks/allow-read-only.sh` — and it is the same server-side narrowing
  the framework's authors used with Exa's `?tools=` parameter, so it is idiomatic
  as well as safer. Defence in depth survives the move to Composio.
- **`user_id` is a query parameter on the URL**, so the per-user URL is minted
  per session — `composio.mcp.generate(user_id, mcp_config_id)`. Multi-user
  works without the agent repo knowing anything about users.
- One server config per toolkit is supported, so sources stay separately scoped
  rather than collapsing into one blanket grant.

Caveat recorded: the MCP endpoint exposes only Composio's hosted tools. Anything
custom has to go through the SDK instead.

Probe it with `scripts/mcp-tools.mjs` before wiring — same discipline as every
other source, and it is how we find the real tool names for the allowlist.

**Alan needs to create the Composio account** — account creation is not something
I do. Free tier, no card.

### 2b. Turn the GitHub source on (superseded in part — see above)

`agent.yaml` (the `github:` block) and `hooks/required-env.txt` (the
`github=GITHUB_TOKEN` line) are both still commented out from when the token
was empty. **Uncomment both together** — source on with credential line off
means Badger can start with a dead source and not know it, which is the exact
failure `check-sources.sh` exists to prevent.

Then confirm the startup banner lists the GitHub tools, and run the first real
query end-to-end with citations.

### Demo repo and token — done 2026-08-17

`alanmathews9/arkind-internal`, **private**, fine-grained PAT scoped to that one
repository. A public demo repo would contradict the enterprise-search premise,
and single-repo scope is the same least-privilege discipline as the read-only
allowlist.

**Corpus shape, and why.** Files hold the official answer; issues hold the real
one. `clients/halden/retro.md` says the engagement slipped because scope
changed; the retro *issue* has the team concluding that four of the six weeks
were self-inflicted. That gap is the product thesis in miniature — the answer
exists, but not where you would look. Anything contested lives in comments.

Fine-grained token, repository permissions (**read** on all):

| Permission | Needed for |
|---|---|
| Metadata | mandatory, implied |
| Contents | `get_file_contents`, `list_commits`, `get_commit`, `search_code` |
| Issues | `issue_read`, `list_issues`, `search_issues` |
| Pull requests | `pull_request_read`, `list_pull_requests`, `search_pull_requests` |

Do **not** use classic scopes (`repo:status`, `public_repo`, `read:org`) — an
earlier note in this file said to, and it was wrong for a private repo.

### Settled 2026-08-17: code search does NOT work on a private repo

This was filed as an open risk about *fine-grained tokens*. It is worse than
that: **REST code search does not serve private repositories at all here**, and
no token class fixes it. Measured, same endpoint, same minute:

| Query | `total_count` | `incomplete_results` |
|---|---|---|
| `printk` in public `torvalds/linux` | 4,536 | `false` |
| sentinel in private `arkind-internal` (5 min old) | 0 | **`true`** |
| `import` in private `finance-tracker` (10 days old) | 0 | `true` |
| `import` in private `gaming-portfolio` (2 months old) | 0 | `true` |

Run with the **classic OAuth token holding full `repo` scope** — so this is not
a fine-grained limitation. `incomplete_results: true` alongside zero hits means
the query never completed against the private index; it is "did not search",
not "searched and found nothing". The three repos span five minutes to two
months, which rules out indexing latency.

`search_issues` reaches the same private repo immediately (1 hit, first try).

**Consequence: the fallback is now the primary path.** The `search-github`
skill must be built on `search_issues` / `search_pull_requests` (different
endpoint, works on private) plus `get_file_contents` and `list_commits` on
known paths. Treat `search_code` as a public-repo-only bonus, never a
dependency. This also shapes the corpus: searchable knowledge has to live
substantially in issues and PR threads rather than in files.

**Fine-grained PAT tested 2026-08-17 — behaves identically.** Private
`search_code` still returns 0 / `incomplete_results: true`; the public control
still returns 4,536. Token class is irrelevant, as expected. Everything else
Badger needs works on the fine-grained token with Contents + Issues + Pull
requests read and **no account permissions at all**:

| Path | Result |
|---|---|
| `get_me` → `GET /user` | 200, `login: alanmathews9` — no account permission needed |
| `get_file_contents`, `list_commits`, `list_issues` | 200 |
| `list_repository_collaborators` | **200 — no Administration:read needed** |
| `search_issues` on the private repo | 200, 1 hit, `incomplete_results: false` |
| `search_code` private / public | 0 `true` / 4,536 `false` |

Two notes that outlive the probe. Private issue search reaches **body text**,
not just titles — the hit was a sentinel inside an issue body, so full-text
retrieval into a private repo does work, just not over files. And
`list_repository_collaborators` needs no extra permission, so the caveat that
used to sit here is dropped rather than carried.

**Search API rate limit is 30 requests/minute** and returns HTTP 403, not an
empty result. Hit for real during this probe. A federated fan-out issuing
several searches per turn will reach it — the skill must not treat a 403 as
"no results".

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
- **Read-only, everywhere — as phase 1 of a stated roadmap, not as a limit.**
  Never send, write, edit, delete or share. See the capability phases below.

### Capability phases — decided 2026-08-17

Glean is **not** a read-only product. [Glean Actions][ga] ships 85+ enterprise
actions: create a Jira issue, comment on a ticket, post to Slack, update
records. A "Glean equivalent" that silently omits writes reads as a missing
feature, so the boundary has to be stated as a choice.

1. **Read-only (now).** Federated live query across Gmail, Drive, GitHub.
   Search, retrieve, synthesise, cite. This is Glean's core, and Glean built
   Actions on top of a working retrieval engine — same order here.
2. **Propose, don't execute.** Badger drafts the reply or the ticket and hands
   it over without sending. Nothing mutates, so it stays inside the read-only
   guarantee. The honest bridge.
3. **Actions.** Real writes, per-source, each a deliberate allowlist addition
   with its own credential scope.

Phase 1 is the submission. Do not build 2 or 3 until a source actually returns
results — Badger has no working source yet, and adding a second capability
class before the first retrieves anything is the wrong order.

[ga]: https://docs.glean.com/agents/actions/introduction-to-actions

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

**2026-08-17 — corpus built, retrieval verified, one trap found.** Created the
private demo repo `alanmathews9/arkind-internal` and filled it: 18 files, 20
issues with threaded argument, 5 PRs (3 merged, 2 open and unresolved). Settled
the code-search risk negatively — REST code search does not serve private repos
for any token class, so `search_issues` plus `get_file_contents` is the primary
path, not the fallback. Extended `scripts/mcp-tools.mjs` to call tools, which
immediately paid for itself: `search_issues` runs in semantic mode, and semantic
mode cannot see issue comments and degrades as queries lengthen. Adding an `in:`
qualifier switches GitHub to classic keyword search and recovers them. See
NOTES.md §4f–§4i. Read-only was also restated as phase 1 of three rather than a
flat constraint, since Glean itself ships 85+ write actions.
