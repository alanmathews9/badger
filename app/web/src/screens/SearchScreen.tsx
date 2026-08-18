import { Loader2 } from "lucide-react";
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
 *
 * These three are chosen to show the thing one source cannot do: the first
 * returns three sources disagreeing about the same delay, the second is
 * answerable from mail alone, and the third is answered by authored commits
 * rather than by anyone claiming expertise.
 *
 * They must be checked whenever the corpus changes. The previous three named a
 * consultancy that had been deleted, so the first thing a visitor saw was three
 * questions that returned nothing.
 */
const SUGGESTIONS = [
  "Why was the Android app five weeks late?",
  "Did we tell Brightsmile the app would be ready in March?",
  "Who knows about payments?",
];

export function SearchScreen({
  query,
  onQueryChange,
  onSubmit,
  busy,
  error,
  data,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  onSubmit: (query?: string) => void;
  busy: boolean;
  error: string | null;
  data: SearchResponse | null;
}) {
  const started = Boolean(data || busy || error);

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
              ? `${data.total} found · ${
                  data.path === "index"
                    ? `local index, ${ageLabel(data.index?.ageMs)} old · ${data.tookMs}ms`
                    : `live · ${data.apiCalls} API ${data.apiCalls === 1 ? "call" : "calls"} · ${(data.tookMs / 1000).toFixed(1)}s`
                }`
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
            {error && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                {error}
              </div>
            )}

            {data && (
              <>
                <SourceCoverage sources={data.sources} />

                {(data.corrections?.length ?? 0) > 0 && (
                  /* The typo layer's one rule: a correction is applied visibly
                     or not at all. This line is the visibility. */
                  <p className="mb-3 text-[13px] text-stone-700">
                    {data.corrections!.map((c, i) => (
                      <span key={c.from}>
                        {i > 0 && " · "}
                        Showing results for <span className="font-medium">{c.to}</span>{" "}
                        <span className="text-stone-500">(you typed “{c.from}”)</span>
                      </span>
                    ))}
                  </p>
                )}

                {(data.unmatched?.length ?? 0) > 0 && (
                  <p className="mb-3 text-[11.5px] text-stone-500">
                    <span className="font-mono">{data.unmatched!.join(", ")}</span>{" "}
                    matched nothing as typed, and nothing in the corpus is close enough to
                    suggest instead.
                  </p>
                )}

                {data.path === "live" && data.index?.building && (
                  <p className="mb-3 text-[11.5px] text-stone-500">
                    Answered live from the three sources. The local index is building in the
                    background and will answer future searches.
                  </p>
                )}

                {data.droppedTerms.length > 0 && (
                  <p className="mb-3 text-[11.5px] text-stone-500">
                    Searched the first {data.terms.length} terms, which is as many as the
                    slowest of the three search APIs accepts, so{" "}
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
                      <ResultRow key={row.id} row={row} />
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

/** "38m" / "5.2h" — how old the local index copy is. Always shown with the
    index path, because index and live will disagree between refreshes and a
    reader must be able to judge by how much. */
function ageLabel(ageMs?: number): string {
  if (ageMs == null) return "age unknown";
  const minutes = ageMs / 60_000;
  return minutes < 90 ? `${Math.max(1, Math.round(minutes))}m` : `${(minutes / 60).toFixed(1)}h`;
}
