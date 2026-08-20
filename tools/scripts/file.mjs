#!/usr/bin/env node
// github_file — read a file, or list a directory, at a path in the repository.
//
// Code search does NOT work on private repositories — the REST endpoint returns
// zero hits with incomplete_results: true for every token class (docs/NOTES.md §4e).
// So files are reached by known path, never by searching their contents. Listing
// a directory is how you discover the path.
import { exec, run, clip, contextFrom } from "./_github.mjs";
import { indexDocs, indexServes } from "./_index-tool.mjs";

run(async (args) => {
  const { path, ref } = args;
  // Whose GitHub, and which repo — injected per request by the server.
  const { userId, owner: OWNER, repo: REPO } = contextFrom(args);

  if (path == null) return "ERROR: `path` is required. Use \"\" for the repository root.";

  // Index first, for both shapes this tool has: one file, and a directory
  // listing. The crawl indexes every repository file with its path in
  // meta.path, so a listing is a prefix match over those paths rather than a
  // second API call. Measured in production: three github_file calls in one
  // answer, thirteen seconds between them, for content already on disk.
  if (indexServes({ user: args._badger_user, repo: args._badger_repo })) {
    const want = String(path).replace(/^\/+|\/+$/g, "");
    const exact = indexDocs((d) => d.source === "github" && d.type === "file" && d.meta?.path === want);
    if (exact) {
      const d = exact.rows[0];
      return exact.note + `${d.meta.path} in ${OWNER}/${REPO}\n${d.url}\n\n` + clip(d.body ?? "", 8000);
    }
    const prefix = want ? `${want}/` : "";
    const under = indexDocs(
      (d) =>
        d.source === "github" &&
        d.type === "file" &&
        typeof d.meta?.path === "string" &&
        d.meta.path.startsWith(prefix) &&
        d.meta.path !== want,
    );
    if (under) {
      const names = [...new Set(under.rows.map((d) => d.meta.path.slice(prefix.length).split("/")[0]))].sort();
      return (
        under.note +
        `directory ${want || "/"} in ${OWNER}/${REPO} — ${names.length} entries\n\n` +
        names.join("\n")
      );
    }
  }

  const params = { owner: OWNER, repo: REPO, path: String(path) };
  if (ref) params.ref = String(ref);
  const data = await exec("GITHUB_GET_REPOSITORY_CONTENT", params, userId);

  // Composio wraps the GitHub payload in `content`: an array of entries for a
  // directory, a single object (with base64 `content`) for a file.
  const payload = data.content ?? data;
  const entries = Array.isArray(payload) ? payload : null;
  if (entries) {
    if (!entries.length) return `${path || "/"} is empty.`;
    const rows = entries
      .map((e) => `${e.type === "dir" ? "dir " : "file"}  ${e.path}${e.size ? `  (${e.size}b)` : ""}`)
      .sort();
    return `directory ${path || "/"} in ${OWNER}/${REPO} — ${entries.length} entries\n\n${rows.join("\n")}`;
  }

  // A file comes back base64-encoded.
  const raw = payload.content
    ? Buffer.from(String(payload.content), payload.encoding === "base64" ? "base64" : "utf8").toString("utf8")
    : (payload.text ?? "");

  if (!raw.trim()) return `${path} exists but is empty or is not a text file.`;

  return (
    `${payload.path ?? path} in ${OWNER}/${REPO}` +
    (payload.html_url ? `\n${payload.html_url}` : "") +
    `\n\n${clip(raw, 6000)}`
  );
});
