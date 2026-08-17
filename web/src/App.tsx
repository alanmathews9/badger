import { useCallback, useRef, useState } from "react";
import { Home } from "@/screens/Home";
import { Results } from "@/screens/Results";
import { search, type SearchResponse } from "@/lib/api";
import { ask, describeTool } from "@/lib/ask";
import type { AnswerState } from "@/components/AnswerCard";
import { useRecentDigs } from "@/lib/recentDigs";

const IDLE: AnswerState = { running: false, activity: null, text: "", result: null, error: null };

/**
 * Two screens and the state between them.
 *
 * One Dig starts both passes at once: /api/search returns rows in about a
 * second, and /api/ask streams an answer over the following fifteen. The
 * results never wait for the agent — that is the whole point of the split.
 */
export default function App() {
  const [view, setView] = useState<"home" | "results">("home");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AnswerState>(IDLE);
  const { digs, record } = useRecentDigs();

  // Cancels the in-flight agent run. A second Dig must not leave the first one
  // streaming into the card underneath it.
  const cancelAsk = useRef<(() => void) | null>(null);

  const dig = useCallback(
    async (raw?: string) => {
      const q = (raw ?? query).trim();
      if (!q) return;

      cancelAsk.current?.();
      setView("results");
      setBusy(true);
      setError(null);
      setData(null);
      setAnswer({ ...IDLE, running: true });

      cancelAsk.current = ask(q, {
        onTool: (name, args) =>
          setAnswer((s) => ({ ...s, activity: describeTool(name, args) })),
        onDelta: (text) => setAnswer((s) => ({ ...s, text: s.text + text })),
        onDone: (result) =>
          setAnswer((s) => ({ ...s, running: false, activity: null, text: result.answer, result })),
        onError: (message) => setAnswer((s) => ({ ...s, running: false, error: message })),
      });

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

  const goHome = useCallback(() => {
    cancelAsk.current?.();
    setAnswer(IDLE);
    setView("home");
  }, []);

  if (view === "home") {
    return (
      <Home query={query} onQueryChange={setQuery} onSubmit={dig} busy={busy} digs={digs} />
    );
  }

  return (
    <Results
      query={query}
      onQueryChange={setQuery}
      onSubmit={() => dig()}
      onHome={goHome}
      busy={busy}
      error={error}
      data={data}
      answer={answer}
    />
  );
}
