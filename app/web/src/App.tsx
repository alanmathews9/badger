import { useCallback, useRef, useState } from "react";
import { Ask } from "@/screens/Ask";
import { Home } from "@/screens/Home";
import { Results } from "@/screens/Results";
import { search, type SearchResponse } from "@/lib/api";
import { ask, describeTool } from "@/lib/ask";
import type { AnswerState } from "@/components/AnswerCard";
import { useRecentDigs } from "@/lib/recentDigs";

const IDLE: AnswerState = { running: false, activity: null, text: "", result: null, error: null };

/**
 * Three screens and the state between them.
 *
 * One Dig starts both passes at once: /api/search returns rows in about a
 * second, and /api/ask streams an answer over the following fifteen. The
 * results never wait for the agent — that is the whole point of the split.
 */
export default function App() {
  const [view, setView] = useState<"home" | "results" | "ask">("home");
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AnswerState>(IDLE);
  const { digs, record } = useRecentDigs();

  // Cancels the in-flight agent run. A second question must not leave the
  // first one streaming into the card underneath it.
  const cancelAsk = useRef<(() => void) | null>(null);

  /** Start an agent run. `context` carries a previous exchange for follow-ups. */
  const startAsk = useCallback((question: string, context?: string) => {
    cancelAsk.current?.();
    setAsked(question);
    setAnswer({ ...IDLE, running: true });
    cancelAsk.current = ask(
      question,
      {
        onTool: (name, args) => setAnswer((s) => ({ ...s, activity: describeTool(name, args) })),
        onDelta: (text) => setAnswer((s) => ({ ...s, text: s.text + text })),
        onDone: (result) =>
          setAnswer((s) => ({ ...s, running: false, activity: null, text: result.answer, result })),
        onError: (message) => setAnswer((s) => ({ ...s, running: false, error: message })),
      },
      context,
    );
  }, []);

  const dig = useCallback(
    async (raw?: string) => {
      // Guard the argument rather than trusting callers. An event handler that
      // forwards its MouseEvent here is the bug this already had once, and it
      // fails silently: the click throws inside React and nothing happens.
      const q = (typeof raw === "string" ? raw : query).trim();
      if (!q) return;

      setView("results");
      setBusy(true);
      setError(null);
      setData(null);
      startAsk(q);

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
    [query, record, startAsk],
  );

  // A follow-up carries the previous exchange as context, because the runtime
  // has no conversation memory of its own. It stays on the Ask screen and does
  // not re-run the keyword search — the question is now a conversation, not a
  // new dig.
  const followUp = useCallback(
    (next: string) => {
      const context =
        answer.text && asked
          ? `Earlier in this conversation you were asked: "${asked}"\n\nYou answered:\n${answer.text}`
          : undefined;
      startAsk(next, context);
    },
    [answer.text, asked, startAsk],
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

  if (view === "ask") {
    return (
      <Ask
        question={asked}
        answer={answer}
        onBack={() => setView("results")}
        onFollowUp={followUp}
      />
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
      onOpenAnswer={() => setView("ask")}
    />
  );
}
