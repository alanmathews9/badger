import { Highlight, HighlightTerms } from "./Highlight";
import { GitHubMark, StateIcon } from "./octicons";
import type { SearchRow } from "@/lib/api";

/**
 * One hit.
 *
 * Two icons, and they answer two different questions:
 *
 *   left edge   — which SYSTEM this came from. GitHub today, Drive and Gmail
 *                 later. It stays in the same place for every source, so the
 *                 eye can scan a mixed list by origin.
 *   title start — WHAT it is and what state it is in, in GitHub's own icons
 *                 and colours: green open, purple merged or completed. A
 *                 GitHub user reads it without a legend, which is why this
 *                 replaced the text badges.
 *
 * The title is a plain blue link. Nothing else on the row is blue, so blue
 * means "this goes somewhere".
 */
export function ResultRow({ row, terms }: { row: SearchRow; terms: string[] }) {
  return (
    <li className="flex gap-3 border-t border-stone-100 py-3 first:border-t-0">
      <span className="mt-0.5 shrink-0 text-stone-900">
        <GitHubMark size={16} />
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="flex items-baseline gap-1.5 text-[15px]/[1.4]">
          <span className="translate-y-[2px]">
            <StateIcon kind={row.kind} state={row.state} />
          </span>
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-blue-700 visited:text-blue-700 hover:underline"
          >
            <HighlightTerms text={row.title} terms={terms} />
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
              <p className="line-clamp-2">
                {row.matchedInDiscussionOnly
                  ? "Matched somewhere in this thread's comments."
                  : row.snippet || "No description."}
              </p>
            )}
          </div>
        )}

        <div className="mt-1.5 font-mono text-[11px] text-stone-500">
          {row.kind === "pr" ? "PR" : "issue"} #{row.number} · @{row.author} · {row.updatedAt} ·{" "}
          {row.comments} {row.comments === 1 ? "comment" : "comments"}
        </div>
      </div>
    </li>
  );
}

