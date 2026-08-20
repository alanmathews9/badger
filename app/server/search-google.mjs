// Live Gmail and Drive retrieval for the web UI's first pass.
//
// The counterpart to search.mjs, same contract: query at ask-time, no model,
// rows the UI can render. It reuses tools/scripts/_google.mjs, so the
// read-only allowlist and session preset are shared with the agent's tools.
//
// Rows come back in GitHub's shape and are scored by the same function in
// rank.mjs, so the merge in search.mjs is a sort rather than a negotiation.
import { exec, exportText, kindOf, isWorkspaceFile } from "../../tools/scripts/_google.mjs";
import { planQuery, buildGmailQuery, buildDriveQuery, MAX_TERMS_GOOGLE } from "../../tools/scripts/_search-query.mjs";
import { highlight, markTerms, matchedIn, score, weightsOver } from "./rank.mjs";

/**
 * Search the connected mailbox.
 *
 * One API call. Gmail returns the body inline when asked for the payload, so
 * unlike Drive there is no second hop to get something worth showing.
 */
export async function searchGmail(query, { limit = 10, userId } = {}) {
  const plan = planQuery(query, { max: MAX_TERMS_GOOGLE });
  const q = buildGmailQuery(query, plan);
  const terms = plan.terms;

  const data = await exec(
    "GMAIL_FETCH_EMAILS",
    { query: q, max_results: Math.min(Math.max(limit, 1), 25), include_payload: true, user_id: "me" },
    userId,
  );

  const messages = data.messages ?? [];
  const weights = weightsOver(
    messages,
    terms,
    (m) => `${m.subject ?? ""} ${String(m.messageText ?? "")}`,
  );

  const rows = messages.map((m) => {
    const title = m.subject || "(no subject)";
    const body = String(m.messageText ?? "").replace(/\s+/g, " ").trim();
    const matchedInTitle = matchedIn(title, terms);
    const matchedInBody = matchedIn(body, terms);

    return {
      id: `mail-${m.messageId}`,
      source: "gmail",
      kind: "mail",
      number: null,
      title,
      titleMarked: markTerms(title, terms),
      state: "",
      // The display name only. A full "Name <address>" is too long for the
      // metadata line and the address adds nothing the name does not.
      author: String(m.sender ?? "").replace(/\s*<[^>]*>/, "").trim() || "unknown",
      // Kept as well as the display name — see the note in index-search.mjs.
      authorEmail: (String(m.sender ?? "").match(/<([^>]+)>/) ?? [])[1] ?? null,
      updatedAt: String(m.messageTimestamp ?? "").slice(0, 10),
      comments: 0,
      url: m.display_url ?? "",
      threadId: m.threadId ?? null,
      snippet: body.slice(0, 240),
      matchHighlights: highlight(body, terms),
      matchedTerms: [...new Set([...matchedInTitle, ...matchedInBody])],
      matchedInDiscussionOnly: false,
      discussion: null,
      score: score({ terms, matchedInTitle, matchedInBody, weights }),
    };
  });

  return { rows, resolvedQuery: q, apiCalls: 1 };
}

/**
 * Search Drive documents and spreadsheets.
 *
 * Drive gives a filtered list with no snippet and no score, and fetching text
 * is two hops per file because export returns a signed URL. Capped: the top
 * few are worth the spend, the rest keep their name and date. `apiCalls`
 * reports the real number rather than hiding the fan-out.
 */
export async function searchDrive(query, { limit = 10, userId, excerpt = 5 } = {}) {
  const plan = planQuery(query, { max: MAX_TERMS_GOOGLE });
  const q = buildDriveQuery(query, plan);
  const terms = plan.terms;

  const data = await exec(
    "GOOGLEDRIVE_FIND_FILE",
    { query: q, page_size: Math.min(Math.max(limit, 1), 25) },
    userId,
  );
  // Folders are kept, not filtered out. `fullText contains` matches a folder's
  // name, a folder is a real destination someone searches for, and the index
  // path indexes them — dropping them here would mean the live fallback
  // quietly returned a different corpus from the one every other search sees.
  const files = data.files ?? [];

  // Fetch text for the highest-value few. Ordered by title match first, so the
  // budget is spent on files that already look relevant rather than on
  // whatever Drive happened to list first.
  const ranked = [...files].sort(
    (a, b) => matchedIn(b.name, terms).length - matchedIn(a.name, terms).length,
  );
  const targets = terms.length ? ranked.filter((f) => isWorkspaceFile(f.mimeType)).slice(0, excerpt) : [];

  const texts = await Promise.allSettled(targets.map((f) => exportText(f.id, f.mimeType, userId)));
  const bodyOf = new Map();
  texts.forEach((res, i) => {
    if (res.status === "fulfilled") {
      bodyOf.set(targets[i].id, res.value.replace(/\s+/g, " ").trim());
    }
  });

  // Scored on the NAME alone, deliberately. Only the first few files have
  // their text fetched, so scoring those on text and the rest on name lets
  // fetch order leak into relevance — two documents once outranked the release
  // notes purely because their bodies had been fetched.
  //
  // Every row is judged on the same information. A file whose name says
  // nothing still counts as a match through the unlocatable path below, the
  // same half-credit a GitHub comment-only hit gets. Bodies are still fetched
  // for the excerpt; they just do not decide the order.
  //
  // Matches what the agent's own drive_search does, so the two cannot
  // disagree about the best answer.
  const weights = weightsOver(files, terms, (f) => f.name ?? "");

  const rows = files.map((f) => {
    const title = f.name ?? "(unnamed)";
    const body = bodyOf.get(f.id) ?? "";
    const matchedInTitle = matchedIn(title, terms);
    const matchedInBody = [];

    const unlocatable = terms.length > 0 && matchedInTitle.length === 0;

    return {
      id: `drive-${f.id}`,
      source: "drive",
      kind: kindOf(f.mimeType),
      number: null,
      title,
      titleMarked: markTerms(title, terms),
      state: "",
      // Owner and folder are absent on the LIVE path deliberately: this is a
      // fullText search whose response holds no folders to resolve `parents`
      // against, and a second listing call is not worth one metadata line. The
      // index path carries both.
      author: "",
      folder: null,
      updatedAt: String(f.modifiedTime ?? "").slice(0, 10),
      comments: 0,
      url: f.webViewLink ?? "",
      fileId: f.id,
      snippet: body.slice(0, 240),
      matchHighlights: highlight(body, terms),
      matchedTerms: [...new Set([...matchedInTitle, ...matchedIn(body, terms)])],
      matchedInDiscussionOnly: unlocatable,
      discussion: null,
      score: score({ terms, matchedInTitle, matchedInBody, matchedInDiscussionOnly: unlocatable, weights }),
    };
  });

  // One list call, plus two hops for each file whose text we fetched.
  return { rows, resolvedQuery: q, apiCalls: 1 + bodyOf.size * 2 };
}
