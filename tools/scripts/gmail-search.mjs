#!/usr/bin/env node
// gmail_search — find mail by text.
//
// Same planning problem as GitHub, same fix: Gmail ANDs bare words, so a whole
// question handed over verbatim finds nothing while its keywords find plenty.
// The planner is shared with the GitHub tool and the web search so the three
// cannot drift, which they did once already.
import { exec, run, clip, contextFrom, CROSS_SOURCE } from "./_google.mjs";
import { planQuery, buildGmailQuery, MAX_TERMS_GOOGLE } from "./_search-query.mjs";
import { matchedIn, rankBy, score, weightsOver } from "./_rank.mjs";
import { indexAnswer, indexServes } from "./_index-tool.mjs";

run(async (args) => {
  const { query, from, since_days, limit } = args;
  if (!query || !String(query).trim()) return "ERROR: `query` is required.";

  // Index first, live as the second look — see _index-tool.mjs. Filtered
  // calls (from, date window) and non-demo users go straight to live.
  if (!from && since_days == null && indexServes({ user: args._badger_user })) {
    const viaIndex = indexAnswer("gmail", query, { limit });
    if (viaIndex) return viaIndex;
  }

  const { userId } = contextFrom(args);

  const extra = [];
  if (from) extra.push(`from:${String(from).trim()}`);

  // Date windows are computed here, never written by the model. Asked for
  // "last week" it produces a date from its training data, and the search then
  // succeeds against the wrong period — a silent correctness bug rather than
  // a visible failure.
  const today = new Date();
  if (since_days != null && !/\b(after|before|newer_than|older_than):/.test(query)) {
    const d = Math.min(Math.max(Number(since_days) || 7, 1), 3650);
    const since = new Date(today.getTime() - d * 86400_000);
    extra.push(`after:${since.toISOString().slice(0, 10).replace(/-/g, "/")}`);
  }

  const plan = planQuery(query, { max: MAX_TERMS_GOOGLE });
  const q = buildGmailQuery(query, plan, { extra });
  const max = Math.min(Math.max(Number(limit) || 10, 1), 25);

  // Fetch a wider pool than we show, because ranking can only reorder what the
  // engine already handed over. Asking Gmail for ten and re-sorting those ten
  // fixes nothing: for an OR'd query its ten are the ten most recent, and the
  // February message that answers the question was never in them. Over-fetch,
  // rank, then cut. Measured 2026-08-18 — see _rank.mjs.
  const pool = Math.min(max * 4, 50);

  const data = await exec(
    "GMAIL_FETCH_EMAILS",
    { query: q, max_results: pool, include_payload: true, user_id: "me" },
    userId,
  );
  const messages = data.messages ?? [];

  const planNote = plan.passthrough
    ? `query: ${q}`
    : `query: ${q}\n(your words were reduced to keywords and OR'd — Gmail requires every word to match, so a whole question finds nothing)`;

  if (!messages.length) {
    return (
      `No mail matched: ${q}\n` +
      `This is a real "nothing found", not an error.\n` +
      `Your words were already reduced to keywords and OR'd, so rephrasing the same idea will not help. ` +
      `Try a different name, client or date range — or search Drive and GitHub, which hold different material.`
    );
  }

  // Re-rank locally. Gmail's own order for an OR'd query is effectively
  // newest-first, which is the wrong answer to almost every question worth
  // asking: "did we promise them March?" is answered by a message from
  // February, and it was losing to July account noise until this existed.
  // Measured 2026-08-18 — see _rank.mjs.
  const terms = plan.passthrough ? [] : plan.terms;
  const bodyOf = (m) => String(m.messageText ?? m.preview?.body ?? "");
  const weights = weightsOver(messages, terms, (m) => `${m.subject ?? ""} ${bodyOf(m)}`);
  const ranked = rankBy(messages, (m) => {
    const body = bodyOf(m);
    return score({
      terms,
      matchedInTitle: matchedIn(m.subject, terms),
      matchedInBody: matchedIn(body, terms),
      weights,
    });
  }).slice(0, max);

  const lines = ranked.map((m, i) => {
    const when = String(m.messageTimestamp ?? "").slice(0, 10);
    const body = String(m.messageText ?? m.preview?.body ?? "").replace(/\s+/g, " ").trim();
    return (
      `${i + 1}. ${m.subject || "(no subject)"}\n` +
      `   from ${m.sender || "unknown"} — ${when}\n` +
      `   thread: ${m.threadId}\n` +
      (body ? `   ${clip(body, 300)}\n` : "")
    );
  });

  return (
    `${planNote}\n` +
    `today: ${today.toISOString().slice(0, 10)} — use this date, do not recall one\n` +
    `${ranked.length} message(s) of ${messages.length} considered, most relevant first\n\n` +
    lines.join("\n") +
    `\nA single message is rarely the answer. Call gmail_thread with a thread id to read the whole exchange, ` +
    `which is where the disagreement and the decision usually are.\n` +
    CROSS_SOURCE
  );
});
