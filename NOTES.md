# Framework notes — gitagent 2.1.0

Everything below was verified against the installed runtime
(`@open-gitagent/gitagent@2.1.0`, `@open-gitagent/voice@1.0.0`) on 2026-08-16,
by reading `dist/` and by running the `architect` agent from
registry.gitagent.sh. Where the published docs and the shipped code disagree,
the code is what's recorded here.

## 1. MCP is wired in the manifest, and that is the whole surface

`mcp_servers` in `agent.yaml` is read by `dist/mcp/manager.js`. Three transports:

```yaml
mcp_servers:
  local-thing:                       # stdio (default when no `type`)
    command: npx
    args: ["-y", "some-server"]
    env: { TOKEN: "${SOME_TOKEN}" }
    cwd: /optional
    timeoutMs: 30000
  remote-thing:
    type: http                       # Streamable HTTP
    url: "https://example.com/mcp"
    headers: { Authorization: "Bearer ${TOKEN}" }
  legacy-thing:
    type: sse
    url: "https://example.com/sse"
```

`${VAR}` interpolation runs over the **entire** config object (url, headers,
args, env) at connect time. **An unset variable substitutes the empty string
and only logs a warning** — it does not error. So a missing `GITHUB_TOKEN`
yields a live connection attempt with `Authorization: Bearer `, which fails
later and less legibly. We should assert required vars in an
`on_session_start` hook rather than trusting the substitution.

## 2. Tool naming: `<server>__<tool>`, sanitized, truncated at 64

`gmail` + `search_threads` → `gmail__search_threads`. Non-`[A-Za-z0-9_-]` chars
become `_`; anything over 64 chars is **truncated**, and a truncation collision
just drops the later tool with a warning. Keep our server keys short — `gmail`,
`drive`, `github`, not `google-workspace-gmail-readonly`. Skill prompts must
use these prefixed names, and the prefix is the manifest key, so renaming a
server silently breaks every skill that names its tools.

## 3. There is no tool allowlist. Read-only must be enforced by us

This is the single most important finding for Badger.

- `setupMcp` registers **every tool every server exposes**. There is no
  allow/deny filter anywhere in the path.
- `tools:` in `agent.yaml` is **ignored** in 2.1.0. `createBuiltinTools()` is
  called without it. Running `architect`, whose manifest declares no tools at
  all, still loaded: `cli, read, write, edit, memory, capture_photo,
  task_tracker, skill_learner`. **`cli` is an unrestricted shell and is always
  present.**
- Every MCP tool is registered with `metadata: { isReadOnly: false,
  isDestructive: false, isConcurrencySafe: false }` — hardcoded, since the
  runtime can't know remote semantics. Nothing downstream consults it anyway.

Consequence: if we point Badger at a full-fat Gmail MCP server, `gmail__send_message`
and `gmail__trash_thread` are in its toolset and one bad turn can send mail from
the user's account. Defence, in order of strength:

1. **Prefer read-only servers at the source.** Pick or fork servers that expose
   only search/get/read. Least code, strongest guarantee.
2. **`hooks/hooks.yaml` → `pre_tool_use`.** The one real runtime chokepoint:
   `wrapToolWithHooks` wraps *every* tool's execute, and a hook returning
   `{"action":"block","reason":"..."}` stops the call. Write a deny-by-verb
   script matching RULES.md. Build this before wiring any live credential.
3. **RULES.md.** Prompt-level, and the weakest of the three. Necessary, not
   sufficient.

Read-only PAT scopes for GitHub are a fourth layer and cost nothing — use them.

