#!/usr/bin/env node
// drive_search — find documents and spreadsheets by their contents.
//
// Drive's query language has no bare keywords: everything is
// `fullText contains 'term'`, joined by and/or. `fullText` reaches the file
// name, the description and the content — including the cells of a Sheet, so
// spreadsheets take part in ordinary search rather than sitting in a silo.
//
// Drive returns no relevance score and no snippet, only a filtered list — so
// ranking and excerpting both happen locally, by the same function every other
// search path uses (_rank.mjs).
//
// The ranking here is weaker than Gmail's or GitHub's and the reason is worth
// stating: Drive will not give us the text, so a file can only be scored on its
// name. `fullText contains` is what got it into the list at all, so every row
// matched *somewhere*; what we can order on is whether the match is in the
// title. That is enough to put "Leave Policy 2026" above a document that
// mentions leave once, and not enough to order the rest. Excerpts are then
// fetched for the top few, which is the only place the body text ever exists.
import { exec, run, clip, contextFrom, kindOf, isWorkspaceFile, exportText, CROSS_SOURCE } from "./_google.mjs";
import { planQuery, buildDriveQuery, MAX_TERMS_GOOGLE } from "./_search-query.mjs";
import { matchedIn, rankBy, score, weightsOver } from "./_rank.mjs";

run(async (args) => {
  const { query, kind, limit } = args;
  if (!query || !String(query).trim()) return "ERROR: `query` is required.";

  const { userId } = contextFrom(args);

  // `kind` is normalised rather than validated, and the schema no longer
  // constrains it. The enum that used to be there turned a near-miss into a
  // dead end: asked for the leave policy the model passed kind:"documents",
  // the runtime rejected it against the enum, and the model gave up and
  // reported the validation error to the user as the answer — with the correct
  // document one call away. Measured by the eval set, 2026-08-18.
  //
  // The house rule applies: fix it in the tool, not in a prompt telling the
  // model to be more careful. An unrecognised value now searches everything,
  // which is the same result as omitting the filter and can never dead-end.
  const KINDS = {
    doc: "document", docs: "document", document: "document", documents: "document",
    sheet: "spreadsheet", sheets: "spreadsheet", spreadsheet: "spreadsheet",
    spreadsheets: "spreadsheet", table: "spreadsheet", tables: "spreadsheet",
    folder: "folder", folders: "folder", dir: "folder", directory: "folder",
  };
  const want = KINDS[String(kind ?? "").trim().toLowerCase()];

  const extra = [];
  if (want) extra.push(`mimeType = 'application/vnd.google-apps.${want}'`);

  const plan = planQuery(query, { max: MAX_TERMS_GOOGLE });
  const q = buildDriveQuery(query, plan, { extra });
  const max = Math.min(Math.max(Number(limit) || 10, 1), 25);

  // Over-fetch, rank, then cut — see the note in gmail-search.mjs.
  const pool = Math.min(max * 3, 50);
  const data = await exec("GOOGLEDRIVE_FIND_FILE", { query: q, page_size: pool }, userId);
  const found = data.files ?? [];

  const planNote = plan.passthrough
    ? `query: ${q}`
    : `query: ${q}\n(your words were reduced to keywords — Drive matches whole terms against file contents)`;

  if (!found.length) {
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
  const weights = weightsOver(found, terms, (f) => f.name ?? "");
  const files = rankBy(found, (f) =>
    score({ terms, matchedInTitle: matchedIn(f.name, terms), matchedInBody: [], weights }),
  ).slice(0, max);
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
    `${files.length} file(s) of ${found.length} considered, most relevant first\n\n` +
    lines.join("\n") +
    `\nCall drive_file with an id to read one in full. Documents here often carry comments that ` +
    `disagree with the document — call drive_comments with the same id, because the margin is ` +
    `frequently where the real answer is.\n` +
    CROSS_SOURCE
  );
});
