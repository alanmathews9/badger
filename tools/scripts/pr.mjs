#!/usr/bin/env node
// github_pr — one pull request: state, conversation, inline review comments,
// and the files it touches.
//
// A PR carries two separate comment streams and GitHub keeps them on different
// endpoints. The conversation comments are the issue thread; the *review*
// comments are anchored to a file and line and are where the actionable
// feedback lives ("this needs the null case"). github_issue only sees the
// first stream, so triage needs this tool.
import { exec, run, clip, asList, contextFrom } from "./_github.mjs";
import { indexDocs, indexServes } from "./_index-tool.mjs";

run(async (args) => {
  const { number, max_comments } = args;
  // Whose GitHub, and which repo — injected per request by the server.
  const { userId, owner: OWNER, repo: REPO } = contextFrom(args);

  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) return "ERROR: `number` must be a pull request number.";

  // Index first — the indexed body carries the PR description with its
  // conversation and review comments folded in. What it does NOT carry is the
  // changed-file list, so a question about the diff still needs the live call;
  // that is what the note below tells the model.
  if (indexServes({ user: args._badger_user, repo: args._badger_repo })) {
    const hit = indexDocs((d) => d.source === "github" && d.type === "pr" && d.meta?.number === n);
    if (hit) {
      const d = hit.rows[0];
      return (
        hit.note +
        `#${d.meta.number} [PR, ${d.meta.state}] ${d.title}\n` +
        `by @${d.author} on ${d.date}\n${d.url}\n` +
        (d.meta.state === "open"
          ? `\n!! This PR is OPEN and unmerged. Nothing in it has shipped.\n`
          : d.meta.state === "closed"
            ? `\n!! This PR is CLOSED WITHOUT MERGING. The work in it was abandoned;\n!! do not describe it as something that happened.\n`
            : `\n(This PR was MERGED.)\n`) +
        `\n--- description and comments (${d.meta.comments ?? 0} comments, folded in) ---\n` +
        clip(d.body ?? "(empty)", 6000) +
        `\n\nThe list of changed files is not in the index. If the diff matters, this is the one\nreason to ask for it live.`
      );
    }
  }

  const cap = Math.min(Math.max(Number(max_comments) || 30, 1), 60);
  const base = { owner: OWNER, repo: REPO, pull_number: n };

  const pr = await exec("GITHUB_GET_A_PULL_REQUEST", base, userId);
  const review = asList(await exec("GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST", { ...base, per_page: cap }, userId));
  const convo = asList(await exec("GITHUB_LIST_ISSUE_COMMENTS", { owner: OWNER, repo: REPO, issue_number: n, per_page: cap }, userId));
  const files = asList(await exec("GITHUB_LIST_PULL_REQUESTS_FILES", { ...base, per_page: 50 }, userId));

  const merged = pr.merged_at ? ` MERGED ${pr.merged_at.slice(0, 10)}` : "";
  const status = pr.state === "open"
    ? `\n!! This PR is OPEN. Nothing here is settled — review comments may be\n` +
      `!! outstanding and the branch may still change.\n`
    : `\n(This PR is ${pr.state.toUpperCase()}${merged}.)\n`;

  const head =
    `PR #${pr.number} [${pr.state}${merged}] ${pr.title}\n` +
    `by @${pr.user?.login ?? "unknown"} on ${(pr.created_at ?? "").slice(0, 10)}\n` +
    `${pr.html_url}\n` +
    `+${pr.additions ?? "?"} -${pr.deletions ?? "?"} across ${pr.changed_files ?? files.length} file(s)\n` +
    status +
    `\n--- description ---\n${clip(pr.body ?? "(empty)", 1500)}\n`;

  const fileList = files.length
    ? `\n--- files changed (${files.length}) ---\n` +
      files.map((f) => `${f.status?.padEnd(9) ?? ""} ${f.filename}  +${f.additions ?? 0} -${f.deletions ?? 0}`).join("\n") +
      "\n"
    : "";

  // Review comments carry file + line, which is what makes them actionable.
  const reviewBlock = review.length
    ? `\n--- inline review comments (${review.length}) ---\n` +
      review
        .map((c) => {
          const where = `${c.path ?? "?"}${c.line ?? c.original_line ? `:${c.line ?? c.original_line}` : ""}`;
          const resolved = c.in_reply_to_id ? " (reply)" : "";
          return `@${c.user?.login ?? "unknown"} on ${where}${resolved}  ${(c.created_at ?? "").slice(0, 10)}\n${clip(c.body ?? "", 700)}`;
        })
        .join("\n\n") +
      "\n"
    : "\n--- inline review comments ---\n(none)\n";

  const convoBlock = convo.length
    ? `\n--- conversation (${convo.length}) ---\n` +
      convo
        .map((c) => `@${c.user?.login ?? "unknown"} ${(c.created_at ?? "").slice(0, 10)}:\n${clip(c.body ?? "", 900)}`)
        .join("\n\n")
    : "\n--- conversation ---\n(none)";

  return head + fileList + reviewBlock + convoBlock;
});
