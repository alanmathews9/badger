# Badger

Glean-style workplace search agent, built on the GAP standard (gitagent.sh).
Submission for a hiring task.

**This file is for developing Badger. To *use* Badger — answer questions as
the agent, with any harness — follow `AGENTS.md` instead.**

## The task, as given

> Use https://www.gitagent.sh/ to build a Glean equivalent. Your ability to do
> your own research, understand the agent framework, visualize good designs,
> build, and host the agent will be critical for us to evaluate.

Evaluation is on five axes, not one: **research, framework understanding,
design, build, hosting.** Work that only moves "build" forward underweights
four fifths of the grade.

---

# START HERE — state as of 2026-08-19

**The next build is PLAN-AGENT-ON-INDEX.md step 4 — Composio Triggers —
then that plan's docs step, then the single batched deploy (21+ commits
waiting; Alan calls the deploy, never you). Steps 1–3 of that plan are done
and gated: incremental refresh on a timer (default 2h,
BADGER_INDEX_REFRESH_HOURS), and the agent's search tools answer from the
local index with the live path as second look — eval 14/15 against a 13/15
same-day baseline.**

What else changed on 2026-08-19, all pushed to GitHub
(`alanmathews9/badger`, public — pushing IS allowed on Alan's word, he asked
for it twice today):

- **The seed toolchain is deleted from HEAD** (Alan's call: a corpus in the
  repo reads as answering from local files). Recoverable from git history.
  The eval's graded facts are pinned in evals/questions.mjs.
- **No more demo defaults in tools.** BADGER_GITHUB_REPO is REQUIRED for the
  GitHub source (tool output says how to set it; Gmail/Drive work without
  it); BADGER_USER_ID defaults to neutral "default". Demo identity lives in
  .env and in the deploy command's --set-env-vars — **the next deploy MUST
  pass BADGER_USER_ID and BADGER_GITHUB_REPO or production loses the
  corpus** (command updated below).
- **The harness path is first-class in the README**: clone + `claude "Be
  Badger — follow AGENTS.md."` needs only the Composio key — no Google, no
  model key. Verified end to end by Alan; the registry's `-a claude` adapter
  does not exist in the shipped gitagent 2.1.0 (read from its dist), so this
  one-liner is the adapter until theirs ships.
- Composio Triggers verified affordable (50K events/month free) and their
  catalogue read from the live API — coverage notes are in
  PLAN-AGENT-ON-INDEX.md, which also records why chat-on-index went first.

---

# The state before that — 2026-08-18, night (still-true background)

**The corpus is seeded, the eval set exists, search has been rebuilt, the app
has had a cleanup pass, and production is nine commits behind. There is also an
independent review from Fable that is not yet in this repo — get it before
deciding anything.**

Badger searches GitHub, Gmail and Drive, merges the results on one locally
computed score, and answers with citations it verifies. The corpus it searches
is now Arkind-the-clinic-booking-company, in all three places at once:

| source | what landed | verified |
|---|---|---|
| GitHub | 21 files, 22 issues / 91 comments, 8 PRs, 13 review comments, 34 commits over 16 days | yes |
| Drive | 23 documents, 6 spreadsheets, 6 comment threads, 10 folders | yes |
| Gmail | 15 threads, 52 messages, 2026-01-28 → 2026-07-09 | yes |

Every one of those numbers was read back from the API after seeding, never from
a seeder's exit code. The retired Halden mail is in Trash (30 days), the old
Drive corpus was removed by Alan by hand, and the old repository was deleted by
Alan before the re-seed.

## The task in front of you — read this first

**The local search index is BUILT — `PLAN-SEARCH-INDEX.md` steps 1–5 are
done as of 2026-08-18 night (plan agreed with Alan that day; items 1–3 of
the Fable review were already done — memory live, audit covering the SDK
paths, enforcement settled below).** What landed: `npm run index` crawls all
three sources through the existing read-only allowlists into
`.gitagent/index/` (178 docs, 173 calls, ~40s, counts verified against the
live APIs); `createSearcher` in `tools/scripts/_index.mjs` answers with BM25
+ real IDF and visible typo correction ("paymnets" → payments,
"brigthsmile" → brightsmile, both measured); `/api/search` is index-first —
3ms and 0 API calls against 5.4s and 10 calls live, same query same minute —
with the live path as fallback when the index is missing or >24h old, one
lazy background build (verified end-to-end against the running server), and
`path` + index age in every response. Files and commits now appear in search
results, which live GitHub search structurally cannot do. `npm run
test:index` is nine deterministic cases needing no key. The agent's own
tools stay live-only in this arc, by plan — wiring them onto the index is a
follow-up decision that wants eval evidence.**

**Four things, in this order. The first one gates the rest.**

**1. Get the Fable review from Alan, and work it into a list.** Alan
commissioned an **independent review of this project from Fable** and says there
are things in it that need fixing. **None of it is in this repo, and none of it
is in this file** — nothing below has been checked against it. Ask him for the
findings before planning anything else, because they may well change what is
worth deploying and in what order. Do not guess at what the review says; do not
assume the sections below already cover it.

When the findings arrive, write them into this file as a list before starting
work on them. A review that lives only in one session's context is lost at the
next `/clear`, which is exactly how the four hardcoded status indicators
survived as long as they did.

**2. The agent calls skill names as tools, and gives up.** Found 2026-08-18
while checking the cleanup for regressions, and **it is not new** — it
reproduces on untouched `HEAD`. Asked *"Have we decided to rewrite the sync
layer a third time?"* the agent calls `trace_decision`, is told there is no such
tool, and answers:

