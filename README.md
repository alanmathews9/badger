# Badger

A workplace search agent — Glean's shape, built on [GAP](https://www.gitagent.sh/).

Ask a question in plain English. Badger searches your GitHub, your Gmail and
your Google Drive **at the moment you ask**, opens the threads that look
relevant, and answers with citations it then verifies against what it actually
retrieved.

**Live:** https://badger-1033557908241.us-central1.run.app — the passphrase is
sent with the submission, not committed here.

```
./scripts/badger.sh -p "Who knows about payments?"          # CLI
npm run ask "Why was the Android app five weeks late?"      # SDK, with verification
npm run serve                                               # web UI on :4000
npm run eval                                                # 15 questions with known answers
```

---

## The question this was built to answer

Every company has a version of this problem: the answer exists, but not where
you would look, and no single system holds all of it.

Arkind sells appointment booking to small clinics — dentists, physios and vets,
so patients can book online, get a reminder and leave a deposit. Forty people,
Bengaluru and Lisbon. The worked example is an Android release that shipped five
weeks late. Ask **"why was the app five weeks late?"** and three sources answer
differently:

| Source | What it says |
|---|---|
| **Drive** — the customer-facing release notes | "Delayed by App Store review." |
| **GitHub** — issue #8 | Review took 4 of the 35 days. The rest was a sync layer written twice — and PR #30 sits closed and unmerged as proof of the first attempt. |
| **Gmail** — the April thread | The team chose that wording deliberately, over an objection, and agreed to keep the real arithmetic in an internal issue. |

None of those is a lie. The Drive document is the one that gets forwarded, and
it is the one that teaches the wrong lesson.

Then ask **"did we tell Brightsmile the app would be ready in March?"** — which
mail answers and nothing else records. Tomas wrote "early March" to the customer
on 4 February, sixteen days before telling his own VP the date would not hold.
No document knows this happened. That is the thing a single-source tool cannot
do, and it is why the demo has three sources rather than one with more content
in it.

**Why a clinic booking company and not a consultancy.** The first corpus was a
consultancy, and it had to be thrown away. Consultancy work is abstract — scope,
weeks, billing — so every answer needed a glossary and a reader could not tell a
good answer from a bad one. "Why did the engagement slip?" was answered with
compressed discovery and unpriced change requests, and nobody can judge that. A
reminder text arriving at 3am is wrong in a way anyone can judge in one second.
Legibility was the point; sharper retrieval was a side effect of documents that
no longer all describe the same abstraction.

---

## How it works

