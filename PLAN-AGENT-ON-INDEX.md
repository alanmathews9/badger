# Plan: chat on the index, and keeping the index fresh

Agreed with Alan on 2026-08-19, in the session that shipped
PLAN-SEARCH-INDEX.md steps 1–6 (deploy still pending, batched). This is the
next arc. Decisions first, order of work after.

## Decisions (settled with Alan — do not relitigate without a reason)

- **Chat retrieves from the index, and falls back to the live tools when the
  index comes up empty.** This is deliberately *more* than Onyx/Glean do:
  verified from Onyx's source and Glean's docs, both are index-only for
  connected sources — a document not yet indexed is simply not found. Badger
  keeps the live tools as the agent's second look. Retrieval order: index
  first (fast, BM25, typo-corrected); if the index misses or is absent, the
  existing live search tools, unchanged.
- **Incremental refresh on a timer, default every 2 hours, configurable by
  env var** (ship at 2h; an operator can set 1h). Incremental means
  "changed since last build" — GitHub `since` on commits/issues, Drive
  `modifiedTime >`, Gmail `after:` — a ~10–20 call tick, not a 173-call
  rebuild. The daily full rebuild stays as the sweep that catches deletions
  (Glean's own layering: webhooks + incremental + full crawls; we run the
  bottom two layers).
- **No OpenSearch.** It would add a server (~$25+/mo hosted, no free tier
  worth the name) to run the same BM25 we already compute in 3ms over a
  200KB corpus. Revisit only when a corpus outgrows the JSON file (~tens of
  thousands of docs); `_index.mjs` is the single module that would swap.
- **Webhooks deferred.** Free in dollars, real in engineering (public
  endpoint + signature checks for GitHub; Pub/Sub + expiring channels for
  Google). If ever taken, check Composio Triggers first — it does this
  plumbing for our exact three sources; free-tier coverage unverified.
- **The eval is the gate.** Rewiring the agent's retrieval is exactly the
  change PLAN-SEARCH-INDEX.md said must "revisit with eval evidence":
  `npm run eval` must hold ≥13/15 with the agent on the index, compared
  against a same-day baseline re-run, never last week's number.

## Order of work

1. **Incremental refresh** in the builder (`npm run index refresh`):
   updated-since crawl per source, merged into the store, counts verified
   against what each API reports, `builtAt` split into `builtAt` /
   `refreshedAt`. Then the in-server timer (default 2h,
   `BADGER_INDEX_REFRESH_HOURS`), running only while an instance is alive —
   Cloud Run's cold start already rebuilds from nothing.
2. **Index-backed agent tools.** The three search tools try the index first
   and say so in their output (path + age, the same honesty rule as the web
   UI); on a miss or no index they run their live path unchanged. Open
   tools (issue/thread/file) can serve from the index bodies the same way.
3. **Eval evidence.** Re-run baseline on HEAD same day, then with the
   change; ship only if ≥13/15 holds. Watch specifically for freshness
   questions ("what shipped this week") — the index carries dates, but the
   agent must not conclude "nothing" from an index gap without the live
   second look.
4. **Docs**: README freshness section (the Glean/Onyx comparison, what we
   run and what we deferred), CLAUDE.md state.
5. **Gates and the batched deploy** — deploys stay rationed; nothing
   deploys without Alan.

## Risks

- An index-backed agent can answer stale by construction. The fallback rule
  and the tool output's age label are the mitigations; the eval's freshness
  questions are the check.
- The refresh timer and the boot lazy build must not race: one build at a
  time, the existing single-build guard covers both.
- Deletions: incremental refresh cannot see them (no "deleted-since" API on
  any of the three); only the daily full rebuild removes rows. Say so in
  the README rather than letting it be discovered.