> I cannot use `trace_decision` as it is not an available tool. I can search
> through Drive, Gmail, and GitHub for information. Would you like me to?

Same for `find_expert` on the NHS accessibility question. It costs **two of the
fifteen eval questions**, in both runs measured, and it is the single largest
identified gap between the eval score and full marks.

This is the **same failure mode `SYSTEM_SUFFIX` was written to kill** for
`task_tracker` — the model treating a name it saw in its prompt as a callable
tool, then reporting the failure to the user instead of doing the work. So the
suffix already says "Never tell the user that a tool is unavailable", and it is
not holding for skills. Two candidate causes, and **neither has been
established** — measure before fixing:

- the runtime registers skills in a way that makes them *look* callable
  (a name in the system prompt with no matching tool), or
- Flash is inventing the call from the skill list in the prompt.

The cheap probe is to print the model's actual tool schema for one run and see
whether `trace_decision` is in it. If it is, this is a registration problem; if
it is not, it is a prompt problem and belongs in `SYSTEM_SUFFIX` or in the way
skills are described.

**3. Deploy.** Production is **nine commits behind** and shows none of the work
below — it still says "Demo session", still marks Drive and Gmail "not
connected" behind a "coming soon" tooltip, still suggests "Why did the Halden
engagement slip?", and still runs the agent on every search. Alan has asked that
deployments be **conserved**, so batch the Fable fixes with everything already
waiting and deploy once. Registry is at 258MB of the 500MB free tier — about
four deploys of headroom this week. The exact command is under "Also
outstanding".

**4. Whether the agent belongs in search at all.** It is now *off* the search
path, which was done to make the question askable rather than to answer it. The
options as they stand: never (search is a search box, Chat is where you ask); on
demand (results instantly, plus a "summarise these" button); or conditionally by
question shape (sounds clever, will misfire invisibly). Alan's instruction was
"let's refine search first, and then move from there."

### The cleanup pass — done 2026-08-18 night, commit `9c2cd11`

Alan called it: *"we are going all over the place, and need to make sure what
we're working on is maintainable."* One commit, 30 files, **836 lines net
removed**. What matters for the next session is not the deletions but the three
defects the pass turned up, all one root cause — **Chat was never updated when
the corpus went from one source to three**:

- **Mail and Drive citations were extracted, verified, counted, and then
  dropped.** `resolveCitations` iterated only issue numbers and file paths, so
  the badge could read "6 citations, all retrieved" above a grid saying "This
  answer cites nothing". Measured on the Brightsmile question: three source
  cards where there had been none.
- **Every source card rendered the GitHub mark**, as a literal string. Search
  results were always correct — this was only the numbered cards under an
  answer, which is why it survived being looked at.
- **`recordOpened` knew the three GitHub read tools**, so a mail thread or Drive
  document opened in full counted as nothing. `describeTool` had the same gap
  and showed the raw slug `gmail_search` on screen while searching.

Also removed: the connect / repo-picker stack (six endpoints, five client
functions, most of `connections.mjs`) — the Manage pane that drove it was
deleted when the seeded corpus became the product, and it cascaded, because
with no way to connect your own GitHub `mode: "own"` was unreachable. The
`account` argument threaded through six call sites into an `exec()` that takes
three parameters. `resolveContext().label`, never read, and it cost a live API
call to build. `scripts/probe-models.sh` and `scripts/mcp-tools.mjs`. Three
overlapping icon sets became one. `strict: true` is now on in both tsconfigs —
the tree already passed clean, so it cost nothing.

**A method note worth keeping.** The eval read 10/15 after the cleanup, against
a 13–14 baseline. That was **not** reported as fine and **not** reported as a
regression: the whole change was stashed and the eval re-run on untouched
`HEAD`, which gave 11/15 with *different* questions failing. Only then was it
called sampling noise. One eval run is a sample. Compare against a re-measured
baseline on the same day, never against a number written down last week.

The inventory the corpus was built from, approved by Alan on 2026-08-18, is
still the reference for what each artefact is *for*:
<https://claude.ai/code/artifact/68231172-f636-4e69-a593-aa7ec4a98408>

### What changed on 2026-08-18, after the corpus landed

- **Search is retrieval only.** A Dig used to fire the agent and the retrieval
  pass together, so every search — including a lookup — spent a model call and a
  slot from the 250/day answer budget, and a thin answer made good retrieval look
  broken. `/api/search` now touches no model: `claimAskSlot` is reached only from
  `/api/ask`, the budget reads 0/250 after a search, and nothing on the path
  imports the runtime. It is not free of everything — one search is ~17
  third-party API calls and ~4.8s, mostly Drive body fetches and GitHub comment
  lookups, which is the lever if search needs to *feel* faster.