Two passes, which is the split [Glean](https://www.glean.com/) and
[Onyx](https://github.com/onyx-dot-app/onyx) both use — read from Onyx's source
rather than its docs.

**Pass one — retrieval, no model.** `POST /api/search` answers from a small
local index when one exists — single-digit milliseconds, zero API calls, typo
correction — and falls back to querying all three sources live when it does
not. No LLM is on this path either way, so results appear while the answer is
still being written. Measured on the same query, same minute: 3ms from the
index against 5.4 seconds and 10 API calls live.

**Pass two — the agent.** `GET /api/ask` streams the agent over SSE, forwarding
each tool call as it happens. Watching it search *is* the demo: you can see
which sources it went to and what it opened.

### Ranking across sources that do not agree on what a score means

GitHub keyword-ANDs and returns its own relevance order. Gmail has its own
syntax and its own opinion. Drive returns a filtered list with **no score at
all**. Those three numbers are not comparable, and merging three ranked lists
by their own scores is guesswork wearing a sort's clothing.

So every row from every source is re-scored locally on term coverage, title
hits weighted above body hits, and each engine's opinion is discarded at the
door (`tools/scripts/_rank.mjs`, which `app/server/rank.mjs` re-exports).

**Ranking alone is not enough, and finding that out cost an answer.** Asked
whether a customer had been told the app would ship in March — a question one
mail thread exists to answer — Badger searched, got ten results, opened none and
said it could not find it. Two faults sat behind that. The scoring function was
only ever called by the web search, because it lived under `app/` and the agent
is forbidden from importing from `app/`; a shared function on the wrong side of
a boundary is a private one. And re-sorting the ten rows an engine returned
cannot surface the row it ranked eleventh — for an OR'd query Gmail's order is
effectively newest-first, so a February promise lost to July account noise. All
three tools now **over-fetch, rank, then cut**. The correct thread went from
absent from the top ten to rank 1.

Drive's ranking is deliberately weaker, and the code says so: Drive returns no
body text, so a file can only be scored on its name. `fullText contains` is what
got it into the list, so every row matched *somewhere* — what can be ordered on
is whether the match is in the title.

There is no IDF, so "Brightsmile" counts the same as "app". That is the main
thing wrong with this ranking, and the index below is what fixes it.

### Query planning, shared by all three

A search box shaped like Google's invites sentences, and all three engines AND
their terms — so the more the user types, the less they find:

```
"why did the android release slip"                        →   0 hits
"why did the android release slip in:title,body,comments" →   0 hits
"android OR release OR slip"                              →   6 hits
```

Measured against the demo repository, and reproducible. The `in:` qualifier is
in there because it is the fix GitHub's own tooling suggests and it does not
help: the failure is AND semantics, not search mode.

Queries are stripped to keywords and OR'd. The planner is shared between the
agent's tools and the web search, because they drifted apart once and the drift
was a bug: the UI found twenty hits while the agent, asked the same question,
reported it had found nothing.

Each engine then gets its own builder, because their syntaxes have nothing in
common — Gmail needs its OR group parenthesised or a `from:` qualifier silently
stops applying to half the query, and Drive has no bare keywords at all, only
`fullText contains '…'` clauses.

---

## Built on GAP: the agent *is* the repository

```
agent.yaml  SOUL.md  RULES.md  skills/  tools/  hooks/  memory/
                                              ← the agent. This IS the repo.
app/server/  app/web/                         ← the product. A consumer.
```

Identity and behaviour are version-controlled files, not configuration in
somebody's database. `SOUL.md` is who Badger is; `RULES.md` is what it must and
must not do; `skills/` are procedures for specific jobs; `tools/*.yaml` are its
capabilities.

**The dependency is strictly one-way.** `app/` reaches up into `tools/`, and
nothing under the agent references `app/`. Badger remains a git repository you
can clone and run with the GAP CLI alone.

That is tested rather than asserted — `npm run check:agent` greps for a
downward reference, then copies *only* the agent files to a temporary directory
and runs a tool there. If the boundary rots, the check fails.

### Skills decompose by task, never by source

Five skills: `trace-decision`, `find-expert`, `onboard-to-project`,
`triage-pr-feedback`, `activity-digest`. Named for the user's job, following
the idiom in the framework authors' own published agents (see
`RESEARCH-GAP-IDIOM.md`).

Adding Gmail did not add a skill. It added tools, and changed what
`trace-decision` has to do — its thesis used to be "files hold the official
answer, threads hold the real one", and with three sources that became a
procedure for crossing them.

### The rest of the framework surface — used or declined, never silent

Badger uses more of GAP than the tree above shows. `memory/` is live:
`MEMORY.md` holds vocabulary and where answers to recurring questions turned
out to live — pointers, never content, so memory cannot become an index by the
back door. Two of its entries came from measured eval misses, which is the
learning loop doing real work. On the SDK paths the file is injected into the
prompt as data, because a prose "load memory first" rule was watched being
skipped on its first live run. `examples/` carries one calibration example on
a deliberately fictional subject, teaching the answer shape the eval caught
Badger missing: a policy answer is incomplete until the exceptions granted sit
next to the rule. And the compliance block's `audit_logging: true` is honoured
on every path — the runtime writes `.gitagent/audit.jsonl` only from its CLI
entry point, so `app/server/audit.mjs` keeps the same log in the same format
on the SDK paths, and in production each entry also goes to stdout, where
Cloud Logging's default 30-day retention is what makes the declared
`retention_days: 30` true.

The rest of the surface is declined, each for a reason rather than by
omission:

- **`workflows/`** — deterministic multi-step orchestration. Badger's
  procedures branch on what retrieval returns: which thread to open is a
  judgment call, so they are skills the model steers, not step sequences.
- **`agents/` (sub-agents)** — delegation adds a model round-trip to a path
  that already spends ~5s on API fan-out, and with Flash as the ceiling there
  is no cheaper tier to delegate down to.
- **`plugins/`** — the packaging story for reuse across agents. One agent, no
  second consumer; the Composio wiring would gain a manifest and lose nothing
  it has today.
- **`knowledge/`** — a static knowledge base of a live corpus would drift by
  design. What it would hold lives in `memory/`, where the agent can append
  to it and git records when it did.
- **`config/`, `extends:`** — one environment, no parent agent to inherit
  from.

---

## Read-only, and the honest limit

Badger never sends, writes, edits, deletes or shares. That holds at four
independent layers:

1. Composio's `DIRECT_TOOLS` preset, which drops the generic meta-tools. Without
   it a session registers `COMPOSIO_MULTI_EXECUTE_TOOL` — one name that can
   invoke anything, which defeats name-based gating entirely.
2. A per-tool enable list: **8** of GitHub's 823 actions, **3** of Gmail's 63,
   **5** of Drive's 90.
3. The tool scripts can only call those names.
4. `hooks/allow-read-only.sh` gates by exact tool name, and both SDK callers
   pass the same list as `allowedTools` — which removes everything else from the
   model's schema and cannot fail open.

### Allow-by-name, not deny-by-verb

The allowlist names every permitted tool one at a time. That looks like
pedantry until you try the alternative. An audit filtered Drive's 90 tools with
a "does this name sound like a write?" regex and classified
**`GOOGLEDRIVE_EDIT_FILE` as read-only** — along with `HIDE_DRIVE`,
`WATCH_CHANGES` and `STOP_WATCH_CHANNEL`. Gmail keeps `SEND_EMAIL`,
`TRASH_MESSAGE` and `DELETE_DRAFT` in the same namespace as `FETCH_EMAILS`. And
GitHub's `LIST_REPOSITORY_SECRETS` is a read-shaped tool that reads
credentials.

### The credential underneath is not read-only, and cannot be

**All four layers are software.** The tokens beneath them are not scoped
read-only, because no provider here offers that:

- **GitHub** has no read-only OAuth scope for private repositories. `repo` is
  the narrowest scope that can read one, and it grants write.
- **Google**, through Composio's managed auth, grants `https://mail.google.com/`
  for Gmail — full mailbox — and `.../drive` for Drive. Read back from the live
  auth configs, not from the docs, which do not state scopes at all.

This is why enforcement lives in the tool layer, and why there are four of
them. A **GitHub App** with `contents:read`, `issues:read`, `pull_requests:read`
on one repository would be genuinely read-only at the credential — but
Composio's GitHub toolkit does not offer that scheme, and going around Composio
reopens the multi-user problem that chose it in the first place.

### Read-only is phase 1 of three, not a missing feature

Glean is not a read-only product: [Glean Actions][ga] ships 85+ enterprise
actions. A "Glean equivalent" that silently omits writes reads as an omission,
so the boundary is stated as a choice.

1. **Read-only (this).** Federated live query, retrieve, synthesise, cite.
   Glean built Actions on top of a working retrieval engine; same order here.
2. **Propose, don't execute.** Draft the reply or the ticket and hand it over
   unsent. Nothing mutates, so it stays inside the guarantee.
3. **Actions.** Real writes, per-source, each a deliberate allowlist addition
   with its own credential scope.

[ga]: https://docs.glean.com/agents/actions/introduction-to-actions

---

## Retrieval: live search, plus a local index — and why the design reversed

Badger began fully federated: strip stopwords → OR the terms → one API call
per source → re-score locally. **No index, no crawler, no copy of your data.**
This section used to explain why that made fuzzy matching and real ranking
unavailable *by construction* — both need the text, and federation holds
nothing. That analysis was correct, and it is exactly why the design now
holds a little text: search runs on a **local, refreshable index**, with the
live federated path kept as the fallback.

**What the index is.** `npm run index` crawls everything the connected
sources hold — through the *same* allowlisted read-only Composio operations
the agent's tools use, so it needs no new permissions and works for any
Composio key — into one JSON file under `.gitagent/index/`. ~178 documents,
~200KB, 173 read calls, under a minute on the demo corpus. It is a cache,
not a database: delete the directory and the copy is gone. Counts are
verified against what the live APIs report during the crawl; a mismatch
fails the build rather than leaving a quietly partial index. `npm run index
status` reports age and contents.

**What holding the text buys, measured:**

- **Typo tolerance, visibly.** A query term absent from the corpus
  vocabulary is replaced by the nearest vocabulary term by trigram
  similarity, and the UI says so — "Showing results for *payments* (you
  typed 'paymnets')". Never silently: a term nothing is close to is reported
  as matching nothing. This follows Onyx's measurement rather than fighting
  it — they found query-engine fuzziness (fuzziness AUTO) made recall
  *worse* and rejected it; correction against the real vocabulary, before
  the search, is a different mechanism.
