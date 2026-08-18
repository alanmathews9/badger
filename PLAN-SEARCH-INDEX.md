# Plan: the local search index

Agreed with Alan on 2026-08-18. Build in a fresh session, in the order below.

> **Status, 2026-08-18 night: steps 1–5 are built and verified; step 6's
> gates run next, and the deploy waits for Alan (deploys are rationed).**
> Current state lives in CLAUDE.md — this file stays as the plan of record.

The goal in one sentence: **searches with typos must still find the right
results, Google-style, for any user of the agent** — and the way there is a
small local index, because typo correction requires holding the vocabulary
the sources actually contain.

## What is being built

A local, file-based index of everything the connected sources hold, giving
the search path three things federation structurally cannot (see README
"Retrieval" — this plan is the reversal that section predicted):

1. **Typo tolerance** — a query term not in the corpus vocabulary is matched
   to the closest term that is ("paymnets" → "payments"), and the output says
   so ("showing results for *payments*"), never silently.
2. **Real ranking** — BM25 with IDF, so "Brightsmile" finally outweighs
   "app". Title hits keep their boost.
3. **Speed** — a search stops costing ~17 live API calls and ~4.8s.

Explicitly deferred: **embeddings/vector search.** Onyx's typo tolerance
comes from the vector half of its hybrid search, but vectors require an
embedding-model key from every user, which would break the property that the
agent's hands work with only a Composio key. Trigram matching covers typos
without any key. Design the store so vectors can be added as a column later
(a bolt-on, not a rebuild). The semantic gap ("holiday" → "leave policy")
stays owned by the agent's brain, which already rephrases.

## Onyx findings this plan is built on (read from their source, 2026-08-18)

- Their search UI path has **no LLM anywhere** (`context/search/pipeline.py`
  imports none). Ours stays model-free too.
- They **rejected fuzzy search on measurements** — comment in
  `document_index/opensearch/search.py`: fuzziness AUTO made recall worse.
  So: no edit-distance fuzziness bolted onto the query engine. Typo handling
  is vocabulary lookup + trigram similarity *before* the search, visible in
  the output.
- Their per-source scope routing is **configuration, not a model**, and their
  one LLM router (chat's `decide_search_scope`) **fails open** to searching
  everything and has its own regression eval. If Badger ever routes, copy
  both properties.
- They index into one store and search the copy; the copy is what makes
  cross-source scoring honest. Same move here, sized down: one JSON file, no
  database server, nothing installed.

## Design decisions (settled — do not relitigate without a reason)

- **Location of code:** the index module lives in `tools/scripts/_index.mjs`
  (agent side, like `_rank.mjs`), because both the agent's tools and the web
  search must reach it and the agent may not import from `app/`.
  `app/server/` re-exports. `npm run check:agent` must stay green.
- **Location of data:** `.gitagent/index/` — already gitignored runtime
  state. Purely local; delete the directory, the copy is gone. Say exactly
  that in the README.
- **Builder:** `scripts/index-build.mjs`, run as `npm run index` (and
  `npm run index status` to report age and counts). It crawls through the
  **same allowlisted read-only Composio slugs the tools already use** — no
  new permissions, works for any Composio key, so an external user gets the
  identical feature. Enumerate: GitHub issues+comments, PRs+review comments,
  files, commits; Gmail threads; Drive files+comments. Verify counts against
  the live sources after building, the way the corpus was verified — never
  against the builder's exit code.
- **Schema per document:** id, source, type, title, body, author, date, url,
  plus a reserved `vector` field (null for now). Doc-level, not chunked —
  the corpus documents are small; chunking is an embeddings-era concern.
- **Search:** BM25 over title+body with the existing title boost.
  `markTerms` continues to mark server-side.
- **Typo layer:** build the vocabulary from the index; a query term absent
  from it is replaced by the nearest vocabulary term by trigram similarity
  above a threshold; the replacement is stated in the tool output (data,
  not prose — the house pattern). No replacement, no silence: if nothing
  clears the threshold, say the term matched nothing as-typed.
- **Fallback, never a wall:** if the index is missing or stale, the search
  path falls back to today's live federated search and the output says which
  path answered and how old the index is. A fresh clone works before its
  first `npm run index`. On Cloud Run (ephemeral disk) the index builds
  lazily on first use; live fallback serves until it is ready.
- **The agent's own search tools keep their live path in this arc.** Wiring
  the agent onto the index is a follow-up decision once the index has proven
  itself on the search listing — revisit with eval evidence.
- **RULES.md needs no change:** the no-index rule governs `memory/`, which
  stays pointers-only. The index is a declared front-door feature. The
  README's "no crawler, no index, no copy" paragraph is rewritten to own the
  reversal: live search for freshness, a local refreshable cache for typo
  tolerance, ranking and speed.

## Order of work

1. **Crawler + store** (`npm run index`). Measure calls and minutes; print
   what was fetched; verify counts against the live sources.
2. **Index search module** with a deterministic test file (typo cases, IDF
   cases, title-boost cases — runnable without any key, `npm run test:index`).
3. **Typo layer**, with the "showing results for" note in output.
4. **Wire into `/api/search`** with the fallback rule; measure latency
   before/after on the same query set.
5. **Docs**: README reversal paragraph, AGENTS.md (index is optional,
   `npm run index` to enable), CLAUDE.md state update.
6. **Gates, then one batched deploy**: `npm run check:agent`, `npm run eval`
   (must stay ≥13/15), the new index tests, then the single deploy —
   deploys are rationed, batch everything.

## Risks worth knowing before starting

- **Crawl volume**: the corpus is ~300 artefacts; a full build is a few
  hundred read calls. Fine once; do not rebuild implicitly. Incremental
  refresh (updated-since) is a later nicety, not this arc.
- **Gmail/Drive body fetches** are the slow calls today and will be the slow
  part of the build too. The build is allowed to be slow; searches are not.
- **Two sources of truth**: index vs live will disagree between refreshes.
  The output must always say which answered and how old the index is —
  distrust any status display that has never been seen wrong.
