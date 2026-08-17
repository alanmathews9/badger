import { AlertTriangle, ArrowRight, BadgeCheck, Loader2 } from "lucide-react";
import { BadgerMark } from "./BadgerMark";
import { Markdown } from "./Markdown";
import type { AskResult } from "@/lib/ask";

export type AnswerState = {
  running: boolean;
  activity: string | null;
  text: string;
  result: AskResult | null;
  error: string | null;
};

/**
 * The inverse block above the results, from screen 3b.
 *
 * It appears the moment the agent starts, not when it finishes, because the
 * thirteen seconds Badger spends searching are the most convincing part of
 * the demo — an empty spinner would waste them. While tools are running the
 * card narrates them; once text starts arriving it streams in place.
 */
export function AnswerCard({ state, onOpen }: { state: AnswerState; onOpen: () => void }) {
  const { running, activity, text, result, error } = state;
  if (!running && !text && !result && !error) return null;

  return (
    <section className="mb-5 flex gap-3 rounded-[10px] bg-stone-900 px-4 py-3.5 text-stone-200">
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-100">
        <BadgerMark size={19} fill="#1c1917" ground="#f5f5f4" />
      </span>

      <div className="min-w-0 flex-1">
        {error ? (
          <p className="text-sm text-amber-300">{error}</p>
        ) : (
          <>
            {text ? (
              <div className="text-sm/[1.65] text-stone-200">
                {/* Only the first paragraphs live here; the full answer is one
                    click away on Ask. The card stays short by design. */}
                <Markdown text={truncate(text)} tone="dark" />
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-stone-400">
                <Loader2 className="size-3.5 animate-spin" />
                {activity ?? "Thinking"}…
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              {result && (
                <button
                  onClick={onOpen}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-stone-800 px-3 text-xs font-medium text-stone-50 hover:bg-stone-700"
                >
                  Read the full answer
                  <ArrowRight className="size-3.5" strokeWidth={2} />
                </button>
              )}

              {running && text && (
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-stone-400">
                  <Loader2 className="size-3 animate-spin" />
                  writing
                </span>
              )}

              {result && <VerificationBadge result={result} />}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The one claim the product makes about itself, rendered as a badge.
 *
 * "Verified" here means every citation appeared in something Badger actually
 * retrieved — not that the answer characterises it correctly. The wording says
 * "retrieved" rather than "correct" on purpose.
 */
export function VerificationBadge({ result }: { result: AskResult }) {
  const { verification, opened, cited } = result;
  const uncited = opened.length - cited.length;

  if (verification.checked === 0) {
    return <Meta>no citations to check</Meta>;
  }

  if (verification.ok) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-emerald-400">
        <BadgeCheck className="size-3.5" strokeWidth={2} />
        {verification.checked} citations, all retrieved
        {uncited > 0 && <span className="text-stone-400">· {uncited} opened, not cited</span>}
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

/** Keep the card to roughly the design's three lines. */
function truncate(text: string, max = 320): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ")) + "…";
}
