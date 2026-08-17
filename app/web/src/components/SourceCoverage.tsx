import { AlertTriangle } from "lucide-react";
import { GitHubMark } from "./octicons";
import { DriveLogo, GmailLogo } from "./BrandLogos";
import type { SearchResponse, SourceId } from "@/lib/api";

const ORDER: { id: SourceId; label: string }[] = [
  { id: "github", label: "GitHub" },
  { id: "gmail", label: "Gmail" },
  { id: "drive", label: "Drive" },
];

/**
 * What each source contributed to the list below.
 *
 * This exists because a merged list hides its own gaps. Twelve results look
 * like a complete answer whether all three sources replied or only one did,
 * and "Drive found nothing" and "Drive was never reached" produce the same
 * empty space. Stating the per-source count turns that space into information,
 * and a failed source is called out rather than quietly dropped.
 *
 * It is the same discipline the agent's answers use — a Coverage line naming
 * what was searched, including the sources that returned nothing.
 */
export function SourceCoverage({ sources }: { sources: SearchResponse["sources"] }) {
  const present = ORDER.filter(({ id }) => sources[id]);
  if (!present.length) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] text-stone-500">
      {present.map(({ id, label }) => {
        const outcome = sources[id]!;
        const Mark = id === "gmail" ? GmailLogo : id === "drive" ? DriveLogo : GitHubMark;
        return (
          <span
            key={id}
            className={`flex items-center gap-1.5 ${outcome.ok ? "" : "text-amber-700"}`}
            title={outcome.ok ? outcome.resolvedQuery : outcome.error}
          >
            <Mark size={12} />
            {label}
            {outcome.ok ? (
              <span className={outcome.count === 0 ? "text-stone-400" : "text-stone-700"}>
                {outcome.count}
              </span>
            ) : (
              <>
                <AlertTriangle className="size-3" />
                not reached
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}
