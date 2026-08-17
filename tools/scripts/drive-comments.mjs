#!/usr/bin/env node
// drive_comments — read the argument in a document's margin.
//
// This tool exists for the same reason github_issue reads comments: on this
// corpus the document is the official version and the comment thread is the
// real one. The Halden retro says the engagement slipped because scope
// changed; the comment underneath it says roughly four of the six weeks were
// self-inflicted. A search engine that returns only the document is not wrong,
// it is incomplete in the way that matters.
//
// GOOGLEDRIVE_LIST_COMMENTS returns replies nested inside each comment, so
// LIST_REPLIES is only needed when a thread is long enough to paginate.
import { exec, run, clip, contextFrom } from "./_google.mjs";

run(async (args) => {
  const { file_id } = args;
  if (!file_id) return "ERROR: `file_id` is required. Get one from drive_search.";

  const { userId } = contextFrom(args);

  // `fields` is not optional in practice: Drive's default projection omits the
  // comment body entirely, so the call succeeds and returns comments with no
  // content in them.
  const data = await exec(
    "GOOGLEDRIVE_LIST_COMMENTS",
    { file_id: String(file_id), fields: "*" },
    userId,
  );

  const comments = (data.comments ?? []).filter((c) => !c.deleted);
  if (!comments.length) {
    return `No comments on file ${file_id}. The document stands on its own here.`;
  }

  const blocks = comments.map((c, i) => {
    const when = String(c.createdTime ?? "").slice(0, 10);
    const quoted = c.quotedFileContent?.value;
    const replies = (c.replies ?? []).filter((r) => !r.deleted);
    return (
      `--- comment ${i + 1} of ${comments.length} (${when}) ---\n` +
      (quoted ? `on: "${clip(quoted, 120)}"\n` : "") +
      clip(String(c.content ?? "").trim(), 1200) +
      replies
        .map((r) => `\n\n   ↳ (${String(r.createdTime ?? "").slice(0, 10)}) ${clip(String(r.content ?? "").trim(), 800)}`)
        .join("")
    );
  });

  const replyCount = comments.reduce((n, c) => n + (c.replies?.length ?? 0), 0);

  return (
    `${comments.length} comment thread(s) and ${replyCount} repl(ies) on file ${file_id}\n\n` +
    blocks.join("\n\n") +
    `\n\nSpeakers are named at the start of each comment. Drive attributes every comment to the ` +
    `account that wrote it, so cite the name in the text rather than the account.`
  );
});
