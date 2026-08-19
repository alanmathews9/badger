import { FolderOpen } from "lucide-react";
import { Highlight } from "./Highlight";
import { StateIcon } from "./octicons";
import { BRAND_LOGOS, DriveMark, GitHubLogo } from "./BrandLogos";
import type { SearchRow } from "@/lib/api";
import { whenLabel } from "@/lib/when";

/**
 * One hit, from any of the three sources.
 *
 * Two icons, and they answer two different questions:
 *
 *   left edge   — which SYSTEM this came from. It sits in the same place for
 *                 every source, so the eye can scan a mixed list by origin,
 *                 which is the whole point of merging them into one list.
 *   title start — WHAT it is and what state it is in. GitHub rows keep GitHub's
 *                 own icons and colours, green open and purple merged, which a
 *                 GitHub user reads without a legend. Mail and documents have
 *                 no state, so they get nothing rather than a decorative dot.
 *
 * The title is a plain blue link. Nothing else on the row is blue, so blue
 * means "this goes somewhere".
 */
export function ResultRow({ row }: { row: SearchRow }) {
  return (
    <li className="flex gap-3 border-t border-stone-100 py-3 first:border-t-0">
      {/* Sized to span the title AND the metadata beneath it: 21px of title
          line plus 16px of metadata is about 37px, so a 32px mark sits across
          both and reads as belonging to the row rather than to its first line.
          Glean's are this size for the same reason.

          The box is fixed at 32px and each mark is centred in it, because the
          glyphs do not fill their viewBoxes equally — the simple-icons Docs
          and Sheets marks carry more internal padding than the gilbarbara
          GitHub and Gmail ones, so at an identical `size` they LOOK smaller.
          Matching the boxes rather than the numbers is what makes a mixed
          list line up. */}
      <span className="mt-px flex size-8 shrink-0 items-center justify-center">
        <SourceMark row={row} />
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="flex items-baseline gap-1.5 text-[15px]/[1.4]">
          {row.source === "github" && (row.kind === "issue" || row.kind === "pr") && (
            <span className="translate-y-[2px]">
              <StateIcon kind={row.kind === "pr" ? "pr" : "issue"} state={row.state} />
            </span>
          )}
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-blue-700 visited:text-blue-700 hover:underline"
          >
            <Highlight text={row.titleMarked || row.title} tone="inherit" />
          </a>
        </h3>

        <MetaLine row={row} />

        {row.discussion ? (
          /* The match was in the thread, and we went and got it. Quoted so the
             row can be judged without opening it. */
          <blockquote className="mt-1.5 border-l-2 border-stone-200 pl-2.5 text-[12.5px]/[1.6] text-stone-600">
            <Highlight text={row.discussion.excerpt} />
            <span className="mt-0.5 block font-mono text-[10.5px] text-stone-500">
              @{row.discussion.author} in the discussion · {row.discussion.at}
            </span>
          </blockquote>
        ) : (
          <div className="mt-1 text-[12.5px]/[1.6] text-stone-600">
            {row.matchHighlights.length > 0 ? (
              /* ONE excerpt, the densest. Every match used to get its own
                 paragraph, so a row could run to eight lines and four rows
                 filled the screen. A second excerpt rarely changes the
                 decision the reader is making — whether to open the thing —
                 and a row that answers that in three lines beats one that
                 argues it in eight. A document with more matches ranks higher
                 anyway, so nothing is hidden that was not already surfaced. */
              <p>
                <Highlight text={bestExcerpt(row.matchHighlights)} />
              </p>
            ) : (
              <p className="line-clamp-2">{unlocatableText(row)}</p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Which mark a row carries.
 *
 * Drive rows get their own glyph — Docs, Sheets, folder — with the Drive
 * triangle badged on the corner, which is the mark Glean draws and which says
 * both facts at once: what the thing is, and which system it lives in. The
 * generic triangle threw away the first, and the bare Docs glyph would throw
 * away the second, which matters more here than it does in Drive itself
 * because this list is merged from three systems. See `DriveMark`.
 *
 * Anything else in Drive — a PDF, an upload — keeps the plain Drive mark,
 * because that is genuinely all we know.
 */
function SourceMark({ row }: { row: SearchRow }) {
  // Drive marks are drawn slightly larger than the rest: their glyphs sit
  // inside more padding, so an equal number renders a visibly smaller mark.
  if (row.source === "drive") return <DriveMark kind={row.kind} size={30} />;
  const Logo = BRAND_LOGOS[row.source];
  return <Logo size={26} />;
}

/** The most matches in one excerpt — the passage that best answers the query. */
function bestExcerpt(excerpts: string[]): string {
  let best = excerpts[0] ?? "";
  let most = -1;
  for (const excerpt of excerpts) {
    const hits = (excerpt.match(/<hi>/g) ?? []).length;
    if (hits > most) {
      most = hits;
      best = excerpt;
    }
  }
  return best;
}

/**
 * What to say when we know the row matched but cannot show where.
 *
 * The two cases are genuinely different and the wording says which: GitHub
 * matched inside a thread whose comments we did not fetch, while Drive matched
 * inside a document whose text we did not export. Both are "matched, not
 * shown", never "no description".
 */
function unlocatableText(row: SearchRow): string {
  // A folder has no text of its own, so there is nothing to excerpt and
  // nothing was hidden — say what it is rather than "No description.", which
  // reads as a document whose body we failed to fetch.
  if (row.kind === "folder") {
    return row.folder ? `Drive folder, inside ${row.folder}.` : "A folder in Drive.";
  }
  if (!row.matchedInDiscussionOnly) return row.snippet || "No description.";
  return row.source === "drive"
    ? "Matched inside this document."
    : "Matched somewhere in this thread's comments.";
}

/**
 * The metadata line, which differs per source because the facts differ.
 *
 * It sits directly under the title rather than under the snippet — who wrote
 * a thing and when is how a reader decides whether to read the excerpt at
 * all, so it belongs above it. Glean orders it the same way and its rows are
 * far easier to scan for it.
 *
 * Every source answers the same three questions in the same order — who, when,
 * where — so the eye lands in the same place down a mixed list. The "where"
 * carries a small icon because it is the one part whose KIND is not obvious
 * from the words: "Product" could be a folder or a label until a folder icon
 * says which, and "alan-arkind/arkind" is a repository.
 *
 * A person gets no avatar. Drive returns a `photoLink` and GitHub has one per
 * login, but both are remote images on a page whose CSP allows `img-src 'self'
 * data:` only — so it would mean proxying and caching faces to decorate a line
 * that already says the name.
 *
 * **Drive names a person after all, and the first answer here was wrong.**
 * A probe of `GOOGLEDRIVE_FIND_FILE` and `GOOGLEDRIVE_GET_FILE_METADATA`
 * showed no `owners` and no `lastModifyingUser`, and this comment said so.
 * The mistake was probing the DEFAULT response: Drive's files.list returns a
 * minimal field set and returns the rest only when asked. Onyx does ask —
 * `backend/onyx/connectors/google_drive/file_retrieval.py` spells out
 * `owners(emailAddress)` in its FILE_FIELDS mask — and Composio forwards the
 * mask, so the crawl now asks too and it costs no extra call. Reading how
 * someone else solved it was worth more than one more probe of our own.
 */
function MetaLine({ row }: { row: SearchRow }) {
  const when = whenLabel(row.updatedAt);
  const bits: React.ReactNode[] = [];

  if (row.source === "github") {
    if (row.author) bits.push(`@${row.author}`);
    if (when) bits.push(row.kind === "file" || row.kind === "commit" ? when : `updated ${when}`);
    if (row.kind === "issue" || row.kind === "pr") {
      bits.push(`${row.comments} ${row.comments === 1 ? "comment" : "comments"}`);
    }
    if (row.repo) {
      bits.push(
        <span className="inline-flex items-center gap-1">
          <GitHubLogo size={11} className="opacity-70" />
          {row.repo}
        </span>,
      );
    }
  } else if (row.source === "gmail") {
    // Both the name and the address: two colleagues share a first name far
    // more often than they share a mailbox.
    if (row.author) bits.push(row.authorEmail ? `${row.author} <${row.authorEmail}>` : row.author);
    if (when) bits.push(when);
  } else {
    if (row.author) bits.push(row.author);
    if (when) bits.push(`updated ${when}`);
    if (row.folder) {
      bits.push(
        <span className="inline-flex items-center gap-1">
          <FolderOpen className="size-3 text-stone-400" strokeWidth={2} />
          {row.folder}
        </span>,
      );
    } else {
      bits.push(row.kind === "sheet" ? "Spreadsheet" : "Document");
    }
  }

  if (bits.length === 0) return null;

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-stone-500">
      {bits.map((bit, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="text-stone-300">·</span>}
          {bit}
        </span>
      ))}
    </div>
  );
}