- **Real ranking.** BM25 with actual IDF, so "Brightsmile" finally outweighs
  "app". The candidate-pool weighting in `_rank.mjs` was the honest
  approximation available without the text; the index retires the need for
  it on this path.
- **Speed.** 3ms instead of ~5s, because the ~17 third-party calls per
  search became zero.
- **Files and commits in results.** GitHub code search does not serve
  private repositories at all, so the live path could never return a file.
  The index enumerates them by path, so now it can.

**When it builds.** Onyx starts a crawl within seconds of a connector being
added (its beat scheduler picks up the trigger); Badger does the sized-down
equivalent: `npm run connect status` — the step that confirms OAuth
completed — builds the index the moment a searchable source is connected,
and rebuilds it when a source is connected after the last build. The server
also builds lazily at boot when the disk holds no index (which is how Cloud
Run's ephemeral disk gets its copy), and `npm run index` is the manual
override.

**The fallback is a fallback, never a wall.** A fresh clone works before its
first build: a missing or stale (>24h) index routes the search to the live
federated path unchanged while a background build runs. Every response says which path answered and how old the copy
is, because index and live *will* disagree between refreshes, and a status
display that cannot be seen wrong is a lie waiting to be found.

**What stays federated.** The agent's own search tools still query the
sources live — freshness at ask-time, permissions enforced at the source —
and the index inherits the read-only story wholesale: it is built by the
same eight-name allowlist everything else goes through.

**What is still deferred: embeddings.** Onyx's typo tolerance comes from the
vector half of its hybrid search, but vectors require an embedding-model key
from every user, which would break the property that Badger's hands work
with only a Composio key. Trigram matching covers typos without one. Every
indexed document carries a reserved `vector` field (null today) so
embeddings can arrive as a column, not a rebuild. The semantic gap
("holiday" → "leave policy") stays owned by the agent, which already
rephrases.

The federated decision is reversed, and the reversal is owned here rather
than left for a reviewer to notice: the earlier analysis priced the trade
correctly, and the index is the payment.

---

## Citations, and verifying them

Every answer ends with sources. That used to be a line in `RULES.md` asking the
model nicely, and it was broken in testing: one run emitted a GitHub URL with
the `.com` dropped while copying — a real-looking link to nothing. A wrong
answer carrying a plausible link is worse than no answer, because it gets
forwarded.

So `app/server/verify-citations.mjs` checks every citation against the text the
tools actually returned. Anything that was never retrieved is marked
`[UNVERIFIED]` inline, and the check exits non-zero so it can gate a demo.

It covers all three sources. GitHub citations carry an id that can be matched
literally; mail and documents are cited by subject and by name, so the Sources
block is parsed. It also catches the more dangerous invention — a **real thread
attributed to someone who never wrote in it** is flagged as misattributed,
rather than passing because the subject was genuine.

**What it does not do**, stated plainly: it proves a cited thing *was
retrieved*. It does not prove the answer characterises it correctly. Quoting
real issue #18 while misrepresenting what Priya said in it would pass. That is
a different check and it is not built.

---

## Measuring whether the answers are right

Citation verification proves Badger retrieved what it cites. It says nothing
about whether the answer is *correct*, and for a long time nothing did — every
accuracy judgement was "ask a question, read the answer", which is exactly as
reliable as it sounds.

`evals/questions.mjs` is fifteen questions whose correct answer is known, and
known from where. `npm run eval` runs them and exits non-zero on any failure, so
it can gate a deploy the way the citation check already gates a demo. A run
costs about five cents — the property that matters, because an eval set too
expensive to re-run becomes a document rather than a test.

**Grading is deterministic, not model-judged.** The obvious design is to ask a
model whether the answer is right; it is also the one that cannot be trusted
here, because the grader would be the same Flash model being graded, on the same
corpus, and a grader that hallucinates agreement is indistinguishable from a
system that works. So each question carries `mustCite` (what had to be
retrieved — checked against tool output, not against the answer), `mustSay`
(facts, written as alternations so "five weeks" and "35 days" both pass), and
`mustNotSay` — the known wrong answer, which is the half that catches an answer
citing issue #8 while still blaming App Store review.

Separating "did it find the material" from "did it describe it well" is the
distinction the set is built on. An agent that found the right thing and wrote
it up badly has a writing problem; one that never found it has a retrieval
problem. Conflating them is how you spend a day tuning a prompt to fix a search
bug.

**It found four defects on its first run**, none of which was visible from
asking questions by hand — including that Gemini invents a `task_tracker` tool,
gets "not found" from the runtime, and then announces what it is about to search
and stops; and that the citation verifier was producing *false* unverified
findings on correctly-cited documents, because it only understood canonical
`[text](url)` and the model also writes `[text] (url)`. A verifier that cries
wolf on correct answers is worse than no verifier: it teaches the reader to
ignore the badge.

Current baseline is 14/15. The model is non-deterministic, so which question
fails varies between runs — a single run is a sample, not a score, and the set
says so rather than implying a precision it does not have.

---

## Guardrails go in tool output, not prompts

The house lesson from this project, learned four times. Behaviours that prose
in `RULES.md` failed to produce were obtained by encoding them in the data the
model reads:

- Issue results carry an explicit open/closed banner, because a proposal was
  being reported as a decision.
- Date windows are computed by the tool. Asked "what shipped last week", the
  model wrote a date two years wrong — the search then succeeds against the
  wrong period, which is a silent correctness bug rather than a visible failure.
- The citation check is a program, not an instruction.
- Every search result ends with a footer naming what the *other* sources hold.
  Asked whether a client had been told something, Badger searched mail, found a
  defensible answer, and stopped — never opening the kickoff notes the mail
  itself referred to.

---

## The corpus, and why it is shaped this way

A private GitHub repository, a seeded Gmail mailbox and a seeded Drive, all for
one company that does not exist:

| Source | Contents |
|---|---|
| **GitHub** | 27 files, 22 issues with 91 comments, 8 pull requests, 13 review comments, 34 commits spread over 16 days. Files hold the official answer; issues hold the real one. |
| **Drive** | 23 documents and 6 spreadsheets across 10 folders — onboarding, team pages, HR policy, the access register, roadmaps, customer-facing reviews. Comments carry the disagreement. |
| **Gmail** | 15 threads, 52 messages, January to July 2026, with real dates. Five are customer support threads, because that is the most common shape of mail in a real company and it puts a customer's words next to the engineering issue that shares no vocabulary with them. |

Three seams are deliberate, and all three exist in every real company. The
release notes contradict issue #8. The Drive churn review says Clearview left
over price, and Clearview's own notice says explicitly that it was not price.
And the Drive leave policy gives a carry-over of 10 days expiring in March where
the repository handbook still says 5 with no deadline — both reachable, neither
pointing at the other. A search tool that returns one and not the other is lying
by omission.

**The corpus is source code, not a thing someone clicked into existence.**
`scripts/seed/company.mjs` holds the cast, the customers and `FACTS` — every
date and number the three sources are built to disagree about. Every corpus
module imports from it and restates nothing, which is what keeps the authored
contradictions authored rather than accidental. `npm run seed:github` rebuilds
the repository from scratch in about five minutes; `scripts/seed-google.mjs`
does Drive and Gmail. A corpus that is the ground truth for an eval set has to
be reproducible, reviewable as a diff, and correctable without a browser.

Two things the seeders had to work around, both measured rather than assumed.
GitHub will not let `created_at` be backdated on an issue or a pull request at
all, so every date that matters lives in body text and the README says so rather
than hiding it — only **commits** can be backdated, via the Git Data API, which
is why history spans sixteen real days. And addresses are on RFC 2606 reserved
domains (`@arkind.example`, `@brightsmile.example`): `brightsmile.com` is a real
registered domain, checked, and the first corpus would have shown a real company
being misled about a delivery date.

Seeding runs from write-capable scripts whose tools appear nowhere in the
agent's allowlist. `GMAIL_IMPORT_MESSAGE` places mail in a mailbox **without
sending it**, which is what allows an inbox to hold mail from people whose
addresses we do not own. Nothing is ever sent.

---

## Hosting

Google Cloud Run. A free HTTPS URL with no domain to buy, Vertex credentials
from the service identity so **no API key exists anywhere**, and a free tier a
demo will not approach.

```bash
gcloud run deploy badger --source . --region us-central1 \
  --service-account badger-run@$PROJECT.iam.gserviceaccount.com \
  --allow-unauthenticated --max-instances 1 --concurrency 20
```

`--max-instances 1` does double duty: it caps cost absolutely, and it makes the
in-memory rate limits *correct* — they are per instance, so a second instance
would silently double every limit.

Three secrets live in Secret Manager, never as plain environment variables. The
service runs as a dedicated account holding exactly two roles rather than the
default compute account, which carries far more.

**The gate is a passphrase, not authentication.** One shared secret, server-side,
so an unauthenticated visitor gets a splash page and nothing else — no bundle,
no API, no assets. Signed cookie, constant-time compare, CSP and HSTS, generic
500s. With no passphrase configured the server binds to localhost only, and
there is no default. It was attacked rather than assumed: four kinds of forged
cookie rejected, login brute force rate-limited.

Cost is capped in the app as well as the platform: rate limits per IP, a daily
answer ceiling and a concurrency cap. When the budget runs out, **search still
works** and the card says so.

Answers cost about **$0.004** each, measured through the SDK's own `costs()`.

---

## Running it yourself

Needs Node 24+, a Google Cloud project with Vertex AI enabled, and a Composio
API key.

```bash
npm install
cp env.template .env          # then fill it in
gcloud auth application-default login

npm run connect                   # OAuth links to connect GitHub, Gmail, Drive
npm run composio:status           # what the agent can reach, and what it cannot

npm run check:agent               # the agent still stands alone
npm run eval                      # fifteen questions with known answers
npm run ask "why was the app five weeks late?"
npm run serve                     # web UI on :4000
```

`npm run connect` prints a Connect Link per toolkit — including for a brand-new
Composio key with nothing connected: authorise each service in the browser and
Badger searches *that* account's data. Composio holds the credential; Badger
never receives a token. If a tool is called while a source is unconnected, its
error says to run this command — the onboarding is in the tool output, where
the agent can relay it, not in a document nobody reads.

### Running it with a different brain

The repository is the agent; the model is supplied by whoever runs it. Two
ways to run Badger without the setup above:

**The gitagent CLI, standalone** — the framework-native route, same as any
agent on the registry:

```bash
git clone https://github.com/alanmathews9/badger
cd badger && npm install
cp env.template .env              # the Composio key; model credentials
npx @open-gitagent/gitagent --dir . -p "why was the app five weeks late?"
```

**Claude Code (or any assistant harness) as the brain** — no model API key at
all. `AGENTS.md` is GAP's framework-agnostic entry point: it tells a foreign
harness how to be Badger, including how to call each tool script directly.
Open your assistant in the cloned folder and say "read AGENTS.md and act
accordingly". Tested with Claude Code: same agent files, same corpus, same
cited answers, different vendor's model.

Both routes still need the `.env` — the model is swappable, the door to the
data is not. Read-only survives the swap either way, because the tool scripts
can only call the read-only operations whatever the brain asks for.

---

## Repository map

```
agent.yaml              identity, model, runtime config
SOUL.md  RULES.md       who Badger is, and what it must never do
skills/                 five procedures, decomposed by task
tools/*.yaml            ten tools; scripts in tools/scripts/
hooks/allowed-tools.txt the allowlist, and the single source of truth for it
app/server/             the two passes, the gate, ranking, verification
app/web/                Vite + React + Tailwind + shadcn
scripts/                dev tooling, corpus seeding, the eval runner
evals/                  fifteen questions with known answers and known sources
```

**Where the research lives.** `RESEARCH-GAP-IDIOM.md` is how the framework's
authors actually write agents, from 17 of their published repos plus the formal
spec. `NOTES.md` records what the *installed runtime* does, which has differed
from the published documentation every single time it mattered. `CLAUDE.md` is
the working state and the decision log.

---

## Known limits

Stated here rather than left to be discovered:

- **No semantic search.** The index buys typo tolerance and real BM25, but
  embeddings are deferred (see above) — "holiday" does not find "leave
  policy" on the search path; the agent covers that gap by rephrasing.
- **The credentials are not read-only.** Four software layers enforce it; the
  tokens beneath them could write.
- **Chat history is not persisted.** There is no database; "recent digs" is
  `localStorage`.
- **Citation verification proves retrieval, not accuracy.** The eval set is
  what covers accuracy, and it covers fifteen questions rather than every
  question.
- **Answers are not deterministic.** The same question can produce a materially
  different answer between runs, which is why the eval baseline is quoted as a
  sample rather than a score.
- **Typo correction needs the index.** `ofboarding` finds the Offboarding
  Checklist on the index path and says it corrected; on the live fallback
  there is no vocabulary to correct against, so it returns nothing. Chat is
  covered either way — the model fixes spelling before it searches.
- **GitHub code search does not work on private repositories** — for any token
  class, measured. Retrieval into private repos goes through issue search, file
  reads on known paths, and commit history. This shaped the corpus: searchable
  knowledge has to live substantially in issues and threads.
- **Gemini 2.5 Flash, not Pro.** Pro is gated behind preview enrolment on this
  project and 400s on a parameter the runtime sends and cannot override.
- **One shared passphrase**, not accounts. Revisit with a database.
