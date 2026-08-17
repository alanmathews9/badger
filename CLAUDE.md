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

**Badger works end to end.** Ask it a question about the private demo repo and
it searches, opens the threads, answers with citations, verifies those citations
against what it actually retrieved, and reports the cost. Read-only holds at
four independent layers.

    ./scripts/badger.sh -p "Who knows about payments integrations?"   # CLI
    npm run ask "What shipped in the last week?"                      # SDK + verification
    npm run serve                                                     # web UI on :4000

## Repository shape — the agent, and the product built on it

The task is to build a Glean equivalent **using GAP**, so the framework's
thesis has to survive contact with the product. It does, and the layout says so:

    agent.yaml SOUL.md RULES.md skills/ tools/ hooks/ memory/
                                    ← the agent. This IS the repo.
    app/server/  app/web/           ← the product. A consumer.
    scripts/                        ← dev tooling
    package.json  node_modules/     ← the agent's npm dependency. See below.

`memory/` is agent surface, not scaffolding: the spec's `standard` profile is
`RULES.md`, `skills/`, `knowledge/`, `memory/`, `tools/`, and `memory` is in the
allowlist both callers pass.

**`node_modules/` at the root belongs to the agent, not to `app/`.**
`tools/scripts/_github.mjs` imports `@composio/core`, so a GAP agent whose tools
declare `runtime: node` has genuine npm dependencies. That is why the root has a
`package.json` at all, and why `check:agent` symlinks `node_modules` into its
agent-only copy. `app/web` keeps its own separate `node_modules`.

**There is no `workspace/`.** The scaffold creates one as the output directory
for the runtime's `write` tool. Badger is read-only and `write` is in neither
allowlist, so nothing can ever put a file there. It stays in `.gitignore`
because a CLI run may recreate it. (The runtime still injects a "Workspace
Directory" block into the system prompt telling the agent to write outputs
there — dead advice for a read-only agent, and not overridable without
`systemPromptSuffix`.)

The dependency is **strictly one-way**: `app/` reaches up into `tools/`, and
nothing under the agent references `app/`. So Badger is still a git repo you can
clone and run with the CLI alone, exactly as GAP intends.

That is tested, not asserted — `npm run check:agent` greps for a downward
reference, then copies **only** the agent files to a temp directory and runs a
tool there. If the boundary ever rots, the check fails.

One repo rather than two, deliberately. `query({dir})` loads the agent from
disk, so a separate web repo would need the agent vendored in as a submodule or
cloned at deploy. It would still be one deployed service — the agent is files,
not a server — so splitting buys no isolation and costs version pinning.

## What exists

- **Model** — `google-vertex:gemini-2.5-flash` on ADC. No API key. ~$0.004/answer,
  measured via the SDK's `costs()`.
- **Source** — GitHub, through **Composio**, live and connected. Private demo repo
  `alanmathews9/arkind-internal` (18 files, 20 issues, 5 PRs, fictional
  consultancy "Arkind Consultants").
- **Five tools** in `tools/*.yaml` — `github_search`, `github_issue`, `github_pr`,
  `github_file`, `github_commits`. Thin scripts over a Composio session
  (`tools/scripts/`). The agent never sees Composio.
- **Five skills** in `skills/` — `trace-decision`, `find-expert`,
  `onboard-to-project`, `triage-pr-feedback`, `activity-digest`. Named for the
  user's task, per `RESEARCH-GAP-IDIOM.md`. See `skills/README.md` for why these
  five and not others.
- **Citation verification** — `app/server/verify-citations.mjs`, used by both
  `scripts/badger-sdk.mjs` and the server.
  Anything cited must appear in a tool result; failures are marked
  `[UNVERIFIED]` inline. Exits non-zero, so it can gate a demo.
