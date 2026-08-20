/**
 * Read a search tool's result list back out of its own output.
 *
 * The browser shows the documents each search found under its step. The
 * runtime hands the server every `tool_result` already, so this costs no extra
 * call: it reads the same text the model reads.
 *
 * Parsing prose is safe here because the format is ours, not a third party's.
 * All three search tools print a fixed shape so the AGENT can find ids where
 * it expects them, and `_index-tool.mjs` renders the index path identically.
 *
 * The failure mode is silence: a drifted format returns nothing and the step
 * shows no documents, which reads as "found little" rather than as a bug.
 * `tests/tool-results.test.mjs` pins all three shapes for that reason.
 *
 * Nothing here throws — a result frame is a nicety on top of an answer that
 * works without it.
 */

/** How many rows a step shows. The card scrolls; this bounds the payload. */
const DEFAULT_LIMIT = 12;

/**
 * `#8 [issue, open] Android app shipped five weeks late`
 *
 * Anchored to the line start: an issue number inside a body line ("see #14
 * for the checklist") must not become a result of its own.
 */
const GITHUB_ROW = /^#(\d+)\s+\[(issue|PR),\s*([^\]]+)\]\s+(.+)$/;

/**
 * `1. Re: launch date` then, two lines down, `   thread: 18f2ac9d1`.
 * The sender line between them is optional in practice, so the thread id is
 * searched for within the row's own block rather than at a fixed offset.
 */
const GMAIL_TITLE = /^(\d+)\.\s+(.+)$/;
const GMAIL_FROM = /^\s+from\s+(.+?)\s+—/;
const GMAIL_THREAD = /^\s+thread:\s*(\S+)/;

/** `1. Android release notes v2.4  [doc]` then `   id: 1AbCdEf   modified …` */
const DRIVE_TITLE = /^(\d+)\.\s+(.+?)\s+\[(doc|sheet|slides|pdf|folder|file)\]\s*$/;
const DRIVE_ID = /^\s+id:\s*(\S+)/;

/** Which parser a tool name selects. Anything absent yields no rows. */
const PARSERS = {
  github_search: parseGithub,
  gmail_search: parseGmail,
  drive_search: parseDrive,
};

/**
 * The documents one search found, as the browser wants them.
 *
 * @param {string} name  the tool that was called
 * @param {string} output  that call's result text
 * @param {{limit?: number}} [options]
 * @returns {{source: string, kind: string, ref: string, title: string, detail?: string}[]}
 */
export function parseToolResults(name, output, options = {}) {
  const parse = PARSERS[name];
  if (!parse || typeof output !== "string") return [];
  const limit = options.limit ?? DEFAULT_LIMIT;
  try {
    return parse(output.split("\n")).slice(0, limit);
  } catch {
    // See the header: a result list is decoration on a working answer.
    return [];
  }
}

function parseGithub(lines) {
  const rows = [];
  for (const line of lines) {
    const m = line.match(GITHUB_ROW);
    if (!m) continue;
    const [, number, type, state, title] = m;
    rows.push({
      source: "github",
      kind: type === "PR" ? "pr" : "issue",
      ref: number,
      title: title.trim(),
      // "issue · open" — the state is half the meaning of a GitHub result and
      // it is already in the text, so showing it costs nothing.
      detail: `${type} · ${state.trim()}`,
    });
  }
  return rows;
}

function parseGmail(lines) {
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const title = lines[i].match(GMAIL_TITLE);
    if (!title) continue;
    // A numbered line only starts a result if a thread id follows it before
    // the next numbered line. That is what keeps a numbered list inside a
    // footer or a body excerpt from becoming a row.
    let ref = null;
    let from = null;
    for (let j = i + 1; j < lines.length && !GMAIL_TITLE.test(lines[j]); j++) {
      const thread = lines[j].match(GMAIL_THREAD);
      if (thread) ref = thread[1];
      const sender = lines[j].match(GMAIL_FROM);
      if (sender) from = sender[1].trim();
    }
    if (!ref) continue;
    rows.push({
      source: "gmail",
      kind: "mail",
      ref,
      title: title[2].trim(),
      ...(from ? { detail: from } : {}),
    });
  }
  return rows;
}

function parseDrive(lines) {
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const title = lines[i].match(DRIVE_TITLE);
    if (!title) continue;
    let ref = null;
    for (let j = i + 1; j < lines.length && !DRIVE_TITLE.test(lines[j]); j++) {
      const id = lines[j].match(DRIVE_ID);
      if (id) {
        ref = id[1];
        break;
      }
    }
    if (!ref) continue;
    rows.push({
      source: "drive",
      // The real Drive kind, not a flattened "doc", or the trail draws the
      // plain Drive triangle on a spreadsheet while the results list draws a
      // Sheets grid for the same file. Only the trail reads this field.
      kind: DRIVE_KIND[title[3]] ?? "file",
      ref,
      title: title[2].trim(),
      detail: DRIVE_WORD[title[3]] ?? title[3],
    });
  }
  return rows;
}

/**
 * The kind the marks are drawn from, normalised to what `DriveMark` knows.
 * Anything it cannot name falls back to "file", which draws the plain Drive
 * triangle — genuinely all we know about it.
 */
const DRIVE_KIND = {
  doc: "doc",
  sheet: "sheet",
  slides: "slides",
  pdf: "pdf",
  folder: "folder",
  file: "file",
};

/** The plain word for a Drive kind, phrased as `labelOpened` already phrases it. */
const DRIVE_WORD = {
  doc: "document",
  sheet: "spreadsheet",
  slides: "presentation",
  pdf: "PDF",
  folder: "folder",
  file: "file",
};
