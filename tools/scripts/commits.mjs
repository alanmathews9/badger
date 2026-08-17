#!/usr/bin/env node
// github_commits — recent commits, optionally narrowed to one file path.
//
// Answers "when did this change and who touched it" and, with a path, "who owns
// this" — which is otherwise unanswerable here, since code search does not serve
// private repositories.
import { exec, run, clip, asList, OWNER, REPO } from "./_github.mjs";

run(async ({ path, author, since, limit }) => {
  const args = { owner: OWNER, repo: REPO, per_page: Math.min(Math.max(Number(limit) || 15, 1), 50) };
  if (path) args.path = String(path);
  if (author) args.author = String(author);
  if (since) args.since = String(since);

  const data = await exec("GITHUB_LIST_COMMITS", args);
  const list = asList(data);

  if (!list.length) {
    return (
      `No commits found` +
      (path ? ` touching ${path}` : "") +
      (author ? ` by ${author}` : "") +
      `.\nIf a path was given, check it exists — github_file on its parent directory will tell you.`
    );
  }

  const rows = list.map((c) => {
    const msg = clip(c.commit?.message ?? "", 120).split("\n")[0];
    const who = c.commit?.author?.name ?? c.author?.login ?? "unknown";
    const when = (c.commit?.author?.date ?? "").slice(0, 10);
    return `${(c.sha ?? "").slice(0, 7)}  ${when}  ${who}\n  ${msg}\n  ${c.html_url ?? ""}`;
  });

  return (
    `${list.length} commit(s) in ${OWNER}/${REPO}` +
    (path ? ` touching ${path}` : "") +
    `\n\n${rows.join("\n")}`
  );
});
