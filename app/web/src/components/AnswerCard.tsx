import { AlertTriangle, BadgeCheck } from "lucide-react";
import type { AskResult } from "@/lib/ask";

export type AnswerState = {
  running: boolean;
  activity: string | null;
  text: string;
  result: AskResult | null;
  error: string | null;
};

/**
 * `AnswerCard` used to live here — the inverse block that streamed the agent's
 * answer above the search results. It was deleted when the agent came off the
 * search path: search is retrieval only now, and nothing rendered it any more.
 *
 * `tsc` does not catch an exported component that no importer uses, so this
 * kind of orphan survives a clean build. Worth checking by hand after removing
 * a screen.
 *
 * The file keeps its name for the two things still in use: the answer state
 * Chat drives, and the badge below.
 */

/**
 * The one claim the product makes about itself, rendered as a badge.
 *
 * "Verified" here means every citation appeared in something Badger actually
 * retrieved — not that the answer characterises it correctly. The wording says
 * "retrieved" rather than "correct" on purpose.
 */
export function VerificationBadge({ result }: { result: AskResult }) {
  const { verification, uncited } = result;

  if (verification.checked === 0) {
    return <Meta>no citations to check</Meta>;
  }

  if (verification.ok) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-emerald-400">
        <BadgeCheck className="size-3.5" strokeWidth={2} />
        {verification.checked} citations, all retrieved
        {uncited.length > 0 && (
          <span className="text-stone-400">· {uncited.length} opened, not cited</span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-amber-400">
      <AlertTriangle className="size-3.5" strokeWidth={2} />
      {verification.findings.length} of {verification.checked} unverified — marked in the text
    </span>
  );
}

function Meta({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px] text-stone-400">{children}</span>;
}
