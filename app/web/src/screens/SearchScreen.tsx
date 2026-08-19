import { ClayBars, DigInput } from "@/components/DigInput";
import { SearchCanvas } from "@/components/SearchCanvas";
import { ResultRow } from "@/components/ResultRow";
import { SourceCoverage } from "@/components/SourceCoverage";
import type { SearchResponse } from "@/lib/api";

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
          {/* The same loader the chat trail uses. Retrieval is not the agent
              thinking, but it is still Badger working, and two different
              spinners for two kinds of waiting is one more than the product
              needs. */}
          {busy && <img src="/badger-thinking.svg" alt="" aria-hidden="true" className="size-6" />}
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
        // The empty state IS the home screen now, rather than a separate
        // route — and it is the first thing an evaluator sees after the gate,
        // so it carries the canvas: a ruled field and a badger that inks in
        // under the pointer. See `SearchCanvas`.
        <SearchCanvas>
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

          {/* No suggested searches here.
              There were three, hardcoded, under a "Try one of these" heading.
              Two arguments against them, and the second is the real one.

              They rot. The set before this one named a consultancy that had
              been deleted, so the first thing a visitor saw was three
              questions returning nothing — a maintenance burden on a screen
              that should have none.

              And they belong on Chat, not here. Onyx draws exactly this line:
              in `web/src/views/AppPage.tsx` the suggestions block and the
              search block are mutually exclusive — `SuggestionsUI` renders for
              `isNewSession() || isAgent()`, `SearchUI` for `isSearch` — so
              starters appear on chat and never on search. Even on chat they
              are conditional on an admin having written them
              (`hasAgentStarterMessages`), never shipped by the developer. A
              search box does not need worked examples; a conversation with an
              agent sometimes does. */}
        </SearchCanvas>
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
                    Showing results for{" "}
                    {data.corrections!.map((c, i) => (
                      <span key={c.from}>
                        {i > 0 && ", "}
                        <span className="font-medium">{c.to}</span>
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
