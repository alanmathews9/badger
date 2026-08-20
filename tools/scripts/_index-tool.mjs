// The index-first path for the agent's three search tools.
//
// Retrieval from the local index with the live tools as a second look. Onyx
// and Glean are index-only for connected sources, so a document not yet
// indexed is simply not found; keeping the live path makes Badger strictly
// more current than either.
//
// Contract with the caller (search.mjs, gmail-search.mjs, drive-search.mjs):
// return a complete tool-output string when the index can answer, null in
// every other case — missing or stale index, zero hits, filtered or quoted
// query, non-demo context. Null means "run your live path unchanged". The
// model is never asked to choose a path.
//
// Output mirrors each tool's live format, same ids in the same places, so the
// agent's next move works identically whichever path answered. Which path
// answered is stated as data at the top, because an index answer is up to
// REFRESH stale and the model must be able to say so.
import { loadIndex, createSearcher } from "./_index.mjs";
import { clip } from "./_github.mjs";
import { CROSS_SOURCE } from "./_search-query.mjs";

/** Same staleness rule as the web path (app/server/index-search.mjs). */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Who the index was built from. `npm run index` crawls through the same
// connection the tools use, so the copy is only valid for that user and, on
// GitHub, that repository.
const INDEXED_USER = process.env.BADGER_USER_ID ?? "default";
const INDEXED_REPO = process.env.BADGER_GITHUB_REPO ?? null;

/**
 * Is the local index a valid answer for THIS caller?
 *
 * A visitor searching their own connected account must not be served a copy
 * of somebody else's corpus. The question is not "did somebody name a user"
 * but "is the named user the one this index was crawled from" — testing for
 * the absence of a user fails, because `preToolUse` attaches `_badger_user`
 * on every call.
 */
export function indexServes({ user, repo } = {}) {
  if (user && user !== INDEXED_USER) return false;
  if (repo && repo !== INDEXED_REPO) return false;
  return true;
}

/** How old the index is, in the words the tool output uses. */
function ageLabel(ageMs) {
  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  return minutes < 90 ? `${minutes}m` : `${(minutes / 60).toFixed(1)}h`;
}

/**
 * Look up whole documents in the index, for the READ tools.
 *
 * The index holds comments too — `scripts/index-build.mjs` folds an issue's
 * comments and a Drive document's margins into its body — so a read finds the
 * same content the live call would, in milliseconds rather than five seconds.
 *
 * What live buys is freshness: an index read can be up to 24 hours stale. It
 * is served first anyway, with live as the second look.
 *
 * Returns null for "go live" on the same conditions the search path uses: no
 * index, stale index, no match.
 *
 * @param {(doc: object) => boolean} match
 * @returns {{ rows: object[], age: string, note: string } | null}
 */
export function indexDocs(match) {
  const index = loadIndex();
  if (!index) return null;

  const freshAt = index.refreshedAt ?? index.builtAt;
  const ageMs = Date.now() - Date.parse(freshAt);
  if (ageMs > MAX_AGE_MS) return null;

  const rows = index.docs.filter(match);
  if (!rows.length) return null;

  const age = ageLabel(ageMs);
  return {
    rows,
    age,
    // On every read: the model must be able to say how current this is.
    note:
      `read from the LOCAL INDEX (refreshed ${age} ago) — anything changed since then is not shown; ` +
      `a lookup that finds nothing here re-runs live automatically\n` +
      `today: ${new Date().toISOString().slice(0, 10)} — use this date, do not recall one\n\n`,
  };
}

/**
 * Answer one source's search from the index, or return null for "go live".
 * Tools are one-shot subprocesses, so there is nothing to cache — building
 * the searcher costs ~15ms, the search ~1ms.
 */
export function indexAnswer(source, query, { limit = 10, types = null } = {}) {
  const index = loadIndex();
  if (!index) return null;

  const freshAt = index.refreshedAt ?? index.builtAt;
  const ageMs = Date.now() - Date.parse(freshAt);
  if (ageMs > MAX_AGE_MS) return null;

  const found = createSearcher(index).search(query, { limit: index.docs.length });
  const rows = found.rows.filter(
    (r) => r.source === source && (!types || types.includes(r.type)),
  );
  // Zero hits → live, always. "Not in the index" and "does not exist" are
  // different facts.
  if (!rows.length) return null;

  const shown = rows.slice(0, Math.min(Math.max(Number(limit) || 10, 1), 25));
  const age = ageLabel(ageMs);

  const correctionNote = found.corrections.length
    ? found.corrections
        .map((c) => `showing results for "${c.to}" — "${c.from}" is not a word this corpus contains`)
        .join("\n") + "\n"
    : "";
  const unmatchedNote = found.unmatched.length
    ? `these terms matched nothing as typed and nothing similar exists: ${found.unmatched.join(", ")}\n`
    : "";

  const header =
    `answered from the LOCAL INDEX (refreshed ${age} ago) — anything changed since then is not in this list; ` +
    `a search that finds nothing here re-runs live automatically\n` +
    correctionNote +
    unmatchedNote +
    `today: ${new Date().toISOString().slice(0, 10)} — use this date, do not recall one\n` +
    `${shown.length} shown of ${rows.length} match(es), most relevant first\n\n`;

  // Same note the live github_search carries: when one account authored every
  // row it is the uploading account, so an expertise question answered from
  // this column is answered wrongly. The note routes to commit authors.
  let authorNote = "";
  if (source === "github" && shown.length > 1) {
    const authors = new Set(shown.map((r) => r.author));
    if (authors.size === 1) {
      authorNote =
        `\nEvery result above is authored by the same account (@${[...authors][0]}). That is the uploading ` +
        `account, not necessarily the writer. Real attribution lives in commit authors (github_commits with a ` +
        `path — result text often names file paths) and in the names people sign inside comments.\n`;
    }
  }

  return header + shown.map(RENDER[source]).join("\n") + FOOTER[source] + authorNote + CROSS_SOURCE;
}

// One renderer per source, shaped after that tool's live output so thread
// ids, issue numbers and file ids sit where the agent already looks.
const RENDER = {
  github: (r) => {
    const type = r.type === "pr" ? "PR" : "issue";
    return (
      `#${r.meta.number} [${type}, ${r.meta.state}] ${r.title}\n` +
      `  by @${r.author}, updated ${r.date}, ${r.meta.comments ?? 0} comments\n` +
      `  ${r.url}\n` +
      `  ${clip(r.body, 240).replace(/\n+/g, " ")}\n`
    );
  },
  gmail: (r, i) => (
    `${i + 1}. ${r.title}\n` +
    `   from ${r.meta.sender || r.author || "unknown"} — ${r.date}\n` +
    `   thread: ${r.meta.threadId}\n` +
    `   ${clip(r.body, 300).replace(/\n+/g, " ")}\n`
  ),
  drive: (r, i) => (
    `${i + 1}. ${r.title}  [${r.type}]\n` +
    `   id: ${r.meta.fileId}   modified ${r.date}\n` +
    `   …${clip(r.body, 300).replace(/\n+/g, " ")}\n`
  ),
};

const FOOTER = {
  github: `\nTo read a full thread including comments, call github_issue with its number.\n`,
  gmail:
    `\nA single message is rarely the answer. Call gmail_thread with a thread id to read the whole exchange, ` +
    `which is where the disagreement and the decision usually are.\n`,
  drive:
    `\nCall drive_file with an id to read one in full. Documents here often carry comments that ` +
    `disagree with the document — call drive_comments with the same id, because the margin is ` +
    `frequently where the real answer is.\n`,
};