- **Ranking actually ranks.** `tools/scripts/_rank.mjs` is now the one
  implementation, shared by the agent's tools and the web search (`app/server/
  rank.mjs` re-exports it — it lived under `app/` before, where the agent is
  forbidden from importing it, so "shared" was a fiction). Three fixes: all three
  tools **over-fetch, rank, then cut**, because re-sorting the ten rows an engine
  returned cannot surface the one it ranked eleventh; `weightsOver` computes a
  document frequency across the candidate pool, so a term in every row stops
  deciding the order; and `termPattern` allows an inflection but requires a
  boundary, so "app" no longer matches "Apple" while "weeks" still finds "week".
- **Drive is scored on names only**, deliberately. Bodies are fetched for the
  top few files, and scoring those on their text while scoring the rest on their
  name let fetch order leak into relevance.
- **Titles are marked server-side** (`markTerms`). The browser had a third regex
  with no boundary and marked the "app" inside "happened".
- **The UI stopped calling itself a demo** and now names the account behind each
  source. The Manage pane is deleted, and as of `9c2cd11` so are the
  endpoints behind it — see the cleanup pass above.
- **`npm run eval`** — fifteen questions, deterministic grading, ~5c a run,
  non-zero exit on failure. Baseline 13–14/15; the model is non-deterministic so
  a single run is a sample, not a score.

**A pattern worth carrying:** four separate indicators were hardcoded to a happy
value — Drive and Gmail reading "not connected" while being searched, a "coming
soon" tooltip on two shipped integrations, a green dot that could not turn any
other colour, and a citation verifier that could not fail because it read a
field that does not exist. Each was written before the thing behind it existed
and never revisited. Distrust any status display that has never been seen wrong.

**Arkind is now a SaaS company: appointment booking for small clinics.** Dentists,
physios and vets use it so patients can book online, get a reminder and leave a
deposit. 40 people, 6 departments, Bengaluru and Lisbon.

Why it changed: a consultancy's work is abstract — scope, weeks, billing — so
every answer needed a glossary and an evaluator could not tell a good answer
from a bad one. "Why did Halden slip?" was answered with reconciliation modules
and compressed discovery. Nobody can judge that. A reminder text arriving at
3am is wrong in a way anyone can judge instantly. **Legibility is the point of
the rewrite**; better retrieval precision is a secondary benefit, because when
every document is about the same abstraction, term coverage has nothing to
discriminate on.

The central story keeps Halden's *shape* and changes its subject: **the Android
app shipped five weeks late.** Drive's release notes blame App Store review;
GitHub issue #8 says the sync layer was rewritten twice and review took 4 of
the 35 days; the Gmail thread shows the team choosing that wording. PR #30 sits
closed and unmerged as hard evidence of the first rewrite.

### Decisions already made — do not relitigate

- **Reserved domains only.** Staff `@arkind.example`, customers
  `@brightsmile.example`. RFC 2606 reserves these permanently. This is not
  fussiness: `brightsmile.com` is a **real registered domain**, checked, and the
  old corpus would have shown a real company being misled about a delivery date.
  Nothing is ever sent — `GMAIL_IMPORT_MESSAGE` writes to the mailbox without
  SMTP — but the addresses are still visible to anyone reading the demo.
- **Write the repository files, do not clone one.** GitHub code search does not
  serve private repos at all (§4e), so a large third-party codebase would be
  bulk Badger cannot search, and it would contradict every issue we write. ~25
  small files, sized so that every issue naming a file has a file to name.
- **A new GitHub account, `alan-arkind`, holding one repository.** The old
  `alanmathews9` connection carries account-wide OAuth scopes and can reach
  every private repo Alan owns. One account with one repo makes the credential
  restricted *by fact* rather than by our tool layer declining to look — the
  strongest read-only story available, since GitHub has no read-only scope for
  private repositories.
- **Customer support mail is part of the corpus**, at Alan's request: five
  threads where a clinic reports a problem and support answers. It connects a
  customer's words to an engineering issue, shows what support promises versus
  what policy says, and supplies the ordinary traffic retrieval must
  discriminate against.

### Order of work — status as of 2026-08-18, late afternoon

1. ✅ `scripts/seed/company.mjs` — the cast (15 named of 40, 9 departments), 4
   customers with contacts, and `FACTS`: every date and number the three sources
   are built to disagree about. **Every corpus module imports from here and
   restates nothing**, which is what keeps the authored contradictions authored.
   It replaced `scripts/seed/people.mjs`, which is now deleted — every corpus
   module reads the cast from here.
2. ✅ `scripts/seed-github.mjs` (`npm run seed:github`, `--dry-run`, `--force`)
   plus `corpus-github.mjs` and its three parts: 21 files, 22 issues with 91
   comments, 8 PRs with 16 branch commits, 23 conversation and 13 review
   comments. ~321 write calls, ~5 minutes.
3. ✅ `corpus-drive.mjs` rewritten **and seeded** on 2026-08-18, after Alan
   emptied the Drive account by hand: 23 documents, 6 spreadsheets, 6 comment
   threads, 10 folders, all verified live. `node scripts/seed-google.mjs
   --drive`, exit 0, ~2 minutes. Drive was genuinely empty first — checked with
   `GOOGLEDRIVE_FIND_FILE`, not taken on trust — because the new root folder is
   also called "Arkind" and two of them would have returned both the clinic and
   the consultancy story to every search.
4. ✅ `corpus-gmail.mjs` **rewritten and seeded** on 2026-08-18: 15 threads,
   52 messages, January to July 2026. `scripts/seed-google.mjs` is repointed at
   `company.mjs` and `people.mjs` is deleted. Verified live — 52 messages in 15
   threads, and the date range Gmail reports is 2026-01-28 → 2026-07-09, which
   is the corpus's own span, so `internal_date_source: "dateHeader"` held and
   the timeline did not collapse into today.
5. ✅ Old corpus removed. The Halden mail was trashed with
   `node scripts/seed-google.mjs --reset-gmail arkind.dev haldenlogistics.nl`
   **after** the new corpus was seeded and verified, never before — the new mail
   is reproducible from source and the old was not. `--reset-gmail` now trashes
   the domains you name *instead of* the current corpus rather than as well as
   it, so pointing it at a retired corpus cannot take the live one with it.
   ⏳ `alanmathews9` is already disconnected; nothing left to do there.
6. Update README, this file, and the skills.
7. Then the eval set (below).

#### Where the GitHub corpus actually stands — read before touching it

**Re-seeded from scratch on 2026-08-18 after Alan deleted the repository, and
this run is the good one.** `alan-arkind/arkind` holds 21 files, 22 issues with
91 comments, and 8 pull requests: #23–#27 merged, #28 and #29 open, #30 closed
and unmerged. Verified against the live API rather than the seeder's exit code —
34 commits on `main` spread over **16 distinct days from 2024-11-19 to
2026-08-18** and authored by nine members of the cast, 13 review comments
attached, `handbook/leave.md` stale against Drive as designed, and
`"App Store review"` returning exactly #8.

The date spread is the whole point of the rewrite: the previous run stamped all
29 commits inside one 16-minute window, which made every time-bounded question
and the `activity-digest` skill meaningless. Commits now go through
`CREATE_A_BLOB`/`CREATE_A_TREE`/`CREATE_A_COMMIT`/`UPDATE_A_REFERENCE` and merge
with **rebase, not squash**, so the authored dates survive onto `main`. The
`.probe-a`/`.probe-b` droppings are gone with the old repository.

One cosmetic blemish left, not worth rewriting history for: the root commit is
`auto_init`'s "Initial commit", authored by `alan-arkind` and dated today, while
everything above it is correctly backdated.

Two bugs found in the rewritten seeder by running it, both now fixed and
commented in place:

- **`reviewAnchors()` was called and never defined.** It would have thrown a
  `ReferenceError` at PR #23, roughly 250 calls into the run. It now reads
  `GITHUB_LIST_PULL_REQUESTS_FILES` (payload under `details`) and parses the
  first `+` line out of each file's own diff hunk.
- **`GITHUB_UPDATE_A_REFERENCE` wants `heads/main`, not `refs/heads/main`** —
  despite its schema saying "fully qualified" and giving `refs/heads/main` as
  the example. Composio drops the value straight into the URL path, so the
  qualified form requests `git/refs/refs/heads/main` and answers 422 "Reference
  does not exist". This cost the first run. `GITHUB_CREATE_A_REFERENCE` is the
  opposite and does want `refs/heads/...`, because there the ref travels in the
  body. **Rule: a ref in the path is unqualified, a ref in the body is
  qualified.**

Because the failure landed after the repository was created, the recovery was
`--force` rather than a fourth deletion request.

Measured while building this, and all three cost a failed run:

- Composio rejects GitHub's own `subject_type: "file"` on review comments and
  demands a line. The seeder reads the first added line out of the PR's own
  diff rather than guessing one.
- **Every Composio GitHub tool returns its payload under a different key** —
  `details` for PR files, `commits`, `comments`, `content`. Print the keys
  before parsing.
- Issue and PR numbers share one sequence, so all 22 issues must be created
  before the first PR for the corpus's own cross-references to resolve. The
  seeder asserts every number it is given.
- `created_at` on issues and PRs cannot be backdated at all. Only commits can.
  Every date that matters therefore lives in body text.

**Connection state as of 2026-08-18, verified.** One connection per toolkit on
`badger-demo-alan`:

| toolkit | id | account |
|---|---|---|
| github | `ca_fk0Ag9CXHdls` | `alan-arkind` — **0 repositories visible** |
| gmail | `ca_VoNP76DmcIf9` | the demo Google account |
| googledrive | `ca_ZC7_ieFDmyMY` | " |
| googledocs | `ca_HLaG2xlx-pa2` | " |

`alanmathews9` was disconnected on Alan's instruction, because two GitHub
connections cannot coexist (below). **The old Halden corpus is therefore
unreachable to Badger** — the repository itself is untouched and still on
GitHub, so this is reversible by reconnecting.

Worth stating in the README once the new corpus lands: the credential currently
reaches **zero** repositories and will reach exactly one. That is a read-only
story enforced by fact rather than by our tool layer declining to look, which
is the best available given GitHub has no read-only scope for private repos.

Nothing else is deleted until the replacement is verified.

### Per-account targeting does not work, and the multi-account feature is broken

Measured 2026-08-18, after connecting `alan-arkind` alongside `alanmathews9`
on the same Composio user.

**A session cannot be told which connected account to use.** Passing
`connectedAccountId` inside the tool arguments — which
`tools/scripts/_github.mjs` and `app/server/connections.mjs` both do — is
silently ignored: it is forwarded to GitHub as an unknown field and dropped.
The real parameter is the third argument to `execute()`,
`{ account: "<id>" }` (`ToolRouterSessionExecuteOptions.account`), and on this
project that returns:

    400 The 'account' parameter is not supported for this project.
        Multi-account selection is not enabled.

So with two connections attached, **Composio picks one and there is no way to
override it.** It picked the newest: every call resolved to `alan-arkind`,
`GET_THE_AUTHENTICATED_USER` reported that login for both account ids, and
`alanmathews9/arkind-internal` became invisible.

Three things follow.

1. **"Manage connections: several GitHub accounts, each disconnectable"
   (commit `87a2739`) does not do what it says.** ✅ **Settled by deletion in
   `9c2cd11`** — the whole connect stack is gone rather than reduced, because
   the seeded corpus is the product and nothing called it. The rest of this
   item is kept as the measurement that justified removing it. The UI lists accounts, labels
   them and lets you pick one, and the picking has no effect on where tool
   calls go. `labelAccounts` also mislabels: it calls
   `GET_THE_AUTHENTICATED_USER` once per account and every call returns the
   same login, so two accounts appear under one name. This needs either
   removing or reducing to "one connection per source, disconnect and
   reconnect to switch" — the honest version of what the platform supports.
2. **Exactly one GitHub connection may be attached at a time.** Seeding the new
   repo requires the old connection gone first, or the seeder may create the
   repository under the wrong account.
3. `connectedAccountId` should come out of `exec()` in `_github.mjs`. It reads
   as enforcement and enforces nothing, which is worse than its absence.

The same limit applies to Gmail and Drive; they have one connection each, so
nothing is broken there today.

### After the corpus: accuracy, then UI

Alan's three remaining goals, in the order agreed: **accuracy**, then **UI**,
then possibly indexing. Indexing is still last, but the claim that retrieval is
not what fails **turned out to be wrong** — see the defect fixed below, which
was retrieval and nothing else.

#### Fixed 2026-08-18 — no agent search tool ranked its results

Asked *"Did we tell Brightsmile the app would be ready in March?"* — the
question the whole `brightsmile-when` thread exists to answer — Badger searched
Gmail, got ten results, opened none, and said it could not find it. The thread
was there and so were the words.

Two faults, and the second is the one that mattered.

1. **`app/server/rank.mjs` was called "shared by every source" and was used by
   the web search alone.** All three agent tools returned their engine's
   ordering untouched. `drive-search.mjs` even carried a comment claiming it
   ranked locally; it only excerpted. The scoring could not be shared, because
   it lived under `app/` and **the agent may not import from `app/`** — the
   boundary `npm run check:agent` enforces. It now lives in
   `tools/scripts/_rank.mjs` and `app/server/rank.mjs` re-exports it, which is
   the only direction that boundary allows.
2. **Ranking alone would have fixed nothing.** The engine caps the pool before
   we ever see it: asking Gmail for ten and re-sorting those ten still misses a
   February message that was never in Gmail's ten, because for an OR'd query
   Gmail's order is effectively newest-first. All three tools now **over-fetch,
   rank, then cut** — Gmail 4x the requested limit, GitHub and Drive 3x.

Measured after: the correct thread went from *absent from the top ten* to rank
1, and the agent answers the question with three verified citations, opening two
threads where it previously opened none.

Drive's ranking is deliberately weaker than the other two and the code says so:
Drive returns no body text, so a file can only be scored on its name.
`fullText contains` is what got it into the list, so every row matched
somewhere; what we can order on is whether the match is in the title.

**This does not retire the eval set — it is the argument for it.** The defect
was found by asking one question by hand, on the first try, after the corpus had
been declared verified. Nobody knows what the other fourteen questions do.

#### Settled 2026-08-18 — where tool enforcement actually happens, per path

A run on 2026-08-18 reported calling `task_tracker` and `skill_learner`,
neither of which is in `hooks/allowed-tools.txt`. Resolved by reading the
shipped code rather than probing:

- **On the SDK path, `allowedTools` removes builtins from the model's schema.**
  `sdk.js` assembles one list — builtins first (`createBuiltinTools`: cli,
  read, write, memory, task_tracker, skill_learner), then declarative, plugin
  and MCP tools — and filters *all of it* (sdk.js:175). The earlier guess that
  "the runtime injects its own builtins regardless" was wrong.
- **The transcript showed a hallucinated request, not an execution.** A call to
  an unregistered tool is answered by the agent loop itself with an error
  result — `pi-agent-core/dist/agent-loop.js:326`, `Tool <name> not found`.
  The hook never saw it: a filtered tool does not exist to be wrapped.
- **Script hooks do run on the SDK path** (sdk.js:184-187 wraps every
  registered tool), so `allow-read-only.sh` still gates everything that
  exists. On the **CLI path** there is no `allowedTools`, builtins like `cli`
  and `write` are registered, and the hook is the only refusal. Defence in
  depth is real, but different layers do the work on different paths.

**✅ The eval set exists** — `evals/questions.mjs`, run with `npm run eval`.
Fifteen questions, deterministic grading (`mustCite` against tool output,
`mustSay`, `mustNotSay`), non-zero exit on failure, about five cents a run.
Baseline 13–14/15. It found four defects on its first run and has caught two
more since, including two bugs in itself — read the header comment before
changing it, particularly the note on why grading is not model-judged.

**Two known failures, both answer completeness rather than retrieval.** Asked
for the refund policy the agent gives the policy but not always the exception
Marta made; asked why Clearview left it names the outage but not always that the
customer explicitly ruled out price. Both are seams where half the answer is the
interesting half. That is the next accuracy work if it is wanted.

**Vertex Pro access is dropped**, on Alan's call 2026-08-18: "I don't think it's
ever going to happen. We need to build the agent in a better way to get the
tasks done." Treat Flash as the ceiling and spend the effort on tool design and
what tools return — which is where every win so far has actually come from.

### Also outstanding

- ⚠️ **Production is TWENTY-ONE commits behind as of 2026-08-19** (the
  nine below plus the whole index/refresh/chat-on-index/cleanup arc). What
  follows describes the last deploy, which is revision `badger-00003-zfh` —
  accurate about that revision, and no longer a description of `main`.
  Revision `badger-00003-zfh`,
  serving 100% of traffic. It carries Gmail, Drive, cross-source search, the new
  corpus, the ranking fix, the eval set and the rewritten README. Verified from
  outside: `/`, `/api/search`, `/api/ask` and a built asset all 401
  unauthenticated, a forged cookie is refused, and `/api/health` answers.
  **Artifact Registry is at 258.5MB of the 500MB free tier** — roughly four more
  deploys of headroom this week, after which the seven-day rule sweeps the old
  images; the keep-three policy caps the steady state either way. The image for
  revision 00001 was deliberately left in place so it stays rollback-able.

  The deploy that produced this, for repeating it:

      gcloud run deploy badger --source . --region us-central1 \
        --service-account badger-run@$PROJECT.iam.gserviceaccount.com \
        --allow-unauthenticated --max-instances 1 --concurrency 20 \
        --set-env-vars GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_CLOUD_LOCATION=us-central1,NODE_ENV=production,BADGER_USER_ID=badger-demo-alan,BADGER_GITHUB_REPO=alan-arkind/arkind \
        --set-secrets COMPOSIO_API_KEY=badger-composio-api-key:latest,BADGER_SESSION_SECRET=badger-session-secret:latest,BADGER_PASSPHRASE=badger-passphrase:latest

  `--set-env-vars` replaces the whole set rather than adding to it, so all five
  have to be named every time or Vertex loses its project and the container
  fails on its first answer. **BADGER_USER_ID and BADGER_GITHUB_REPO are new
  and REQUIRED as of 2026-08-19** — the hardcoded demo defaults were removed
  from the tools (the repo default is gone entirely, the user id falls back to
  "default", which has no connections), so a deploy without them serves a
  Badger that cannot reach the demo corpus.
- ✅ **The passphrase was rotated on 2026-08-18** — version 2 of
  `badger-passphrase`, live on revision 00003. Alan holds it; it is written down
  nowhere. For the next rotation, and note that
  **his shell is zsh**, where `read -p` means "read from a coprocess" and the
  bash form fails with `read: -p: no coprocess`. In zsh the prompt attaches to
  the variable name:

      read -rs 'P?New: ' && printf '%s' "$P" |
        gcloud secrets versions add badger-passphrase --data-file=- && unset P

  **`printf '%s'` matters** — `auth.mjs` compares exactly with no trimming, so a
  trailing newline from `echo` silently refuses every login. Needs a redeploy to
  take effect, since the secret is mounted as `:latest` and resolved at instance
  start.
- Billing budget alert still unset (console job). Chat history not persisted.

---

## The state before all that — still true

**Badger is built, gated and hosted.**
**https://badger-1033557908241.us-central1.run.app** — the passphrase is held
only in Secret Manager (`badger-passphrase`) and is not written down here or
anywhere else in the repo. Alan set it directly; nobody else has seen it. Ask
him rather than looking for it. The old `glean-me` is in git history and is
now worthless, which is the point of having rotated it rather than trying to
rewrite the history it appears in.

Ask it a question and it searches, opens the threads, answers with citations,
verifies those citations against what it actually retrieved, and reports the
cost. Read-only holds at four independent layers.

    ./scripts/badger.sh -p "Who knows about payments integrations?"   # CLI
    npm run ask "What shipped in the last week?"                      # SDK + verification
    npm run serve                                                     # web UI on :4000
    npm run check:agent                                               # the agent still stands alone

**Done 2026-08-17/18 and no longer open:** Gmail and Drive are connected and
seeded, the agent has five Google tools, `/api/search` merges all three sources
on one locally computed score, citation verification covers mail and documents,
and the README exists. The demo fallback is now **on** by default, so a visitor
who connects nothing searches the seeded corpus.

What remains is in the task section above.

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

- **The web product** in `app/` — Vite + React + Tailwind + shadcn, a sidebar
  shell with three destinations: **Search**, **Chat**, **Tools**.
  `POST /api/search` retrieves live with no model involved; `GET /api/ask`
  streams the agent over SSE with tool calls forwarded as they happen. Two
  passes, the split Glean and Onyx both use. The sidebar's usage meter is real
  — it reads the answer budget from `/api/health`.
- **A gate, not an account system** — one shared passphrase, server-side, so an
  unauthenticated visitor receives a splash page and nothing else: no bundle,
  no API, no assets. Signed cookie (`uid.expiry.hmac`), constant-time compare,
  CSP + `Referrer-Policy: no-referrer` + HSTS, generic 500s. With no passphrase
  set the server binds to 127.0.0.1 only — fail safe, and there is no default
  passphrase. Rate limits per IP, a daily answer ceiling and a concurrency cap;
  when the budget runs out search still works and the card says so.
- **Per-user connections — REMOVED in `9c2cd11`, and this is now history.**
  The cookie's `uid` was the Composio end-user id, so each visitor could
  connect their own GitHub from a side pane on Tools. Two things killed it:
  Composio cannot target a second connected account on this project (measured,
  §"Per-account targeting does not work"), and the pane was deleted when the
  seeded corpus became the product, leaving six endpoints nothing called. The
  design story still holds — Badger never receives a source token, Composio
  issues the Connect Link and holds the credential — and `app/server/
  connections.mjs` records what restoring it would take.

## What does not exist

**Gmail and Drive are not connected — that is the next job, and it is now the
whole job.** Everything else on the five graded axes has substance.

Also absent, deliberately: no database, so chat history is not saved and
"recent digs" is localStorage; no fuzzy or semantic search (see the retrieval
section — it is structurally unavailable while federated).

## Hosted — https://badger-1033557908241.us-central1.run.app

Live on Cloud Run, verified end to end in production:
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

## Next: seed Gmail and Drive, then search all three

**The decision, made 2026-08-17: seed everything.** A dedicated Google account
holds fictional Arkind mail and documents, alongside the existing GitHub repo,
so the demo shows the thing that actually distinguishes Glean — one question,
three sources, three versions of the answer.

The per-user connect flow stays built (it is the production shape and it works),
but the default is the seeded demo. `BADGER_DEMO_FALLBACK=1` restores the
fallback for visitors who connect nothing; it is currently off.

**Alan is creating the Google account.** Nothing below can start until it exists
and is connected through the Tools → Manage pane.

### The audit, done before wiring anything — 2026-08-17

Composio exposes `gmail` (63 tools) and `googledrive` (90). Read-only allowlist
to add, nine names:

| Gmail | Google Drive |
|---|---|
| `GMAIL_FETCH_EMAILS` | `GOOGLEDRIVE_FIND_FILE` |
| `GMAIL_FETCH_MESSAGE_BY_THREAD_ID` | `GOOGLEDRIVE_GET_FILE_METADATA` |
| `GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID` | `GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE` |
| | `GOOGLEDRIVE_LIST_COMMENTS` |
| | `GOOGLEDRIVE_LIST_REPLIES` |

`GOOGLEDRIVE_LIST_COMMENTS` matters more than it looks: **Google Docs comments
are the same pattern as GitHub issue comments** — the tidy document, and the
argument in the margin. The corpus thesis transfers to Drive intact.

**Fresh evidence for allow-by-name.** The audit filtered those 90 Drive tools
with a "does this name sound like a write?" regex — the deny-by-verb approach
`hooks/allowed-tools.txt` argues against — and it classified
**`GOOGLEDRIVE_EDIT_FILE` as read-only**, along with `HIDE_DRIVE`,
`WATCH_CHANGES` and `STOP_WATCH_CHANNEL`. Gmail is worse: `SEND_EMAIL`,
`TRASH_MESSAGE`, `DELETE_DRAFT` all sit in the same namespace. Put this in the
README; it is a better argument than the one already written there.

### Seeding is possible entirely through Composio

- **`GMAIL_INSERT_MESSAGE` / `GMAIL_IMPORT_MESSAGE`** put a message in the
  mailbox **without sending it**, so the inbox can hold mail from Tomas, Priya
  and Joris without owning those addresses. This is the unlock — sending from
  the demo account to itself would have looked fake.
- **`GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN`** creates Docs from markdown.
- **`GOOGLEDRIVE_CREATE_COMMENT` / `CREATE_REPLY`** put the arguments in the
  margins.

Seeding runs from a **separate write-capable session the agent can never
reach**, exactly as the GitHub corpus was created. None of these names goes
anywhere near `hooks/allowed-tools.txt`.

### Corpus design — no single source holds the whole answer

Extend Halden across all three:

- **Drive** — the client-facing retro: *"scope changed mid-engagement"*. The
  official version.
- **Gmail** — the thread with Joris explaining the delay, plus the internal
  thread arguing about how much to tell him.
- **GitHub** — issue #2, where the team concludes four of the six weeks were
  self-inflicted.

Then *"why did Halden slip?"* returns three sources telling three different
stories, and questions like *"did we ever actually tell Halden about the
reconciliation module?"* are answerable **only** by crossing Gmail and GitHub.
That is the demo that cannot be faked with one repo.

### Cross-source ranking — decide this before merging results

Each source has a different engine and their relevance scores are not
comparable: GitHub keyword-ANDs, Gmail has its own syntax, Drive is
`fullText contains`. Merging three ranked lists by their own scores is
guesswork.

**Re-score every row locally with our own term-coverage function**, ignoring
each engine's opinion. Cheap, works now, stays federated. The alternative is
the index, which is phase 2.

## Retrieval: what this is, and what it structurally cannot do

Search today is: strip stopwords → OR the terms → **one** API call → rank
locally by term coverage (title hits 3x body hits) → highlight locally. There
is **no IDF**, so "Halden" counts the same as "engagement".

There is no fuzzy matching, no stemming of our own, no semantic search — and
**not because they were skipped.** Fuzzy matching compares a query against the
corpus vocabulary, and semantic search compares embeddings of it. Both require
*holding the text*. Federation means we hold nothing, so both are unavailable
by construction. State it that way in the README: federation buys no crawler,
no stale data and permissions enforced at the source, and it costs every
retrieval technique that needs the text.

**Onyx settles the fuzzy question, in a comment in their own source**
(`backend/onyx/document_index/opensearch/search.py`, "Options considered and
rejected"): fuzziness AUTO is *"mostly for typos as the analyzer already does
some stemming and tokenization. In testing datasets, this makes recall slightly
worse."* They rejected it on measurements. There is no "did you mean" anywhere
in Onyx either. Typo tolerance comes from the **vector half of hybrid search** —
embedding models tokenise into subwords, so a typo lands near the right word.

And Google's "did you mean" is not a corpus technique: it is learned from query
logs at planetary scale. One demo user produces no such signal, so that route is
closed regardless.

**Consequence for phase 2:** one index in Postgres (`tsvector` + `pgvector` +
`pg_trgm`) buys semantic matching, real BM25 with IDF, comparable cross-source
ranking *and* typo tolerance in a single step. Four separate hacks on the
federated design would be redundant a week later, and by Onyx's measurements
the cheapest of them makes things worse.

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
- **Cloud Run, not a VM + Cloudflare Tunnel.** There is no domain, and a quick
  tunnel's URL changes on every restart. Cloud Run gives a free HTTPS URL,
  Vertex from the service identity so no key exists, and removes two components.
- **Not Vercel.** Tools are subprocesses and `query()` reads the agent off disk,
  but the deciding reason is that reaching Vertex from there needs a
  service-account private key pasted into a third-party dashboard.
- **Per-request identity travels in tool arguments, never the environment.**
  Declarative tools are spawned with a snapshot of `process.env`
  (`dist/tool-loader.js:82`), so an env var races between concurrent visitors.
  SDK-injected tools are no good either — `options.tools` is appended with **no
  collision check** (`sdk.js:170`, unlike plugin tools), so a second
  `github_search` would simply exist. What works is `options.hooks.preToolUse`,
  an in-process closure whose `{action:"modify", args}` replaces the tool's
  arguments (`sdk-hooks.js:25`).
- **No fuzzy matching bolted onto federated search.** See the retrieval section:
  it needs the text, and Onyx measured it making recall worse.
- **The gate is a passphrase, not auth.** Google SSO shows an unverified-app
  warning as the first thing an evaluator sees; magic links need their email;
  self-signup is auth code we would have to write. Revisit only with a database.
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

1. **Seed Gmail and Drive** on the demo Google account, and connect it.
2. **Tools + allowlist** for the nine read-only names above.
3. **Cross-source search** — merge and re-score locally.
4. **README** — it does not exist yet, and it carries research, design and the
   honest limits. It is the highest-value writing left.
5. Phase 2 if there is time: the Postgres index (`tsvector` + `pgvector` +
   `pg_trgm`), chat history, and per-user accounts on Supabase.

Do not pull later phases forward.

---

## Architecture — decided, do not redesign

- **Built on GAP.** The agent *is* a git repo: `agent.yaml`, `SOUL.md`,
  `RULES.md`, `skills/`. Identity and behaviour are version-controlled files.
- **Federated search, no indexing — for phase 1.** Live queries to Gmail,
  Google Drive and GitHub through Composio at ask-time. No crawler, no index,
  no copy of user data. This is the product thesis and the main departure from
  Glean. It is also what makes fuzzy and semantic search impossible; see the
  retrieval section. An index is phase 2 and the README must own the reversal
  rather than let a reviewer notice the contradiction.
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
  or ask the user to edit it. Never print its contents. **After any append,
  verify through the loader** (`loadEnvFile` then print the KEY NAMES only):
  the file has ended without a trailing newline before, which silently glued
  an appended line onto the last existing one — measured 2026-08-19 as an
  eval collapsing to 3/15 because BADGER_USER_ID never loaded and every tool
  call ran as a connectionless user.

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

**2026-08-18 (night) — a cleanup pass, and a defect found by measuring it.**
Alan's framing: "we are going all over the place, and need to make sure what
we're working on is maintainable." Reviewed every root file and all of `app/`,
justified each one, then cut 836 lines net in one commit (`9c2cd11`).

The removals were the easy half. The useful half was that three defects fell
out of reading the code carefully — Chat had never been updated when the corpus
went from one source to three, so mail and Drive citations were extracted,
verified, counted and then silently dropped before rendering; every source card
drew the GitHub mark as a literal string; and the "opened but not cited" count
knew only the three GitHub read tools. The first of those meant the badge could
say "6 citations, all retrieved" above a grid saying "This answer cites
nothing", which is the exact class of confidently-wrong indicator this file
already warns about twice.

Then the eval read 10/15 against a 13–14 baseline. Rather than explain it away
or accept it, the whole change was stashed and the eval re-run on untouched
`HEAD` — 11/15, different questions failing. Noise, confirmed by measurement
rather than by argument. That re-run is also what surfaced the skill-as-tool
defect now sitting at the top of this file: it reproduces on `HEAD`, so the
cleanup did not cause it, and it costs two eval questions every run.

**2026-08-17 — hosted, gated, and rebuilt around a sidebar.** Deployed to Cloud
Run: free HTTPS URL, no domain, Vertex from the service identity so no key
exists anywhere. Three bugs only a container finds — unguarded `.env` reads
that would have crashed on boot, a drifted lockfile `npm ci` refuses, and a base
image whose npm major rejects the lockfile.

Added the demo gate and attacked it rather than assuming: unauthenticated
requests to `/`, the APIs and a built asset all 401; four kinds of forged cookie
rejected; login brute force rate-limited. With no passphrase the server binds to
localhost only.

Rebuilt the UI on a shadcn sidebar — Search, Chat and Tools as separate
destinations, real brand marks, GitHub's own state icons, and a usage meter
reading the live answer budget. Two of my own regressions were caught in the
browser: the Dig button passed its MouseEvent as the query, and Sources were
built from opened threads rather than cited ones, so an answer with four
verified citations displayed "0 sources".

Then per-user connections: an opaque uid in the signed cookie becomes the
Composio end-user id, several GitHub accounts per visitor, switchable and
individually disconnectable, with an ownership check verified to refuse another
user's account id. `toolkits.authorize()` turned out to be deprecated for
managed OAuth — Composio's own error names `connectedAccounts.link` as the fix.

Audited Gmail and Drive before wiring anything, and the audit produced the best
argument yet for allow-by-name: a verb filter classified `GOOGLEDRIVE_EDIT_FILE`
as read-only. Read Onyx's source on typo tolerance and found they rejected
fuzziness on measurements. Direction set: seed all three sources.

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
