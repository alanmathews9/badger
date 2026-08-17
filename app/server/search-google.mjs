// Live Gmail and Drive retrieval for the web UI's first pass.
//
// The counterpart to search.mjs, and the same contract: query the source at
// ask-time, involve no model, and hand the UI rows it can render. It reuses
// tools/scripts/_google.mjs, so the read-only allowlist and the session preset
// that enforce it are shared with the agent's own tools rather than
// re-implemented here.
//
// Rows come back in the same shape as GitHub's, scored by the same function in
// rank.mjs, so the merge in search.mjs is a sort rather than a negotiation.
import { exec, exportText, kindOf, isWorkspaceFile } from "../../tools/scripts/_google.mjs";
import { planQuery, buildGmailQuery, buildDriveQuery, MAX_TERMS_GOOGLE } from "../../tools/scripts/_search-query.mjs";
import { highlight, matchedIn, score } from "./rank.mjs";

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

  const rows = (data.messages ?? []).map((m) => {
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
      state: "",
      // The display name only. A full "Name <address>" is too long for the
      // metadata line and the address adds nothing the name does not.
      author: String(m.sender ?? "").replace(/\s*<[^>]*>/, "").trim() || "unknown",
      updatedAt: String(m.messageTimestamp ?? "").slice(0, 10),
      comments: 0,
      url: m.display_url ?? "",
      threadId: m.threadId ?? null,
      snippet: body.slice(0, 240),
      matchHighlights: highlight(body, terms),
      matchedTerms: [...new Set([...matchedInTitle, ...matchedInBody])],
      matchedInDiscussionOnly: false,
      discussion: null,
      score: score({ terms, matchedInTitle, matchedInBody }),
    };
  });

  return { rows, resolvedQuery: q, apiCalls: 1 };
}

/**
 * Search Drive documents and spreadsheets.
 *
 * Drive gives a filtered list with no snippet and no score, so the text has to
 * be fetched to show or rank anything — and fetching it is two hops per file,
 * because export returns a signed URL rather than the document. That is capped:
 * the top few are worth the spend, the rest keep their name and their date.
 *
 * `apiCalls` reports the real number rather than hiding the fan-out.
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
  const files = (data.files ?? []).filter((f) => !String(f.mimeType ?? "").includes("folder"));

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

  const rows = files.map((f) => {
    const title = f.name ?? "(unnamed)";
    const body = bodyOf.get(f.id) ?? "";
    const matchedInTitle = matchedIn(title, terms);
    const matchedInBody = matchedIn(body, terms);

    // Drive said this file matched. If we did not fetch its text we cannot say
    // where, which is the same honest state as a GitHub discussion-only hit.
    const unlocatable = terms.length > 0 && !body && matchedInTitle.length === 0;

    return {
      id: `drive-${f.id}`,
      source: "drive",
      kind: kindOf(f.mimeType),
      number: null,
      title,
      state: "",
      author: "",
      updatedAt: String(f.modifiedTime ?? "").slice(0, 10),
      comments: 0,
      url: f.webViewLink ?? "",
      fileId: f.id,
      snippet: body.slice(0, 240),
      matchHighlights: highlight(body, terms),
      matchedTerms: [...new Set([...matchedInTitle, ...matchedInBody])],
      matchedInDiscussionOnly: unlocatable,
      discussion: null,
      score: score({ terms, matchedInTitle, matchedInBody, matchedInDiscussionOnly: unlocatable }),
    };
  });

  // One list call, plus two hops for each file whose text we fetched.
  return { rows, resolvedQuery: q, apiCalls: 1 + bodyOf.size * 2 };
}
