import { FolderOpen } from "lucide-react";
import { Highlight } from "./Highlight";
import { StateIcon } from "./octicons";
import { BRAND_LOGOS, DriveMark, GitHubLogo } from "./BrandLogos";
import type { SearchRow } from "@/lib/api";
import { whenLabel } from "@/lib/when";

/**
 * One hit, from any of the three sources.
 *
 * Two icons answering two questions:
 *
 *   left edge   — which SYSTEM this came from, always in the same place so a
 *                 mixed list can be scanned by origin.
 *   title start — WHAT it is and its state. GitHub rows keep GitHub's own
 *                 icons and colours. Mail and documents have no state, so they
 *                 get nothing rather than a decorative dot.
 *
 * The title is the only blue thing on the row, so blue means "goes somewhere".
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
 * triangle badged on the corner, so the mark says both what the thing is and
 * which system it lives in. That matters more in a list merged from three
 * systems than it does inside Drive. See `DriveMark`.
 *
 * A PDF or an upload keeps the plain Drive mark: that is all we know.
 */
function SourceMark({ row }: { row: SearchRow }) {
  // Larger than the rest: these glyphs sit inside more padding, so an equal
  // number renders visibly smaller.
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
 * The two cases differ and the wording says which: GitHub matched inside a
 * thread whose comments we did not fetch, Drive inside a document whose text
 * we did not export. Both are "matched, not shown", never "no description".
 */
function unlocatableText(row: SearchRow): string {
  // A folder has no text, so nothing was hidden — say what it is rather than
  // "No description.", which reads as a failed fetch.
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
 * Under the title rather than under the snippet: who wrote a thing and when
 * is how a reader decides whether to read the excerpt at all.
 *
 * Every source answers who, when and where in that order, so the eye lands in
 * the same place down a mixed list. "Where" carries a small icon because its
 * KIND is not obvious from the words — "Product" could be a folder or a label.
 *
 * No avatars: both Drive and GitHub serve them as remote images, and the CSP
 * allows `img-src 'self' data:` only.
 *
 * Drive DOES name a person, but only when asked: files.list returns a minimal
 * field set, and the crawl sends a `fields` mask (as Onyx's own connector
 * does) at no extra call.
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
    // Name and address: two colleagues share a first name far more often than
    // they share a mailbox.
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
