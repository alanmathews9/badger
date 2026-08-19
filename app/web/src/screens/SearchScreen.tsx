import { useEffect, useState } from "react";
import { ClayBars, DigInput } from "@/components/DigInput";
import { SearchCanvas } from "@/components/SearchCanvas";
import { ResultRow } from "@/components/ResultRow";
import { SourceRail } from "@/components/SourceRail";
import { NO_FILTERS, SearchFilters, passes, type Filters } from "@/components/SearchFilters";
import type { SearchResponse, SourceId } from "@/lib/api";

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

  // Which source the rail is filtering to, or null for all. Client-side: every
  // row is already here, so filtering is a predicate rather than a round trip.
  // Reset whenever a new query arrives — a filter held over from the last
  // search would silently hide most of the new one.
  const [source, setSource] = useState<SourceId | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  useEffect(() => {
    setSource(null);
    setFilters(NO_FILTERS);
  }, [data]);

  const shown = (data?.results ?? [])
    .filter((r) => (source ? r.source === source : true))
    .filter((r) => passes(r, filters));

  return (
    <div className="flex h-dvh flex-col bg-white">
      {/* The bar only exists once there is something to search from. On the
          empty state it would be a rule with a single icon under it.

          The box lines up with the results and runs the full width of the
          frame beneath it — same 1000px, same left edge as the source marks on
          the rows, same right edge as the rail. It was centred in its own
          720px, which put it out of step with everything it was searching. A
          search box has no reason to be narrower than its results: what you
          type is often longer than what you get back. */}
      {started && (
      <header className="shrink-0 border-b border-stone-200 px-6 pt-3.5 pb-3">
        <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-3">
          <DigInput value={query} onChange={onQueryChange} onSubmit={onSubmit} size="compact" />
          {data && data.results.length > 0 && (
            <SearchFilters rows={data.results} filters={filters} onChange={setFilters} />
          )}
        </div>
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
        <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-16">
          {/* One centred frame holding both columns. The results column is
              capped at 640px because a line of body text past roughly 90
              characters is measurably harder to scan, and these rows were
              running to 820px against the left edge of a 1500px window — wide
              AND off-centre, which is the worst of both. The rail rides on the
              right of the same frame, so the pair stays centred at any width
              and the results stay readable at every one. */}
          <div className="mx-auto flex w-full max-w-[1000px] items-start gap-10">
            <div className="min-w-0 max-w-[640px] flex-1">
              {error && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                  {error}
                </div>
              )}

              {data && (
                <>
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

                  {shown.length === 0 ? (
                    <p className="text-sm text-stone-600">
                      {source
                        ? `Nothing from ${source} matches “${data.query}”.`
                        : null}
                      {!source && (
                        <>
                          Nothing in GitHub, Gmail or Drive matches{" "}
                          <span className="font-medium">{data.query}</span>. This is a real empty
                          result, not an error — Badger searched and found nothing.
                        </>
                      )}
                    </p>
                  ) : (
                    <ul className="flex flex-col">
                      {shown.map((row) => (
                        <ResultRow key={row.id} row={row} />
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            {data && (
              <SourceRail
                data={data}
                rows={(data.results ?? []).filter((r) => passes(r, filters))}
                active={source}
                onSelect={setSource}
              />
            )}
          </div>
        </main>
      )}
    </div>
  );
}
