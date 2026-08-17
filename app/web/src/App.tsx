import { useCallback, useEffect, useRef, useState } from "react";
import { AppSidebar, type Mode } from "@/components/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ChatScreen } from "@/screens/ChatScreen";
import { SearchScreen } from "@/screens/SearchScreen";
import { ToolsScreen } from "@/screens/ToolsScreen";
import {
  fetchBudget,
  fetchSources,
  search,
  type Budget,
  type SearchResponse,
  type SourcesResponse,
} from "@/lib/api";
import { ask, describeTool } from "@/lib/ask";
import type { AnswerState } from "@/components/AnswerCard";
import { useRecentDigs } from "@/lib/recentDigs";

const IDLE: AnswerState = { running: false, activity: null, text: "", result: null, error: null };

/**
 * The shell: a rail, and one of three modes beside it.
 *
 * Search and Chat used to be one screen — a Dig ran both passes and the answer
 * landed on top of the results. They are separate destinations now, which is
 * how Glean and Onyx both do it, and it makes each half legible: Search is the
 * second it takes to retrieve, Chat is the fifteen it takes to answer.
 *
 * A Dig still starts both, because the answer is worth having by the time you
 * have read two results. Opening Chat just moves you to where it is being
 * written. Tools is the third: what Badger can reach, and what it cannot yet.
 */
export default function App() {
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AnswerState>(IDLE);
  const [sources, setSources] = useState<SourcesResponse>({ mode: "none", repo: null, sources: [] });
  const [budget, setBudget] = useState<Budget | null>(null);
  const { digs, record } = useRecentDigs();

  const cancelAsk = useRef<(() => void) | null>(null);

  const refreshSources = useCallback(() => {
    fetchSources().then(setSources).catch(() => {});
  }, []);

  useEffect(() => {
    refreshSources();
    fetchBudget().then(setBudget).catch(() => {});
    // Returning from the Composio handshake lands here with ?connected=github.
    // The parameter is not trusted — it only tells us to go and re-read the
    // real state — and it is stripped so a reload does not repeat the dance.
    if (new URLSearchParams(window.location.search).has("connected")) {
      setMode("tools");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refreshSources]);

  const startAsk = useCallback((question: string, context?: string) => {
    cancelAsk.current?.();
    setAsked(question);
    setAnswer({ ...IDLE, running: true });
    cancelAsk.current = ask(
      question,
      {
        onTool: (name, args) => setAnswer((s) => ({ ...s, activity: describeTool(name, args) })),
        onDelta: (text) => setAnswer((s) => ({ ...s, text: s.text + text })),
        onDone: (result) => {
          setAnswer((s) => ({ ...s, running: false, activity: null, text: result.answer, result }));
          // The budget just moved. Re-read it rather than decrementing a guess.
          fetchBudget().then(setBudget).catch(() => {});
        },
        onError: (message) => setAnswer((s) => ({ ...s, running: false, error: message })),
      },
      context,
    );
  }, []);

  const dig = useCallback(
    async (raw?: string) => {
      // Guard the argument rather than trusting callers. An event handler that
      // forwards its MouseEvent here fails silently inside React.
      const q = (typeof raw === "string" ? raw : query).trim();
      if (!q) return;

      setMode("search");
      setBusy(true);
      setError(null);
      setData(null);
      startAsk(q);

      try {
        const response = await search(q);
        setData(response);
        record(q, response.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : "search failed");
      } finally {
        setBusy(false);
      }
    },
    [query, record, startAsk],
  );

  const followUp = useCallback(
    (next: string) => {
      const context =
        answer.text && asked
          ? `Earlier in this conversation you were asked: "${asked}"\n\nYou answered:\n${answer.text}`
          : undefined;
      setMode("chat");
      startAsk(next, context);
    },
    [answer.text, asked, startAsk],
  );

  return (
    <SidebarProvider>
      <AppSidebar
        mode={mode}
        onModeChange={setMode}
        digs={digs}
        onPickDig={(q) => {
          setQuery(q);
          dig(q);
        }}
        budget={budget}
      />
      <SidebarInset>
        {mode === "tools" ? (
          <ToolsScreen sources={sources} onRefresh={refreshSources} />
        ) : mode === "search" ? (
          <SearchScreen
            query={query}
            onQueryChange={setQuery}
            onSubmit={dig}
            busy={busy}
            error={error}
            data={data}
            answer={answer}
            onOpenAnswer={() => setMode("chat")}
          />
        ) : (
          <ChatScreen question={asked} answer={answer} onFollowUp={followUp} />
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
