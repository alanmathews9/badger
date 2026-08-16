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
