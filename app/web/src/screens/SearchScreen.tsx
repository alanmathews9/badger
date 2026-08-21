import { useCallback, useEffect, useState } from "react";
import { ClayBars, DigInput } from "@/components/DigInput";
import { HomeBar } from "@/components/HomeBar";
import { SearchCanvas } from "@/components/SearchCanvas";
import { ResultRow } from "@/components/ResultRow";
import { SourceRail } from "@/components/SourceRail";
import { EmptyResult } from "@/components/EmptyResult";
import { NO_FILTERS, SearchFilters, passes, type Filters } from "@/components/SearchFilters";
import type { SearchResponse, SourceId } from "@/lib/api";

export function SearchScreen({
  query,
  onQueryChange,
  onSubmit,
  onAsk,
  onAddSkill,
  onManageSkills,
  busy,
  error,
  data,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  onSubmit: (query?: string) => void;
  /** Send the box to the agent instead of the index. Home only — see HomeBar. */
  onAsk: (question: string, skill: string | null, agent: string | null) => void;
  onAddSkill: () => void;
  onManageSkills: () => void;
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
  const reset = useCallback(() => {
    setSource(null);
    setFilters(NO_FILTERS);
  }, []);
  useEffect(reset, [data, reset]);

  // Two lists, because the rail's numbers and the results list answer
  // different questions. `facets` is everything the time and author filters
  // allow, which is what the rail counts: they are "how many are there of
  // each", so choosing Documents must not zero Spreadsheets and strand the
  // reader with no way back. `shown` is what is actually on screen.
  const facets = (data?.results ?? []).filter((r) => passes(r, { ...filters, kind: null }));
  const shown = facets
    .filter((r) => (source ? r.source === source : true))
    .filter((r) => passes(r, filters));

  return (
    <div className="flex h-dvh flex-col bg-white">
      {/* The bar only exists once there is something to search from. On the
          empty state it would be a rule with a single icon under it.

          The box lines up with the results and runs the full width of the
          frame beneath it — same 920px, same left edge as the source marks on
          the rows, same right edge as the rail. It was centred in its own
          720px, which put it out of step with everything it was searching. A
          search box has no reason to be narrower than its results: what you
          type is often longer than what you get back. */}
      {started && (
      <header className="shrink-0 border-b border-stone-200 px-6 pt-3.5 pb-3">
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-3">
          <DigInput value={query} onChange={onQueryChange} onSubmit={onSubmit} size="compact" />
          {/* Rendered whenever a search has run, results or not — SearchFilters
              decides for itself what it can offer and shows disabled controls
              when the answer is nothing, so the header keeps its shape. */}
          {data && <SearchFilters rows={data.results} filters={filters} onChange={setFilters} />}
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

          {/* Search and Chat over one box. The home screen used to offer only
              the first, so the way to ask the agent a question was to notice
              Chat in the sidebar and type it again. See `HomeBar`. */}
          <div className="mt-6">
            <HomeBar
              value={query}
              onChange={onQueryChange}
              onSearch={onSubmit}
              onAsk={onAsk}
              onAddSkill={onAddSkill}
              onManageSkills={onManageSkills}
              busy={busy}
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
        <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-16 [scrollbar-gutter:stable_both-edges]">
          {/* One centred frame holding both columns. The results column is
              capped at 640px because a line of body text past roughly 90
              characters is measurably harder to scan, and these rows were
              running to 820px against the left edge of a 1500px window — wide
              AND off-centre, which is the worst of both. The rail rides on the
              right of the same frame, so the pair stays centred at any width
              and the results stay readable at every one.

              **The frame is exactly what it holds: 640 + 40 + 240 = 920.** It
              was 1000, which left ~124px of dead space to the RIGHT of the
              rail — the row is short for its frame, and the slack in a centred
              frame all collects at one end. The visible symptom was asymmetric
              padding: the gap from the sidebar to the results did not equal
              the gap from the rail to the window edge, and the search box
              above (its own frame, same 1000) overshot the rail. Sizing the
              frame to the row fixes all three at once, and the header's right
              edge and the rail's right edge now agree for free. Change any of
              the three numbers and change this one.

              `scrollbar-gutter: stable both-edges` on the scroller above is
              load-bearing too, not a flourish. `main` is the only scrolling
              element here, so on a machine with classic space-taking
              scrollbars its content box is ~15px narrower than the header's —
              and because both frames are CENTRED, that lands as a ~7.5px
              horizontal shift between the search box and the results under it,
              measured. Reserving the gutter on BOTH edges keeps the two frames
              on the same axis at every width and whether or not the page
              overflows. Where scrollbars are overlays it reserves nothing. */}
          <div className="mx-auto flex w-full max-w-[920px] items-start gap-10">
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
                    // One sentence either way. The difference between "the
                    // corpus holds nothing" and "you have filtered it all out"
                    // is carried by the button rather than by a second reading
                    // of the same news: when there is something behind the
                    // filters, there is a way back to it.
                    <EmptyResult
                      query={data.query}
                      action={
                        data.results.length > 0 ? (
                          <button
                            onClick={reset}
                            className="inline-flex h-8 items-center rounded-full border border-stone-200 bg-white px-3.5 text-[13px] font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
                          >
                            Show all {data.results.length} results
                          </button>
                        ) : null
                      }
                    />
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
                rows={facets}
                shownCount={shown.length}
                active={source}
                // Moving to another source drops the type filter with it:
                // "Documents" carried over to GitHub is a filter nothing can
                // satisfy, which reads as an empty result rather than as a
                // stale control.
                onSelect={(next) => {
                  setSource(next);
                  setFilters((f) => ({ ...f, kind: null }));
                }}
                kind={filters.kind}
                // A Drive type row is visible whatever source is selected, so
                // picking one has to move the source too — otherwise clicking
                // "Spreadsheets" from All leaves the rail showing All selected
                // while the list holds nothing but Drive, and the control that
                // did the narrowing is not the one that looks active.
                onKind={(kind) => {
                  setSource("drive");
                  setFilters((f) => ({ ...f, kind }));
                }}
              />
            )}
          </div>
        </main>
      )}
    </div>
  );
}