- **Read-only, four layers** — Composio `DIRECT_TOOLS` preset (no generic
  executor), Composio per-tool enable list (8 of GitHub's 823 actions), the
  scripts can only call those 8, and `hooks/allow-read-only.sh` gates by exact
  name. The SDK path adds `allowedTools`, which removes tools from the model's
  schema entirely and cannot fail open. `npm run composio:status` prints which
  tools the agent can reach and which are diagnostic-only, and shouts if the
  enable list is not holding.

  **All four layers are software. The credential underneath is not read-only,
  and cannot be.** Measured 2026-08-17: the Composio connected account is
  `OAUTH2` holding `codespace, gist, notifications, project, repo, user,
  workflow` — account-wide, write-capable, not scoped to the demo repo. This is
  not fixable by tightening Composio: its GitHub toolkit offers OAUTH2 only (no
  PAT/bearer scheme), and **GitHub has no read-only OAuth scope for private
  repositories** — `repo` is the narrowest scope that can read one, and it
  grants write. So the enforcement *has* to live in the tool layer, which is
  why there are four of them and why the allowlist is by exact name.

  Two honest improvements, in order of value: request a custom auth config with
  `repo` alone, dropping six of seven scopes (no Actions workflow edits, no
  gists); and note that a **GitHub App** with `contents:read`, `issues:read`,
  `pull_requests:read` on one repository would be genuinely read-only at the
  credential — but Composio's GitHub toolkit does not offer that scheme, so
  taking it would mean going around Composio and reopening the multi-user
  problem that chose Composio in the first place.

- **The web product** in `app/` — three screens (Home, Results, Ask) on Vite +
  React + Tailwind + shadcn/ui. `POST /api/search` retrieves live from GitHub
  with no model involved; `GET /api/ask` streams the agent over SSE with tool
  calls forwarded as they happen. Two passes, the split Glean and Onyx both use.

## What does not exist

**Gmail and Drive are not connected.** One source is the thin part of the
story. Everything else on the five graded axes now has substance.

## Hosted — https://badger-1033557908241.us-central1.run.app

Passphrase `glean-me`. Live on Cloud Run, verified end to end in production:
the gate holds, search returns 20 hits in 2.4s, and the agent answers with
verified citations at about half a cent a question.

**Cloud Run, not the VM + Cloudflare Tunnel this file used to specify.** The
reasoning did not change, the constraint did: there is no domain, and a
quick tunnel hands out a random *.trycloudflare.com URL that changes on every
restart. Cloud Run gives a free HTTPS URL with no domain, Vertex credentials
from the service identity so **no key exists anywhere**, and a free tier
(2M requests, 180k vCPU-s, 360k GiB-s per month) a demo will not approach. It
removed two components rather than adding any.

    gcloud run deploy badger --source . --region us-central1 \
      --service-account badger-run@$PROJECT.iam.gserviceaccount.com \
      --allow-unauthenticated --max-instances 1 --concurrency 20 \
      --set-secrets COMPOSIO_API_KEY=badger-composio-api-key:latest,...

`--max-instances 1` does double duty: it caps cost absolutely, and it makes the
in-memory rate limits *correct* — they are per instance, so a second instance
would silently double every limit.

Three secrets in Secret Manager, never as plain env vars: the Composio key, the
session signing key, the passphrase. The service runs as a dedicated
`badger-run` service account holding exactly two roles — `aiplatform.user` and
`secretAccessor` on those three secrets — rather than the default compute
account, which carries far more.

**Image storage grows ~59MB per deploy, measured not assumed.** A redeploy
with zero code changes took the Artifact Registry repo from 140.4MB to
199.4MB, because `--source .` builds on a fresh Cloud Build worker with no
layer cache: `npm ci` re-runs and produces a new layer digest every time, since
npm installs are not byte-reproducible. Only the node:24-slim base is shared.
At that rate the 500MB free tier arrives in about five deploys, so a cleanup
policy is applied and enforcing (not dry-run): keep the three most recent
versions, delete anything older than seven days.

The image is almost entirely node_modules — 272MB on disk for two production
dependencies. The agent and the whole frontend together are under half a
megabyte. Adding Gmail and Drive will not change this: they are Composio
toolkits, so they add tool YAML and config rather than npm packages.

**Still to do:** a billing budget alert. `gcloud billing budgets create` needs
the billingbudgets API enabled against the billing account's own quota project;
easiest in the console. The app-level cap is the real protection and is already
live — 250 answers a day, about $1.25 at worst.

**Traps hit deploying, all now fixed in the repo:** every entry point read .env
with an unguarded readFileSync, which would have crashed the container before
its first request; the root lockfile had drifted from package.json, which
`npm install` tolerates and `npm ci` correctly refuses; and the base image must
match the local npm major (node:24, npm 11) or `npm ci` rejects the lockfile.
A new GCP project also no longer grants the compute default service account
Editor, so Cloud Build cannot read its own source upload until it is given
`cloudbuild.builds.builder`.

## Next: Gmail and Drive

The weakest part of the story. A "Glean equivalent" searching one GitHub repo
is thin, and the architecture's central claim — that adding a source is
configuration rather than connector code — is currently untested.

**Use a throwaway Google account with seeded data, never Alan's real one.** The
demo is behind one shared passphrase on a public URL; connecting a personal
inbox would expose it to anyone holding the link. The same reasoning that made
the GitHub corpus a fictional consultancy applies here.

**Login is a gate, not the product, and the README should say so:** Badger has
no per-user anything — one Composio connected account, a user id in an env var.
Real deployment resolves the signed-in user to their own OAuth grant per
source, so results are permission-scoped by construction. Federation makes that
*simpler* than an index: each source enforces its own ACLs at query time,
whereas Onyx has to replicate permissions into Vespa and keep them fresh
(`build_access_filters_for_user`, `_post_query_chunk_censoring`). That paragraph
turns the shortcut into evidence of understanding the hardest part of Glean.

## Decisions that are settled — do not relitigate

- **Composio over per-source MCP servers**, because multi-user requires it: a
  `GITHUB_TOKEN` in `.env` is one user on one laptop. Free tier is 100k tool
  calls/month, hard-capped, no card. Details in the Composio section below.
- **`tools/*.yaml` over MCP wiring** for reaching Composio. `dist/tool-loader.js`
  implements it; declarative tools are wrapped by `pre_tool_use` exactly like
  MCP tools. Traps in NOTES.md §9a — the runtime reads `implementation.script`
  where the spec says `path`, script paths resolve under `tools/`, malformed
  files are skipped silently, and `annotations.read_only` is read by nothing.
- **Skills decompose by user-facing task, never by data source.** Adding Gmail
  does not add a skill; it adds tools and a `references/` file.
- **Guardrails go in tool output, not prompts.** Three times now the fix that
  held was encoding it in data — the open/closed banner on issues, the computed
  date window, the citation check. Flash follows data far better than prose.
  Reach for a tool-level fix first.
- **No Pipecat.** It is a voice/realtime framework; we are building text search,
  and gitagent already ships voice.
- **Second-pass validator deferred** — see commit `5e03a5c` for the four
  reasons. Revisit when Pro access lands.

## Read before building

`RESEARCH-GAP-IDIOM.md` — how the framework's authors write agents, from 17 of
their repos, plus §11 on the formal spec. `NOTES.md` §9–§10 — what the installed
runtime actually does, which differs from the docs every time it has mattered.

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

**2026-08-17 — the web product, and one bug it caught.** Built the search UI
from Alan's design: `POST /api/search` retrieves live from GitHub with no model
on the path, `GET /api/ask` streams the agent over SSE, and the results never
wait for the answer. That two-pass split is what Glean and Onyx both do, read
from Onyx's own source rather than its docs — which also corrected two things:
current Onyx uses OpenSearch, having deleted Vespa entirely in v4.0.0, and its
GitHub connector never searches GitHub at all, it enumerates a repo into the
index.

The UI immediately exposed a defect in the agent. GitHub ANDs every search term,
so `"Halden engagement slip"` returned nothing while the results list beside it
showed twenty hits — and the tool's own advice, to add `in:title,body,comments`,
could not have helped, because the failure is AND semantics rather than search
mode. Query planning now lives in `tools/scripts/_search-query.mjs` and is
shared by the agent tool and the web search, so the two cannot drift again.

Restructured to `app/server` and `app/web` so the repository says out loud which
part is the agent, and added `npm run check:agent`, which proves the boundary
rather than claiming it.

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

**2026-08-17 — Badger works. Composio, five tools, five skills, verification.**
Studied 17 published gitagent agents with six subagents, then read the formal
spec at `open-gitagent/opengap`, which corrected three conclusions drawn from
the agents alone. Chose Composio as the integration layer — the deciding
argument was multi-user, not convenience. Reached it through `tools/*.yaml`
rather than MCP, which sidesteps the per-user-URL problem. Replaced a generic
`answer-question` skill with five named procedures after Alan pushed back that
it was vague; the taxonomy came from Glean's own engineering agent library.
Built citation verification in the SDK caller after discovering `post_response`
cannot see or block a response. Three separate bugs were fixed by encoding the
guardrail in tool output rather than prompt text, which is now the house
approach.

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
