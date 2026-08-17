import { ArrowLeft, Loader2 } from "lucide-react";
import { DigInput } from "@/components/DigInput";
import { ResultRow } from "@/components/ResultRow";
import { TopBar } from "@/components/TopBar";
import type { SearchResponse } from "@/lib/api";

/**
 * The results page. Flat, ranked, left-aligned in a 820px column — no right
 * rail, no source filters. There is one source, and a filter with one option
 * is furniture.
 *
 * The answer card lands above this list once /api/ask exists; the list does
 * not wait for it.
 */
export function Results({
  query,
  onQueryChange,
  onSubmit,
  onHome,
  busy,
  error,
  data,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  onSubmit: () => void;
  onHome: () => void;
  busy: boolean;
  error: string | null;
  data: SearchResponse | null;
}) {
  return (
    <div className="flex h-dvh flex-col bg-white text-stone-900">
      <TopBar>
        <DigInput value={query} onChange={onQueryChange} onSubmit={onSubmit} size="compact" />
      </TopBar>

      <div className="flex shrink-0 items-center gap-3 border-b border-stone-100 px-6 py-3.5">
        <button
          onClick={onHome}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-stone-600 hover:text-stone-900"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} />
          New dig
        </button>

        <span className="ml-auto flex items-center gap-2 font-mono text-[11.5px] text-stone-500">
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {busy
            ? "digging…"
            : data
              ? `${data.total} found · ${data.apiCalls} API call · ${(data.tookMs / 1000).toFixed(1)}s`
              : ""}
        </span>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-16">
        <div className="max-w-[820px]">
          {error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
              {error}
            </div>
          )}

          {data && (
            <>
              {/* Terms past GitHub's six-operator ceiling are dropped. Saying
                  which ones beats quietly searching for less than was asked. */}
              {data.droppedTerms.length > 0 && (
                <p className="mb-3 text-[11.5px] text-stone-500">
                  Searched the first {data.terms.length} terms. GitHub allows no more, so{" "}
                  <span className="font-mono">{data.droppedTerms.join(", ")}</span> were not
                  included.
                </p>
              )}

              {data.results.length === 0 ? (
                <p className="text-sm text-stone-600">
                  Nothing in <span className="font-mono">{data.repo}</span> matches{" "}
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
    </div>
  );
}
