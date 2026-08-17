import { Loader2 } from "lucide-react";
import { AnswerCard, type AnswerState } from "@/components/AnswerCard";
import { ClayBars, DigInput } from "@/components/DigInput";
import { ResultRow } from "@/components/ResultRow";
import { SourceCoverage } from "@/components/SourceCoverage";
import type { SearchResponse } from "@/lib/api";

/**
 * Suggestions, moved here from the gate.
 *
 * They used to sit on the passphrase screen, which was the wrong place: an
 * evaluator reads them before they can act on them, and forgets. Here they are
 * one click from running. People freeze at an empty search box, and someone
 * who types "hello" sees none of the product.
 */
const SUGGESTIONS = [
  "Why did the Halden engagement slip?",
  "Who knows about payments integrations?",
  "Should we ever compress discovery to win timing?",
];

export function SearchScreen({
  query,
  onQueryChange,
  onSubmit,
  busy,
  error,
  data,
  answer,
  onOpenAnswer,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  onSubmit: (query?: string) => void;
  busy: boolean;
  error: string | null;
  data: SearchResponse | null;
  answer: AnswerState;
  onOpenAnswer: () => void;
}) {
  const started = Boolean(data || busy || error || answer.running || answer.result);

  return (
    <div className="flex h-dvh flex-col bg-white">
      {/* The bar only exists once there is something to search from. On the
          empty state it would be a rule with a single icon under it. */}
      {started && (
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 px-4">
        <DigInput value={query} onChange={onQueryChange} onSubmit={onSubmit} size="compact" />
        <span className="ml-auto flex items-center gap-2 font-mono text-[11.5px] text-stone-500">
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {busy
            ? "digging…"
            : data
              ? `${data.total} found · ${data.apiCalls} API ${data.apiCalls === 1 ? "call" : "calls"} · ${(data.tookMs / 1000).toFixed(1)}s`
              : ""}
        </span>
      </header>
      )}

      {!started ? (
        // The empty state IS the home screen now, rather than a separate route.
        <main className="relative flex flex-1 flex-col items-center justify-center px-6 pb-20">
          <div className="w-full max-w-[640px]">
            <h1 className="text-[34px]/[1.25] font-semibold tracking-[-0.03em] text-pretty">
              What do you want to dig into today?
            </h1>
            <ClayBars />

            <div className="mt-6">
              <DigInput
                value={query}
                onChange={onQueryChange}
                onSubmit={onSubmit}
                busy={busy}
                autoFocus
              />
            </div>

            <div className="mt-8">
              <h2 className="font-mono text-[10px] tracking-[0.1em] text-stone-500 uppercase">
                Try one of these
              </h2>
              <div className="mt-3 flex flex-col gap-1.5">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      onQueryChange(suggestion);
                      onSubmit(suggestion);
                    }}
                    className="rounded-lg border border-stone-200 px-3.5 py-2.5 text-left text-sm text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </main>
      ) : (
        <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-16">
          <div className="max-w-[820px]">
            <AnswerCard state={answer} onOpen={onOpenAnswer} />

            {error && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                {error}
              </div>
            )}

            {data && (
              <>
                <SourceCoverage sources={data.sources} />

                {data.droppedTerms.length > 0 && (
                  <p className="mb-3 text-[11.5px] text-stone-500">
                    Searched the first {data.terms.length} terms. GitHub allows no more, so{" "}
                    <span className="font-mono">{data.droppedTerms.join(", ")}</span> were not
                    included.
                  </p>
                )}

                {data.results.length === 0 ? (
                  <p className="text-sm text-stone-600">
                    Nothing in GitHub, Gmail or Drive matches{" "}
                    <span className="font-medium">{data.query}</span>. This is a real empty result,
                    not an error — Badger searched and found nothing.
                  </p>
                ) : (
                  <ul className="flex flex-col">
                    {data.results.map((row) => (
                      <ResultRow key={row.id} row={row} terms={data.terms} />
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
