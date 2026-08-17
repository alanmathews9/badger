import { useCallback, useState } from "react";
import { Home } from "@/screens/Home";
import { Results } from "@/screens/Results";
import { search, type SearchResponse } from "@/lib/api";
import { useRecentDigs } from "@/lib/recentDigs";

/**
 * Two screens and the state between them. Ask makes it three once /api/ask
 * exists; the routing stays this simple until it needs not to be.
 */
export default function App() {
  const [view, setView] = useState<"home" | "results">("home");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { digs, record } = useRecentDigs();

  const dig = useCallback(
    async (raw?: string) => {
      const q = (raw ?? query).trim();
      if (!q) return;

      setView("results");
      setBusy(true);
      setError(null);
      setData(null);
      try {
        const response = await search(q);
        setData(response);
        record(q, response.total);
      } catch (err) {
        // The server tells apart "found nothing" from "could not look", and a
        // rate limit arrives here as prose explaining which. Show it verbatim.
        setError(err instanceof Error ? err.message : "search failed");
      } finally {
        setBusy(false);
      }
    },
    [query, record],
  );

  if (view === "home") {
    return (
      <Home query={query} onQueryChange={setQuery} onSubmit={() => dig()} busy={busy} digs={digs} />
    );
  }

  return (
    <Results
      query={query}
      onQueryChange={setQuery}
      onSubmit={() => dig()}
      onHome={() => setView("home")}
      busy={busy}
      error={error}
      data={data}
    />
  );
}
