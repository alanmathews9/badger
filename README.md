# Badger

A workplace search agent — Glean's shape, built on [GAP](https://www.gitagent.sh/).

Ask a question in plain English. Badger searches your GitHub, your Gmail and
your Google Drive **at the moment you ask**, opens the threads that look
relevant, and answers with citations it then verifies against what it actually
retrieved.

**Live:** https://badger-1033557908241.us-central1.run.app — the passphrase is
sent with the submission, not committed here.

```
./scripts/badger.sh -p "Who knows about payments integrations?"   # CLI
npm run ask "Why did the Halden engagement slip?"                 # SDK, with verification
npm run serve                                                     # web UI on :4000
```

---

## The question this was built to answer

Every company has a version of this problem: the answer exists, but not where
you would look, and no single system holds all of it.

The demo corpus is a fictional consultancy, Arkind, and the worked example is
an engagement that ran six weeks late. Ask **"why did Halden slip?"** and three
sources answer differently:

| Source | What it says |
|---|---|
| **Drive** — the client-facing retro | "Scope changed mid-engagement." |
| **GitHub** — the internal retro issue | Roughly four of the six weeks were self-inflicted: discovery was compressed, and a change was absorbed without pricing it. |
| **Gmail** — the February thread | The client raised that change at kickoff. Nobody chased it. He was later told it was a scope change. |

None of those is a lie. The Drive document is the one that gets forwarded, and
it is the one that teaches the wrong lesson.

Then ask **"did we ever actually tell Halden about the reconciliation
module?"** — which is answerable only by crossing mail with the repository.
Neither source has it alone. That is the thing a single-source tool cannot do,
and it is why the demo has three sources rather than one with more content in
it.

---

## How it works

Two passes, which is the split [Glean](https://www.glean.com/) and
[Onyx](https://github.com/onyx-dot-app/onyx) both use — read from Onyx's source
rather than its docs.

**Pass one — retrieval, no model.** `POST /api/search` queries all three
sources concurrently and returns a merged list. No LLM is on this path at all,
so results appear while the answer is still being written. Measured: 32 rows in
4.4 seconds across 17 API calls.

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
door (`app/server/rank.mjs`).

There is no IDF, so "Halden" counts the same as "engagement". That is the main
thing wrong with this ranking, and the index below is what fixes it.

### Query planning, shared by all three

A search box shaped like Google's invites sentences, and all three engines AND
their terms — so the more the user types, the less they find:

```
"Halden engagement slip"                          →  0 hits
"Halden engagement slip in:title,body,comments"   →  0 hits
"halden OR engagement OR slip"                    →  20 hits
```

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

## Retrieval: what this is, and what it structurally cannot do

Search is: strip stopwords → OR the terms → one API call per source → re-score
locally → highlight locally. **No index, no crawler, no copy of your data.**

That is the main departure from Glean, and it is a real trade rather than a
shortcut:

**What federation buys.** No crawler to run, no index to go stale, and
permissions enforced at the source — Badger sees exactly what the connected
account sees, and never more. Nothing is copied anywhere.

**What it costs.** Fuzzy matching compares a query against the corpus
vocabulary. Semantic search compares embeddings of it. Both require *holding
the text*. Federation means we hold nothing, so both are unavailable **by
construction** — not skipped, not deferred, unavailable.

Onyx settles the fuzzy-matching question in a comment in their own source
(`backend/onyx/document_index/opensearch/search.py`, under "Options
considered and rejected"):
they tried fuzziness AUTO and found it made recall slightly worse, because the
analyzer already stems and tokenises. There is no "did you mean" anywhere in
Onyx either — typo tolerance comes from the *vector half* of hybrid search,
where a misspelling lands near the right word in embedding space. And Google's
"did you mean" is learned from query logs at planetary scale, which one demo
user cannot produce.

**So phase 2 is one index, not four hacks.** Postgres with `tsvector` +
`pgvector` + `pg_trgm` buys semantic matching, real BM25 with IDF, comparable
cross-source ranking *and* typo tolerance in a single step. Bolting any of them
onto the federated design would be redundant a week later, and by Onyx's
measurements the cheapest one makes things worse.

That reverses the federated decision, and the reversal is owned here rather
than left for a reviewer to notice.

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
one fictional consultancy:

| Source | Contents |
|---|---|
| **GitHub** | 18 files, 20 issues, 5 PRs. Files hold the official answer; issues hold the real one. |
| **Drive** | 21 documents and 5 spreadsheets across 9 folders — onboarding, team pages, HR policy, the access register, roadmaps, client-facing retros. Comments carry the disagreement. |
| **Gmail** | 8 threads, 30 messages, January to July 2026, with real dates. |

Two seams are deliberate, and both exist in every real company. The Halden
retro contradicts its own internal version. And the Drive leave policy gives a
carry-over of 10 days expiring in March where the repository handbook still
says 5 with no deadline — both reachable, neither pointing at the other. A
search tool that returns one and not the other is lying by omission.

Seeding runs from `scripts/seed-google.mjs`, whose write tools appear nowhere
in the agent's allowlist. `GMAIL_IMPORT_MESSAGE` places mail in a mailbox
**without sending it**, which is what allows an inbox to hold mail from people
whose addresses we do not own.

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

node scripts/google-connect.mjs   # connect Gmail, Drive and Docs
npm run composio:status           # what the agent can reach, and what it cannot

npm run check:agent               # the agent still stands alone
npm run ask "why did Halden slip?"
npm run serve                     # web UI on :4000
```

`scripts/google-connect.mjs` prints a Connect Link per toolkit. Composio holds the
credential; Badger never receives a token.

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
scripts/                dev tooling, corpus seeding, probes
```

**Where the research lives.** `RESEARCH-GAP-IDIOM.md` is how the framework's
authors actually write agents, from 17 of their published repos plus the formal
spec. `NOTES.md` records what the *installed runtime* does, which has differed
from the published documentation every single time it mattered. `CLAUDE.md` is
the working state and the decision log.

---

## Known limits

Stated here rather than left to be discovered:

- **No index**, so no semantic search, no fuzzy matching, no IDF. See above —
  this is structural, and phase 2 is the fix.
- **The credentials are not read-only.** Four software layers enforce it; the
  tokens beneath them could write.
- **Chat history is not persisted.** There is no database; "recent digs" is
  `localStorage`.
- **Citation verification proves retrieval, not accuracy.**
- **GitHub code search does not work on private repositories** — for any token
  class, measured. Retrieval into private repos goes through issue search, file
  reads on known paths, and commit history. This shaped the corpus: searchable
  knowledge has to live substantially in issues and threads.
- **Gemini 2.5 Flash, not Pro.** Pro is gated behind preview enrolment on this
  project and 400s on a parameter the runtime sends and cannot override.
- **One shared passphrase**, not accounts. Revisit with a database.
