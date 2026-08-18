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
- **Webhooks: yes, via Composio Triggers, as the step AFTER chat-on-index**
  (Alan's call 2026-08-19, order settled: chat-on-index changes every
  question, triggers shrink a rarely-seen freshness window). Free tier
  covers 50K trigger events/month (verified against composio.dev/pricing;
  $0.003/event beyond, hard-capped on free). Catalogue read from the live
  API 2026-08-19: Gmail NEW_GMAIL_MESSAGE covers everything indexed; Drive
  covers created/updated/comment-added AND deleted-or-trashed — the
  deletion signal polling cannot see; GitHub covers issues, issue comments
  (= PR conversation comments) and commits, but NOT PR review comments or
  PR opened, so the 2h poll stays as catch-up. The layering is then exactly
  Glean's: triggers in seconds → incremental poll → daily full sweep.
- **The eval is the gate.** Rewiring the agent's retrieval is exactly the
  change PLAN-SEARCH-INDEX.md said must "revisit with eval evidence":
  `npm run eval` must hold ≥13/15 with the agent on the index, compared
  against a same-day baseline re-run, never last week's number.

## Order of work

1. ✅ **Done 2026-08-19.** **Incremental refresh** in the builder (`npm run index refresh`):
   updated-since crawl per source, merged into the store, counts verified
   against what each API reports, `builtAt` split into `builtAt` /
   `refreshedAt`. Then the in-server timer (default 2h,
   `BADGER_INDEX_REFRESH_HOURS`), running only while an instance is alive —
   Cloud Run's cold start already rebuilds from nothing.
   Landed as `npm run index refresh` (verified live: a tick is 42 calls on
   seed day, ~3 on a quiet day — GitHub's `updated:` qualifier is
   day-precise so same-day items re-fetch and dedupe), the
   `BADGER_INDEX_REFRESH_HOURS` timer (default 2, 0 disables, watched a
   36s-interval tick fire end to end), and the serving rule: freshness is
   judged on refreshedAt, while a builtAt older than 24h kicks the full
   rebuild sweep in the background without giving up the fast path.
2. ✅ **Done 2026-08-19.** **Index-backed agent tools.** The three search tools try the index first
   and say so in their output (path + age, the same honesty rule as the web
   UI); on a miss or no index they run their live path unchanged. Open
   tools (issue/thread/file) can serve from the index bodies the same way.
3. ✅ **Done 2026-08-19 — 14/15 with the agent on the index, against a
   13/15 same-day baseline; the one miss (why-late) re-ran clean by hand
   with four verified citations, so it is sampling noise, and the two
   answer-completeness seams (refund-policy, clearview-why) passed this
   run.** **Eval evidence.** Re-run baseline on HEAD same day, then with the
   change; ship only if ≥13/15 holds. Watch specifically for freshness
   questions ("what shipped this week") — the index carries dates, but the
   agent must not conclude "nothing" from an index gap without the live
   second look.
4. **Composio Triggers** (after chat-on-index ships its eval gate): one
   public webhook route on the server, signature-verified in place of the
   cookie gate and attacked before trusting; trigger subscriptions created
   in `npm run connect status` next to the index build; handler upserts the
   one document named by the event, reusing the refresh fetchers. A webhook
   wakes a scaled-to-zero Cloud Run instance, so push survives idle.
5. **Docs**: README freshness section (the Glean/Onyx comparison, what we
   run and what we deferred), CLAUDE.md state.
6. **Gates and the batched deploy** — deploys stay rationed; nothing
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
