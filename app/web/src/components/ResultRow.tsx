import { CircleDot, GitPullRequest, MessagesSquare } from "lucide-react";
import { Highlight, HighlightTerms } from "./Highlight";
import type { SearchRow } from "@/lib/api";

/**
 * One hit. Tile, title, what matched, one mono meta line — nothing else.
 *
 * The excerpt comes from the server with its matches already marked, so the
 * highlighting is a fact about the search rather than a guess made here.
 */
export function ResultRow({ row, terms }: { row: SearchRow; terms: string[] }) {
  const Icon = row.kind === "pr" ? GitPullRequest : CircleDot;

  return (
    <li className="flex gap-3 border-t border-stone-100 py-2.5 first:border-t-0">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-stone-50">
        <Icon className="size-[15px] text-stone-900" strokeWidth={1.8} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold hover:underline"
          >
            <HighlightTerms text={row.title} terms={terms} />
          </a>
          <Badge tone={row.state === "closed" ? "solid" : "outline"}>
            {row.kind === "pr" ? "PR" : "issue"} #{row.number} · {row.state}
          </Badge>
          {/* GitHub's search reaches comment text but never says which comment
              matched, so this row's terms are somewhere in the thread. Saying
              so beats showing an excerpt with nothing highlighted in it. */}
          {row.matchedInDiscussionOnly && (
            <Badge tone="clay">
              <MessagesSquare className="size-3" strokeWidth={2} />
              matched in the discussion
            </Badge>
          )}
        </div>

        <div className="mt-1 text-[12.5px]/[1.6] text-stone-600">
          {row.matchHighlights.length > 0 ? (
            row.matchHighlights.map((excerpt, i) => (
              <p key={i} className={i > 0 ? "mt-1" : undefined}>
                <Highlight text={excerpt} />
              </p>
            ))
          ) : (
            <p className="line-clamp-2">{row.snippet || "No description."}</p>
          )}
        </div>

        <div className="mt-1.5 font-mono text-[11px] text-stone-500">
          @{row.author} · updated {row.updatedAt} · {row.comments}{" "}
          {row.comments === 1 ? "comment" : "comments"}
        </div>
      </div>
    </li>
  );
}

function Badge({
  children,
  tone = "outline",
}: {
  children: React.ReactNode;
  tone?: "outline" | "solid" | "clay";
}) {
  const tones = {
    outline: "border border-stone-200 bg-white text-stone-600",
    solid: "bg-stone-900 text-stone-50",
    clay: "border border-amber-200 bg-amber-50 text-amber-800",
  };
  return (
    <span
      className={`inline-flex h-[19px] shrink-0 items-center gap-1 rounded-full px-2 text-[10px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
