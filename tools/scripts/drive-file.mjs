#!/usr/bin/env node
// drive_file — read one Google Doc or Sheet in full.
//
// Reading a Drive file is two hops, not one: the export tool hands back a
// short-lived signed URL to object storage rather than the document itself.
// That is handled in _google.mjs and is invisible here.
import { exec, run, clip, contextFrom, kindOf, isWorkspaceFile, exportText } from "./_google.mjs";
import { indexDocs, indexServes } from "./_index-tool.mjs";

run(async (args) => {
  const { file_id, max_chars } = args;
  if (!file_id) return "ERROR: `file_id` is required. Get one from drive_search.";

  // Index first. The indexed body is the exported text WITH the document's
  // margin comments folded in, so this returns more than the live call does,
  // not less — and it is the margins that decide contested questions.
  if (indexServes({ user: args._badger_user })) {
    const hit = indexDocs((d) => d.source === "drive" && d.meta?.fileId === String(file_id));
    if (hit) {
      const d = hit.rows[0];
      return (
        hit.note +
        `${d.title}  [${d.type}]\nid: ${d.meta.fileId}\n` +
        (d.meta.folder ? `folder: ${d.meta.folder}\n` : "") +
        `modified: ${d.date}\n${d.url}\n\n` +
        clip(d.body ?? "", Math.min(Math.max(Number(max_chars) || 8000, 500), 20000)) +
        `\n\nAny margin comments on this document are included above.`
      );
    }
  }

  const { userId } = contextFrom(args);
  // `fields` is required in practice. Drive's default projection is id, name
  // and mimeType only, so without it the call succeeds and every date and link
  // comes back undefined — a header reading "modified:" with nothing after it.
  const meta = await exec(
    "GOOGLEDRIVE_GET_FILE_METADATA",
    { file_id: String(file_id), fields: "*" },
    userId,
  );
  const name = meta.name ?? "(unnamed)";
  const mime = meta.mimeType ?? "";

  if (!isWorkspaceFile(mime)) {
    return (
      `${name} is a ${kindOf(mime)} (${mime}), which cannot be exported as text.\n` +
      `Only Google Docs, Sheets and Slides can be read this way.`
    );
  }

  const text = await exportText(String(file_id), mime, userId);
  const limit = Math.min(Math.max(Number(max_chars) || 8000, 500), 20000);

  // A Sheet arrives as CSV. Say so, because the model otherwise reads a comma
  // as prose and misquotes a row when citing it.
  const note =
    kindOf(mime) === "sheet"
      ? `\n\nThis is a spreadsheet exported as CSV. The first line is the header row; ` +
        `each following line is one record, fields separated by commas.`
      : "";

  return (
    `${name}  [${kindOf(mime)}]\n` +
    `id: ${file_id}\n` +
    `modified: ${String(meta.modifiedTime ?? "").slice(0, 10)}\n` +
    `${meta.webViewLink ?? ""}${note}\n\n` +
    clip(text, limit) +
    `\n\nIf this document is contested, the disagreement is in its comments — call drive_comments with this id.`
  );
});