**The hook itself fails open in four ways**, all of which the script must dodge:
a non-zero exit, an uncaught error, a 10s timeout, or *any non-JSON on stdout*
is treated as `allow` (`runHooks`: "Hook errors don't block execution by
default"). This is why `hooks/allow-read-only.sh` is dependency-free POSIX `sh`
and always exits 0 with a printed JSON object. **Never make it depend on `jq`** —
if `jq` were missing on the VPS, every tool call would silently be permitted.

Block reasons *are* visible to the model: `wrapToolWithHooks` throws, and
pi-agent-core's `agent-loop.js` converts a thrown execute error into
`createErrorToolResult(error.message)` with `isError: true`. So the model reads
`Tool "X" blocked by hook: <reason>` and can act on it. The reason text is
written to tell Badger what to do instead.

Verified live against `@modelcontextprotocol/server-filesystem`, which
registered **14 tools** including `fs__write_file`, `fs__edit_file` and
`fs__move_file` from a single line of config — a good illustration of how fast
the unfiltered tool surface grows. `fs__read_file` (allowlisted) succeeded;
`fs__search_files` and the `task_tracker` builtin (both absent from the
allowlist) were refused at the call site.

## 4. Failures are silent by design — Badger must un-silence them

`connectServer` is fail-soft: a server that can't connect logs
`[mcp:<name>] failed to connect: … — skipping` to **stderr** and the agent
starts anyway, minus that source. Same for a `listTools` timeout. The model is
never told a source is missing.

For federated search this is a correctness bug, not a convenience: Badger would
confidently answer "nothing in Drive mentions this" when Drive simply never
connected. Mitigation: an `on_session_start` hook that connects each configured
source, and injects the live/dead roster into context. The `federate` skill
must state which sources actually answered. This is also why SOUL.md and
RULES.md both carry the "never hide a blind spot" rule.

## 4a. The free tier's 5 requests/minute is a hard blocker for federated search

Hit during hook testing: `gemini-3-flash` on the free tier allows
**5 requests per minute** (`GenerateRequestsPerMinutePerProjectPerModel-FreeTier`,
`quotaValue: 5`). Every model turn is a request, and a tool-using turn burns one
per round trip — Badger spent three on a single two-tool prompt before failing.

A real federated query fans out across Gmail, Drive and GitHub, then reasons
over what comes back. That is comfortably 6–12 round trips. **Badger cannot do
its actual job on the free tier**, regardless of which model we pick.

This makes enabling billing a phase-2 prerequisite rather than a quality
upgrade, and it comes with a bonus: paid tier should also unlock
`gemini-3.1-pro-preview` (see §7), so the rate limit and the model-quality
question resolve together.

## 4b. Badger's per-turn overhead is ~2.2k tokens (measured)

Measured on Vertex via Cloud Monitoring
(`aiplatform.googleapis.com/publisher/online_serving/token_count`): three
`gemini-2.5-flash` turns consumed **6,675 input + 92 output tokens**, so roughly
**2,200 input tokens per turn** with eight builtin tools registered and no MCP
sources. Cost: about $0.002 for all three.

**Correction.** This file previously claimed a ~35k floor, taken from Groq's
rejection message (`Requested 34722`). The metered figure is ~15x lower. A
provider's estimate attached to a refusal is not the same measurement as a
meter on work performed; trust the meter. The gap is unexplained — do not build
arguments on the 35k number.

What still holds: the allowlist blocks tools at **call** time, not registration
time, so schemas are sent for tools Badger may not use, and every MCP server
adds more (`server-filesystem` contributed 14; GitHub adds 26). Keeping the
registered surface narrow is worth doing for the model's sake — a smaller,
sharper tool list means better tool choice — but at 2.2k/turn it is not a
meaningful cost lever, which is how it was wrongly framed here before.

## 4c. Free tiers, tested: neither provider can run Badger

- **Gemini free**: 5 requests/minute. A turn with tool calls burns one request
  per round trip; a three-source query needs 6–12. Dies mid-fan-out.
- **Groq free**: 8,000 tokens/minute on `openai/gpt-oss-120b`, against our ~35k
  floor. Cannot complete a single turn. Other Groq models sit at 6k–12k TPM,
  so none of them clears the bar either.

**Billing is a phase-2 prerequisite, not an optimisation.** Preferred fix is
billing on the AI Studio project: it lifts the rate limit, keeps the 1M context
window that suits federated search, and should unlock `gemini-3.1-pro-preview`
(§7) in one move. Groq's Dev Tier is a viable alternative — very fast, cheap —
but caps context at 131k and offers no Pro-tier reasoning.

Groq registry note: pi-ai's model list is stale here too.
`moonshotai/kimi-k2-instruct-0905` resolves locally but 404s at the API. Query
`GET https://api.groq.com/openai/v1/models` with the key to get the real list —
it is a metadata call and consumes no token quota, so it is always the cheapest
first move with a new provider.

## 4d. GitHub source, wired and audited

`brew install github-mcp-server` (1.9.0) — no Docker or Go needed, despite the
README offering only those two. Run as stdio with a plain PAT.

**`--read-only` is real and worth more than any prompt.** Audited both ways
with `scripts/mcp-tools.mjs`, which lists a server's tools without a model or
any LLM spend:

- without the flag: **42 tools**, including `merge_pull_request`, `delete_file`,
  `create_or_update_file`, `issue_write`, `fork_repository`,
  `add_comment_to_pending_review`, `pull_request_review_write`
- with the flag: **26 tools**, all read

That list is also the best argument against verb-matching: `issue_write` and
`pull_request_review_write` contain "write", but `merge_pull_request`,
`fork_repository` and `add_comment_to_pending_review` do not, and all five
mutate. The allowlist takes 15 of the 26 by exact name.

`GITHUB_TOOLSETS` restricts which toolsets register at all
(`context,repos,issues,pull_requests,users` → 26; `context,repos` → 16). Since
schemas are sent for every registered tool, this is the only real lever on the
~35k token floor from §4b — worth trimming further once the skills exist and we
know which tools they actually call.

A remote server exists at `https://api.githubcopilot.com/mcp/`, with
`/readonly` and per-toolset `/x/<toolset>/readonly` variants. It authenticates
against the Copilot endpoint rather than accepting a plain PAT, so local stdio
is the simpler route for us.

**Tool registration is static**, so a placeholder token is enough to enumerate
a server's surface. That means every source can be audited before a real
credential exists — do this for Gmail and Drive before wiring them.

## 4e. Silent source failure, observed for real

With `GITHUB_TOKEN` empty, `${VAR}` interpolation substituted an empty string,
`github-mcp-server` exited with `authentication required`, and gitagent printed
one stderr line — `[mcp:github] failed to connect ... skipping` — then started
Badger normally with **zero sources and no indication to the model**. Exactly
the failure §4 predicts.

Fixed by `hooks/check-sources.sh` (`on_session_start`), which cross-checks
`hooks/required-env.txt` against the environment and blocks the session if a
declared source has no credential. Verified: the run now aborts with a named
list of what is missing instead of answering blind. Refusing to start beats
reporting "nothing found" for a source never contacted.

## 4f. GitHub REST code search does not serve private repos

Probed 2026-08-17 against a purpose-built private repo
(`alanmathews9/arkind-internal`) plus two older private repos, with a classic
OAuth token holding full `repo` scope. Full table in CLAUDE.md; the method is
the part worth keeping.

**Three controls, in order, each one killing a hypothesis:**

1. *New repo, 0 hits.* Hypothesis: the async code indexer hasn't caught up.
2. *Two older private repos (10 days, 2 months), also 0.* Kills indexing
   latency — a two-month-old repo is indexed.
3. *Public `torvalds/linux`, 4,536 hits.* Kills "token or endpoint is broken".

The decisive field is **`incomplete_results`**: `false` on the public query,
`true` on every private one. Zero hits with `incomplete_results: true` is the
API saying the query never ran against that index — not that it ran and found
nothing. Without that flag the private results are indistinguishable from a
genuine empty search, which is exactly the silent-failure class §4 warns about.

Generalisable lesson: **a zero result is a claim, and claims need a control.**
The public-repo query cost one request and turned "search is broken" into
"private repos are not served". `search_issues` on the same private repo
returned 1 hit first try, so the two search families behave differently and
must be reasoned about separately.

## 4g. `/search/issues` now REQUIRES `is:issue` or `is:pull-request`

Found while probing the fine-grained token. A bare repo-scoped query returns
**HTTP 422**:

    GET /search/issues?q=ARKINDPROBEECHO+repo:<r>            -> 422
      "Query must include 'is:issue' or 'is:pull-request'"
    GET /search/issues?q=ARKINDPROBEECHO+repo:<r>+is:issue   -> 200, 1 hit

**This is a live API change, and the trap is that it is invisible through
`gh`.** The identical query run earlier as `gh api search/issues` returned its
hit without complaint — the CLI evidently supplies the qualifier or pins older
behaviour. So a query verified with `gh` can still 422 when the MCP server
issues it over plain REST. **Verify search syntax against `curl`, not `gh`.**

Consequence for the `search-github` skill: since `search_issues` is now the
*primary* retrieval path (§4f), every issue query must carry `is:issue` or
`is:pull-request`. If `github-mcp-server` 1.9.0 builds a bare query internally,
that path is broken for us regardless of what we write in the skill — it must
be tested at the MCP layer, not just at REST. Untested as of writing.

**Search API rate limit: 30 requests/minute**, hit for real mid-probe. It
returns HTTP 403 with a rate-limit body, *not* an empty result set. A federated
turn issuing several searches per source will reach this. Any skill that treats
a failed search as "nothing found" will fabricate an absence — the same
correctness bug as §4, one layer up.

## 4h. Verified at the MCP layer, not just at REST

`scripts/mcp-tools.mjs` now takes `MCP_SCHEMA=<tool>` to print a tool's
parameters and `MCP_CALL=<tool> MCP_ARGS=<json>` to invoke one — no model, no
agent, no spend. Listing proves a name exists; only calling proves the path
works. Results against `github-mcp-server` 1.9.0 with the fine-grained PAT:

- **`search_issues` works.** The §4g `is:issue` requirement is handled by the
  server itself — its description says "Already scoped to is:issue", and the
  call returns the hit rather than a 422. So the primary retrieval path is
  sound, and skills do **not** need to add the qualifier by hand.
- **`search_code` fails identically at the MCP layer** — 0 hits,
  `incomplete_results: true`. Consistent with §4f, as expected.
- **`get_file_contents` works, and the answer arrives as a `resource` block
  rather than a text block.** Worth a scare, because §6 says binary resource
  blocks are replaced by a placeholder. Checked `dist/mcp/manager.js:32-38`:
  `flattenToolResult` pushes `res.text` through when it is a string, and only
  substitutes a placeholder when it is not. GitHub returns
  `mimeType: text/plain`, so Badger receives real content. Safe — but it is
  safe by one branch in the runtime, so re-check this for any source whose
  files may be binary.

**Use the `fields` parameter.** A single-issue `search_issues` response is
~2 KB of JSON — URLs, reaction counts, avatar links, node ids — almost none of
it useful. `fields: ["number","title","html_url","state"]` cuts the same result
to ~200 bytes. Across a fan-out that is the difference between a readable
context and a bloated one, and it makes the model's job easier. Every skill
that calls a GitHub search should pass `fields`.

## 4i. `search_issues` runs in semantic mode, and semantic mode cannot see comments

The single most important retrieval finding so far, and it contradicts the
tool's own description.

`github-mcp-server`'s `search_issues` describes itself as *"natural-language
semantic matching. Best for conceptual or paraphrased queries."* The harness
showed the URL it actually builds:

    /search/issues?q=repo:<r>+is:issue+<query>&search_type=semantic

Two things follow, both measured against the Arkind corpus:

**1. Semantic mode does not search issue comments.** The word `reconciliation`
appears only in comments, never in an issue body:

| Query | Result |
|---|---|
| `reconciliation` (semantic, via MCP) | **0** |
| `reconciliation` (plain REST, no `search_type`) | **3** — #2, #6, #19 |
| `reconciliation in:comments` | **3** |
| `reconciliation in:body` | 0 |

**2. Semantic mode degrades as the query gets longer**, behaving like an AND
over terms despite the "paraphrased queries" claim:

| Query | Hits |
|---|---|
| `Halden` | 2 |
| `Halden slip` | 1 |
| `Halden engagement slip` | **0** |
| `why did the Halden engagement slip and run over` | **0** |

So the natural-language question a user actually asks returns nothing, and the
knowledge we care about most is invisible.

**The fix: put an `in:` qualifier in the query.** Doing so switches GitHub out
of semantic mode into classic keyword search, which does reach comments.
`reconciliation in:comments` returns the three hits that bare `reconciliation`
could not. Nothing else worked — `sort: created` did not disable semantic mode,
and there is no parameter for it.

**Rules for the `search-github` skill:**

- Always append `in:title,body,comments` (or `in:comments`) to an issue query.
  Never issue a bare query.
- Feed it **keywords, not sentences.** Strip the question down before
  searching, then widen if it returns nothing.
- Treat a zero result as suspect. Retry with fewer terms before reporting an
  absence — §4f's lesson applies here too.

**Why this matters beyond GitHub.** The tool's description was confidently
wrong about its own behaviour, in a way that fails silently and returns a
plausible empty answer. Every source we add gets probed with `MCP_CALL` against
known content before a skill trusts it.

**Caveat, unfinished.** Some issues created minutes before testing did not
appear for terms in their own titles (`Copilot in:title` → 0 for an issue
titled "Can we use Copilot on the Verity codebase?") while matching on their
comments. That looks like index lag on fresh issues rather than a further
mechanism, but it is **not confirmed** — re-run the demo questions once the
corpus has settled before trusting any of them in a demo.

## 5. Timeouts stack badly across a fan-out

Default `timeoutMs` per server is 30 000, covering connect *and* the initial
`listTools`. Servers connect in parallel (`Promise.allSettled`), so startup is
bounded at ~30s, not 90s — fine. But `runtime.timeout` is a **per-turn** budget
and one Badger turn may issue a dozen searches across three sources. Set at 300s
in the manifest. Tool calls do get the agent's `AbortSignal` forwarded, so a
cancelled turn does cancel in-flight MCP requests cleanly.

## 6. Tool results are flattened to text before the model sees them

`flattenToolResult` joins text blocks; `structuredContent` is JSON-stringified
only when there are no text blocks. **Image and audio blocks are dropped and
replaced with `[image: …, data omitted]`.** Binary `resource` blocks become a
placeholder too.

So a Drive tool returning a PDF or an image as a binary blob gives Badger
nothing. Citations must be built from text and metadata, and the `search-drive`
skill needs an explicit story for non-text files: cite by title, owner, modified
date and link, and say the contents weren't readable. Protocol errors are
returned as the string `Error: …` rather than thrown — Badger will *see* them,
which is good, but must not mistake them for search results.

## 7. CLI ergonomics that will bite us

- **There are no subcommands.** `plugin` is the only one. `gitagent --help`,
  `gitagent help`, `gitagent run …` all fall through to the default path, and
  **any bare argument is treated as the prompt** — so the `gitagent run -d ./x`
  syntax printed in the registry's own `run-agent` skill silently sends "run"
  as a prompt. Correct invocation: `gitagent -d <dir> -p "<prompt>"`.
- **Running it anywhere scaffolds an agent there.** `ensureRepo()` runs `git
  init`, writes `agent.yaml`, `SOUL.md`, `memory/MEMORY.md`, `workspace/`, and
  commits — in the *current directory*, before parsing anything. It did exactly
  this to `Projects/badger` and to a throwaway dir when I tried `gitagent help`.
  Never run it from a directory you don't intend to convert into an agent.
- **Model ids need `provider:` and must be known to the runtime.** A bare id
  errors clearly (`Invalid model format`). An id the registry doesn't know
  crashes with `Cannot read properties of undefined (reading 'baseUrl')`.
  Verified resolvable: `anthropic:claude-opus-4-6`,
  `anthropic:claude-sonnet-4-5-20250929`, `anthropic:claude-haiku-4-5-20251001`,
  `google:gemini-2.5-pro`, `google:gemini-2.5-flash`, `google:gemini-3-pro-preview`.
  Verified *not* resolvable: `anthropic:claude-opus-5`, `anthropic:claude-sonnet-5`.
- **Resolving in the registry does not mean the key can call it.** The two
  checks are completely independent, and the registry is stale relative to what
  Google actually serves. `google:gemini-2.5-pro` resolves cleanly, prints in
  the startup banner, and then 404s: *"no longer available to new users."* Same
  for `gemini-2.5-flash` and `gemini-3-pro-preview`. `gemini-3.1-pro-preview`
  returns 429 with `limit: 0` — the free tier is allotted none of it, so it
  needs billing, not patience. Live-tested survivors on an AI Studio key:
  **`gemini-3-flash-preview`** and **`gemini-flash-latest`**, both 1M context.
  Budget a few minutes to probe models against the real key whenever the model
  changes; reading the registry is not a substitute. `scripts/probe-models.sh`
  does this in one command.
- **Read 404 and 429 as different facts.** A 404 means the model is retired for
  new projects — permanent, and no key recovers it (`gemini-2.5-pro`,
  `2.5-flash`, `3-pro-preview`, `2.0-flash` are all gone this way). A 429 with
  `limit: 0` means the model is live and you're tier-gated — fixable by
  enabling billing. A 503 is just transient: `gemini-flash-latest` failed once
  and passed twice on retry, so never condemn a model on a single 5xx.
- **Model access varies per key, but only within the Flash tier.** Three AI
  Studio keys tested. Two saw an identical list; the third additionally opened
  `gemini-2.5-flash`. No key opened any Pro model. Currently callable:
  **`gemini-3-flash-preview`**, **`gemini-2.5-flash`**, **`gemini-flash-latest`**
  — all 1M context. **Enabling billing should open `gemini-3.1-pro-preview`**,
  a generation newer than `2.5-pro` and the only realistic route to Pro-tier
  reasoning; the 2.5/3-pro 404s are permanent regardless of key. That's the
  upgrade path if Flash proves too weak for the multi-source search-and-cite
  loop.
  Note the registry's own `architect` agent ships `preferred: claude-opus-4-6`
  with no provider prefix and therefore cannot run unmodified — I had to pass
  `-m anthropic:claude-opus-4-6`. Assume registry manifests are pre-2.1.0.
- **Env precedence:** inherited shell → `~/.gitagent/.env` → `<agent-dir>/.env`.
  Last wins, so the agent-local `.env` beats a stale shell export. **An empty
  assignment in `.env` still wins** — a bare `GEMINI_API_KEY=` overwrote a valid
  key exported in the shell and produced "GEMINI_API_KEY is not set". Delete the
  line rather than blanking it.
- **Skills declared in `agent.yaml` that don't exist on disk fail silently.**
  Badger's manifest lists five skills; loading it prints no `Skills:` line and
  no warning at all. A typo'd skill name is therefore invisible — the agent
  just quietly loses a capability. Check the startup banner lists every skill
  you expect, every time.

## 8. Env vars Badger will need

`.env.example` couldn't be committed (blocked by a local permission rule), so
the contract lives here. Create `<repo>/.env` — it's gitignored — with:

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Model access (Google AI Studio). Required; the runtime exits if unset. Also used by `--voice gemini`. |
| `GITHUB_TOKEN` | GitHub MCP auth. Read-only scopes: `repo:status`, `public_repo`, `read:org`. Also used by the CLI's `--repo` mode. |
| `GOOGLE_OAUTH_CREDENTIALS` | Gmail + Drive OAuth client JSON path. Exact name depends on the server we pick. |
| `GITAGENT_USERNAME` / `GITAGENT_PASSWORD` | Web UI auth. See §9. |

## 9. The bundled web UI, and what it means for our own

Verified running: `gitagent --voice -d <dir>` (needs `@open-gitagent/voice`
installed globally) serves `http://localhost:3333`, HTTP 200, titled
`Gitagent: <agent name>`. Tabs: Chat, Skills, Communication, SkillFlows,
Scheduler, Logs, Settings, plus a file browser over the agent repo. Voice
degrades to text-only without a key; the agent still runs.

Voice defaults to OpenAI Realtime and wants `OPENAI_API_KEY`. `gitagent --voice
gemini` switches the backend to `gemini-live` and reads `GEMINI_API_KEY`.

**But don't use `--voice gemini` on our key.** Tried it: the server starts, the
browser connects, then `Connected to Gemini Multimodal Live` is immediately
followed by `Gemini WS closed`, and the chat pane never answers. The Live models
in the registry are `gemini-live-2.5-flash` and its native-audio variant — 2.5-era,
and every 2.5 model 404s on this project. Voice is therefore unavailable to us
until billing opens a newer Live model.

**Run the UI as plain `gitagent --voice -d <dir>` instead.** With no
`OPENAI_API_KEY` it prints "voice disabled, text-only mode", banners the same in
the UI, and leaves text chat running against `agent.yaml`'s Gemini model. That
is the configuration to demo and to host.

**The web UI creates and checks out a session branch.** Opening it left the repo
on `chat/20260816-223212`, and every commit made afterwards — including
deliberate ones — landed there while `main` silently stayed behind on the old
noisy history. Nothing is lost, but work can end up on a branch you did not
choose. Run `git rev-parse --abbrev-ref HEAD` after using the UI, and see the
git policy in CLAUDE.md.

**The text composer is broken in text-only mode.** The input exists in the DOM
but is laid out at a fixed `left: 810, width: 196` — a sliver in the middle
column, outside the chat pane, and off-screen entirely on a wide display. It
does not reflow: measured identically at three window sizes, with the FILES
panel open and closed. So the bundled UI cannot actually be typed into on this
build, which is why the demo path is the **CLI REPL** (`gitagent -d <dir>`,
then type at the `→` prompt). This is a point in favour of building our own UI
in phase 3 rather than extending theirs.

Chat messages travel over the **WebSocket**, not HTTP — the only chat HTTP
routes are `/api/chat/list|new|switch|delete|history`. So a custom UI built on
this server has to speak the WS protocol, not POST to `/api/chat` as I first
assumed. Worth reading `dist/server.js` before committing to extend it versus
hosting our own front end on the SDK.

**The file browser serves `.env`.** It's listed in the FILES pane and readable
through `/api/file`, so anyone who reaches the port can read `GEMINI_API_KEY`
and, later, the Google and GitHub credentials. Combined with `Auth: open` and an
always-loaded `cli` shell tool, treat this server as fully trusted-network-only
until `GITAGENT_PASSWORD` is set and it's bound to loopback behind TLS.

Two things worth having:

- **`/api/chat` already exists.** Also `/api/skills`, `/api/files`, `/api/logs`,
  `/api/schedules`, `/api/vitals`, `/api/settings`. Our custom search UI can be
  a front end over `/api/chat` instead of a new runtime host — worth reading
  the voice package's server before deciding to reimplement.
- **`/api/schedules` + the Scheduler tab + `dist/schedule-runner.js`** mean the
  scheduled digest agent is a built-in, not something we build. Check it before
  writing a cron.

**The UI is unauthenticated by default** — it logs `Auth: open` and will happily
serve anyone who can reach the port. It exposes a file browser and a shell-capable
agent. Before it goes on a VPS: set `GITAGENT_PASSWORD`, bind to loopback, and
put it behind TLS.

## 10. Other machinery we get for free

- **Hooks** (`hooks/hooks.yaml`): `on_session_start`, `pre_tool_use`,
  `post_tool_failure`, `post_response`, `pre_query`, `file_changed`, `on_error`.
  Each returns `allow` / `block` / `modify` — `modify` can rewrite tool args,
  which is a clean way to force `read_only: true` style parameters.
- **Audit logging**: enabled via `compliance.audit_logging`, writes tool calls
  and responses into `.gitagent/`. Turned on in our manifest — useful evidence
  for the "no writes ever happened" claim.
- **OpenTelemetry**: auto-initialises if `OTEL_EXPORTER_OTLP_ENDPOINT` is set;
  spans per tool call plus per-session cost in USD.
- **Learning tools**: `task_tracker` and `skill_learner` let the agent write new
  skills into `skills/` at runtime, with confidence scores (`/learned`). Powerful
  and unsupervised — decide deliberately whether Badger keeps it.
- **Plugins**: `gitagent plugin <install|list|remove>`; plugin tools are checked
  for name collisions against existing tools and skipped on conflict.

## Open questions for next session

1. Which Gmail and Drive MCP servers? Requirement: read-only surface, or narrow
   enough that our `pre_tool_use` deny-list is provably complete.
2. GitHub — remote `https://api.githubcopilot.com/mcp/` over HTTP with a PAT, or
   a local stdio server? Remote is less to run; local is easier to constrain.
3. Write the `pre_tool_use` deny hook **before** the first live credential.
4. Read the voice package's server to decide: extend `/api/chat`, or host our
   own UI against the SDK (`@open-gitagent/gitagent` also ships `./exports.js`
   as a library).

---

# §9. `tools/`, the SDK, and the docs site — read 2026-08-17

Source: the **installed runtime** (`/opt/homebrew/lib/node_modules/@open-gitagent/gitagent@2.1.0/dist/`)
cross-checked against **gitagent.sh/docs** (29 pages, JS-rendered — `WebFetch`
returns only the title, a browser is required). Where they disagree the dist
wins, and they do disagree.

## §9a. `tools/` is real, and it is not what the spec says it is

`dist/tool-loader.js` (186 lines) implements it. Confirmed working in 2.1.0.

    tools/<anything>.yaml

    name: search-github
    description: ...
    input_schema:
      properties:
        query: { type: string, description: ... }
      required: [query]
    implementation:
      script: scripts/search-github.mjs
      runtime: node          # default "sh"

Mechanics, from the code rather than the docs:

- Required keys are `name`, `description`, `input_schema`,
  `implementation.script`. **Anything missing and the file is skipped in
  silence** (`catch {}`), the same fail-quiet pattern as MCP servers. A typo
  costs a tool with no error.
- **The spec says `implementation.path`; the runtime reads
  `implementation.script`.** Following `spec/SPECIFICATION.md` §8 here produces
  a tool that never loads.
- Script path resolves to **`join(agentDir, "tools", script)`** — so
  `script: scripts/x.sh` means **`tools/scripts/x.sh`**, not the repo-root
  `scripts/`. Easy to get wrong.
- Protocol: args as JSON on **stdin**, result on **stdout**. Identical to the
  hook protocol. Non-zero exit becomes a tool error; stdout is parsed as JSON
  and unwrapped if it has `.text` or `.result`, otherwise passed through as
  text. 120s hard timeout.
- **`annotations` are read by nothing.** `read_only`, `requires_confirmation`,
  `compliance_sensitive` appear in the spec's tool schema and are absent from
  the loader. They are documentation, not enforcement — correcting the earlier
  claim in CLAUDE.md that they gave us a third machine-readable layer.

Load order in `dist/index.js` is builtin → declarative (`tools/`) → plugin →
MCP, then:

    tools = tools.map((t) => wrapToolWithHooks(t, hooksConfig, agentDir, sessionId));

**Every tool is wrapped, declarative ones included**, so `pre_tool_use` and
`hooks/allowed-tools.txt` gate custom tools exactly like MCP tools. Nothing in
`agent.yaml` filters declarative tools — they are appended unconditionally.

**Why this matters for Badger.** It answers the open wiring question. Rather
than trying to put a per-user, runtime-minted Composio MCP url into a static
`agent.yaml`, declare one tool we own:

    tools/search-github.yaml  ->  tools/scripts/search-github.mjs

The script holds the Composio session logic. The agent sees a single tool with
a name we chose, our allowlist gates that name, and the per-user session lives
in the script where it belongs. This also matches the framework authors' own
habit of reaching external services through a script rather than a wired
integration.

## §9b. The SDK has a real tool allowlist — correcting §4

An earlier note here says "there is no tool allowlist in the runtime". That is
true of the **CLI + `agent.yaml`** path and **false of the SDK path**. Verified
present in 2.1.0's `dist/sdk.js`:

| `query()` option | Effect |
|---|---|
| `allowedTools: string[]` | tool-name allowlist |
| `disallowedTools: string[]` | tool-name denylist |
| `replaceBuiltinTools: boolean` | skip cli/read/write/memory entirely |
| `tools: GCToolDefinition[]` | inject custom tools programmatically |
| `hooks: { preToolUse, onSessionStart, postResponse, onError, ... }` | in-process hooks, no shell scripts |
| `sandbox` | run inside an E2B cloud VM |
| `repo` | clone a remote agent repo and run it |
| `sessionId` | tag or resume a session |
| `result.costs()` | tokens + USD per query |

`buildTool` is exported (`dist/exports.js`, `dist/tool-factory.js`).

**Consequence.** Building the product on the SDK gives us *four* independent
read-only layers, two of them in-process and immune to the "hooks fail open"
problem: Composio's `DIRECT_TOOLS` preset + per-tool enable list, the SDK's
`allowedTools`, `replaceBuiltinTools: true` to drop `cli`/`write`/`edit`
outright, and the shell hook for the CLI path. That is a materially stronger
story than the CLI path alone, and it is the argument for building the product
on `query()` rather than shelling out to the `gitagent` binary.

## §9c. Native Composio exists — but not in our version

`docs/integrations` says GitAgent ships Composio support: set
`COMPOSIO_API_KEY`, run `gitagent --voice`, connect services in the web UI's
Integrations tab, and *"GitAgent tools map directly to Composio actions"*.

**Our installed 2.1.0 contains zero references to Composio** — `grep -ri
composio dist/` returns nothing. So that path is unavailable to us, and the
docs describe a build we do not have. (The site badges the harness **v1.5.0**
while npm gave us **2.1.0**; the versioning is not coherent between them.)

Two reasons not to chase it even if it lands: it maps toolkits wholesale, and
Composio's GitHub toolkit is 823 tools — the opposite of the 12-tool allowlist
we just verified. And it is configured through the web UI, i.e. not in git,
which contradicts the thesis. **Our own `tools/` wrapper is both available and
better.**

## §9d. Hosting, from `docs/security`

The hosting axis has a documented path:

- `GITAGENT_PASSWORD` (+ optional `GITAGENT_USERNAME`) puts basic auth on every
  HTTP route and rejects unauthenticated WebSockets; `/health` stays open for
  load balancers. Cookie is HttpOnly, SameSite=Strict, 24h, SHA-256 token.
- **"Never expose port 3333 directly"** — proxy via nginx, Caddy, or a
  Cloudflare Tunnel. `cloudflared tunnel --url http://localhost:3333` is the
  zero-config option and is the obvious demo route.
- `--sandbox` runs the agent in an isolated E2B cloud VM (`E2B_API_KEY`);
  `--sandbox-repo` clones a repo into it.

## §9e. Other corrections and useful bits

- `docs/architecture` and the landing page both show **`spec_version: "0.4.0"`**,
  while `spec/SPECIFICATION.md` and its JSON Schema default to `0.1.0` and every
  published agent uses `0.1.0`. Stay on `0.1.0`; it matches the validator.
- Built-in tools carry read-only metadata in the docs: **`read` is the only one
  marked read-only.** `memory` is *not* — worth knowing given we grant it.
- `task_tracker` and `skill_learner` are builtins that write; both are absent
  from our allowlist, which is correct.
- Skill frontmatter gains auto-generated fields when the skill learner
  crystallises one: `confidence`, `learned_from`, `learned_at`, `usage_count`,
  `success_count`, `failure_count`, `negative_examples`.
- Skills are invoked as `/skill:<name> <args>` in the REPL, or by passing that
  same string as a `query()` prompt.
- Two SDK cookbooks are directly on-point and worth reading before we build:
  `sdk/cookbooks/summarize-emails` (Gmail through a custom tool) and
  `sdk/cookbooks/custom-tool` (`buildTool()` wiring).

---

# §10. Citation verification, and why it cannot be a hook — 2026-08-17

## §10a. `post_response` is unusable for verifying anything

The plan was a `post_response` hook that checks Badger's citations before the
answer reaches the user. **It cannot work.** Two independent blockers, both in
`dist/index.js:122` and `dist/sdk.js:359`:

```js
// Fire post_response hooks (non-blocking)
runHooks(hooksConfig.hooks.post_response, agentDir, {
    event: "post_response",
    session_id: sessionId,
}).catch(() => { });
```

1. **It is fire-and-forget.** Not awaited, result discarded, and it runs after
   the text has already been written to stdout. It cannot block or modify.
2. **The payload is `{ event, session_id }` only.** The hook never receives the
   response text, so it has nothing to inspect. The SDK's programmatic
   `options.hooks.postResponse` is the same — `{sessionId, agentName, event}`,
   result discarded.

Only `pre_tool_use` (via `wrapToolWithHooks`) and `on_session_start` and
`pre_query` have their results honoured. Everything else is notification.

**So verification lives in the SDK caller**, which is the one place holding both
the tool outputs (`tool_result` messages) and the final answer (`assistant`).
`src/verify-citations.mjs` + `scripts/badger-sdk.mjs`. This is also the product
backend — the web UI will do exactly this and render the badge.

## §10b. `allowedTools` genuinely removes tools — measured

Claimed in §9b from reading `dist/sdk.js:175-178`; now confirmed by experiment.
Running with `allowedTools: ['github_search','read']` and explicitly instructing
the model to call `task_tracker`:

```
TOOL_USE: task_tracker
TOOL_RESULT isError= true   Tool task_tracker not found
```

The tool is absent from the model's schema. Gemini still *invented* the call —
worth knowing, models will hallucinate tools that were never offered — but the
runtime rejected it outright. This is **stronger** than the shell-hook path,
where the tool exists and is blocked at call time, and it cannot fail open.

Consequence for the product: run on the SDK with `allowedTools`, and keep
`hooks/allow-read-only.sh` for the CLI path. Two mechanisms, different failure
modes.

## §10c. Cost tracking works, and is worth surfacing

`result.costs()` on the SDK path returns real numbers. A representative
find-expert question:

    cost: $0.0039 — 7874 in / 352 out

Confirms the earlier order-of-magnitude estimate. Worth showing in the UI: a
per-answer price supports the federated-live-search argument against
maintaining an index, and it is a number a buyer asks for.

## §10d. What the verifier does and does not prove

`verifyCitations(answer, toolOutputs)` extracts URLs, `#123` references and
repo-relative file paths from the answer and requires each to appear in the
concatenated tool output. Findings are typed: `malformed-url`,
`unretrieved-url`, `unretrieved-reference`, `unretrieved-path`.

Tested against the real failure observed earlier —
`https://github.alanmathews9/arkind-internal/issues/15`, the `.com` dropped
while copying — which it catches as `malformed-url`, alongside invented issue
numbers and invented file paths, while passing an honest answer.

**It proves a cited source was retrieved. It does not prove the answer
characterises that source correctly** — quoting real issue #18 but
misrepresenting Priya's position would pass. Fabricated sources are the failure
that actually occurs; this kills that class and nothing more. Say so plainly
rather than overclaiming, since overclaiming is the exact sin the agent exists
to avoid.

`scripts/badger-sdk.mjs` exits non-zero on an unverified citation, so it can
gate a demo or CI.

## §10e. The runtime orders every agent to call `task_tracker`, and you cannot switch it off

`dist/loader.js:250` pushes a **"# Task Learning & Skill Discovery"** block into
the system prompt of every agent the runtime starts. It is unconditional — no
manifest key, no config, no gate — and it says, in capitals:

    1. FIRST: Call `task_tracker` action "begin" with your objective
    IMPORTANT: Do NOT skip step 1. Even for tasks that seem simple, always
    check for skills first.

Both tools it names write. `task_tracker` persists `tasks.json`
(`dist/tools/task-tracker.js` opens with `writeFile`/`mkdir`); `skill_learner`
writes new skills into `skills/`. Neither belongs in a read-only agent's
allowlist, so `allowedTools` removes both from the model's schema (§10b).

**The result is an agent ordered in capitals to call a tool it cannot see, and
Gemini obeys.** It calls `task_tracker`, receives "Tool task_tracker not found",
and treats that as a blocked task rather than a missing tool. Observed in
production on the flagship question: the answer opened with "I cannot access
`task_tracker`", narrated a search plan it never carried out, and reported no
citations — while the retrieval pass beside it had already returned the right
issue first. Three eval questions failed outright the same way.

A `RULES.md` rule is not enough on its own; it is one instruction arguing with
another, and the runtime's arrives inside the same system prompt.

**The lever is `options.systemPromptSuffix`.** `dist/sdk.js:122` appends it after
everything else, so it is the last thing the model reads. `app/server/
system-suffix.mjs` uses it to name the injected section, say it does not apply,
and forbid telling a user that a tool is missing. All three SDK callers pass it —
the CLI wrapper, the eval runner and the server — and `RULES.md` keeps the same
instruction for the CLI path, which never goes through the SDK.

Two things worth carrying forward from this. **Read the shipped system prompt,
not just the shipped tool list** — the runtime injects several blocks the docs do
not mention, including the workspace-directory advice that is dead for a
read-only agent. And **"the model is being unhelpful" is worth one look at the
prompt before it is worth any prompt engineering**; this looked like Flash being
timid for two days and was a hardcoded instruction the whole time.
