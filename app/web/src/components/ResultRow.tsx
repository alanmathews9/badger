import { Highlight } from "./Highlight";
import { StateIcon } from "./octicons";
import { BRAND_LOGOS } from "./BrandLogos";
import type { SearchRow } from "@/lib/api";

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
      <span className="mt-0.5 shrink-0">
        <SourceMark source={row.source} />
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="flex items-baseline gap-1.5 text-[15px]/[1.4]">
          {row.source === "github" && (
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
            <Highlight text={row.titleMarked || row.title} />
          </a>
        </h3>

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
              row.matchHighlights.map((excerpt, i) => (
                <p key={i} className={i > 0 ? "mt-1" : undefined}>
                  <Highlight text={excerpt} />
                </p>
              ))
            ) : (
              <p className="line-clamp-2">{unlocatableText(row)}</p>
            )}
          </div>
        )}

        <div className="mt-1.5 font-mono text-[11px] text-stone-500">{metaLine(row)}</div>
      </div>
    </li>
  );
}

function SourceMark({ source }: { source: SearchRow["source"] }) {
  const Logo = BRAND_LOGOS[source];
  return <Logo size={16} />;
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
  if (!row.matchedInDiscussionOnly) return row.snippet || "No description.";
  return row.source === "drive"
    ? "Matched inside this document."
    : "Matched somewhere in this thread's comments.";
}

/** The metadata line, which differs per source because the facts differ. */
function metaLine(row: SearchRow): string {
  const parts: string[] = [];

  if (row.source === "github") {
    parts.push(`${row.kind === "pr" ? "PR" : "issue"} #${row.number}`);
    if (row.author) parts.push(`@${row.author}`);
    if (row.updatedAt) parts.push(row.updatedAt);
    parts.push(`${row.comments} ${row.comments === 1 ? "comment" : "comments"}`);
  } else if (row.source === "gmail") {
    parts.push("mail");
    if (row.author) parts.push(row.author);
    if (row.updatedAt) parts.push(row.updatedAt);
  } else {
    parts.push(row.kind === "sheet" ? "spreadsheet" : "document");
    if (row.updatedAt) parts.push(`modified ${row.updatedAt}`);
  }

  return parts.join(" · ");
}
