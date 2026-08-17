#!/usr/bin/env node
// drive_search — find documents and spreadsheets by their contents.
//
// Drive's query language has no bare keywords: everything is
// `fullText contains 'term'`, joined by and/or. `fullText` reaches the file
// name, the description and the content — including the cells of a Sheet, so
// spreadsheets take part in ordinary search rather than sitting in a silo.
//
// Drive returns no relevance score and no snippet, only a filtered list. So
// ranking and excerpting happen locally, the same way the web search ranks
// GitHub's rows.
import { exec, run, clip, contextFrom, kindOf, isWorkspaceFile, exportText, CROSS_SOURCE } from "./_google.mjs";
import { planQuery, buildDriveQuery, MAX_TERMS_GOOGLE } from "./_search-query.mjs";

run(async (args) => {
  const { query, kind, limit } = args;
  if (!query || !String(query).trim()) return "ERROR: `query` is required.";

  const { userId } = contextFrom(args);

  const extra = [];
  if (kind === "doc") extra.push("mimeType = 'application/vnd.google-apps.document'");
  if (kind === "sheet") extra.push("mimeType = 'application/vnd.google-apps.spreadsheet'");
  if (kind === "folder") extra.push("mimeType = 'application/vnd.google-apps.folder'");

  const plan = planQuery(query, { max: MAX_TERMS_GOOGLE });
  const q = buildDriveQuery(query, plan, { extra });
  const max = Math.min(Math.max(Number(limit) || 10, 1), 25);

  const data = await exec("GOOGLEDRIVE_FIND_FILE", { query: q, page_size: max }, userId);
  const files = data.files ?? [];

  const planNote = plan.passthrough
    ? `query: ${q}`
    : `query: ${q}\n(your words were reduced to keywords — Drive matches whole terms against file contents)`;

  if (!files.length) {
    return (
      `No files matched: ${q}\n` +
      `This is a real "nothing found", not an error.\n` +
      `Drive holds the written-down version of things — policies, retros, roadmaps, directories. ` +
      `If the answer is an argument rather than a document, try github_search or gmail_search instead.`
    );
  }

  // Drive gives us no snippet, so fetch the text of the top few and quote the
  // part that actually matched. Capped hard: each one is two HTTP hops (export
  // returns a signed URL, not the file), and an unbounded fan-out here would
  // cost more than the answer is worth.
  const terms = plan.passthrough ? [] : plan.terms;
  const excerptable = files.filter((f) => isWorkspaceFile(f.mimeType)).slice(0, 4);
  const excerpts = new Map();
  if (terms.length) {
    const texts = await Promise.allSettled(
      excerptable.map((f) => exportText(f.id, f.mimeType, userId)),
    );
    texts.forEach((res, i) => {
      if (res.status !== "fulfilled") return;
      const flat = res.value.replace(/\s+/g, " ").trim();
      const hit = terms.find((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(flat));
      if (!hit) return;
      const at = flat.search(new RegExp(`\\b${hit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
      excerpts.set(excerptable[i].id, clip(flat.slice(Math.max(0, at - 80), at + 220), 300));
    });
  }

  const lines = files.map((f, i) => {
    const excerpt = excerpts.get(f.id);
    return (
      `${i + 1}. ${f.name}  [${kindOf(f.mimeType)}]\n` +
      `   id: ${f.id}   modified ${String(f.modifiedTime ?? "").slice(0, 10)}\n` +
      (excerpt ? `   …${excerpt}\n` : "")
    );
  });

  return (
    `${planNote}\n` +
    `${files.length} file(s)\n\n` +
    lines.join("\n") +
    `\nCall drive_file with an id to read one in full. Documents here often carry comments that ` +
    `disagree with the document — call drive_comments with the same id, because the margin is ` +
    `frequently where the real answer is.\n` +
    CROSS_SOURCE
  );
});
