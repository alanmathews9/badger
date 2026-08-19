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
import { ask, describeTool, skillDisplayName, type Turn } from "@/lib/ask";
import type { AnswerState } from "@/components/AnswerCard";
import type { ChatTurn } from "@/screens/ChatScreen";
import { useRecentDigs } from "@/lib/recentDigs";
import { loadChats, newChatId, saveChats, type StoredChat } from "@/lib/chats";

const IDLE: AnswerState = {
  running: false,
  activity: null,
  steps: [],
  text: "",
  result: null,
  error: null,
};

/**
 * The shell: a rail, and one of three modes beside it.
 *
 * Search and Chat used to be one screen — a Dig ran both passes and the answer
 * landed on top of the results. They are separate destinations now, which is
 * how Glean and Onyx both do it, and it makes each half legible: Search is the
 * second it takes to retrieve, Chat is the fifteen it takes to answer.
 *
 * **A Dig no longer starts the agent.** It did — the answer began writing itself
 * above the results on every search — and it was the wrong default three times
 * over. It spent a model call and a slot from the daily answer budget on every
 * search including the ones that were a lookup, it put fifteen seconds of
 * streaming above a list that was already complete in one, and it made the two
 * halves impossible to judge separately: a bad answer made good retrieval look
 * broken.
 *
 * Search is now retrieval and nothing else — no model on the path, free, and as
 * fast as the slowest of three APIs. Chat is a destination you go to, with its
 * own composer. Whether the agent should be involved in search at all is a real
 * question and deliberately still open; this makes it answerable by removing the
 * assumption rather than deciding it.
 */
export default function App() {
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [chats, setChats] = useState<StoredChat[]>(() => loadChats());
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sources, setSources] = useState<SourcesResponse>({ mode: "none", sources: [] });
  const [budget, setBudget] = useState<Budget | null>(null);
  const { digs, record } = useRecentDigs();

  const cancelAsk = useRef<(() => void) | null>(null);

  // Persist the active conversation whenever a turn finishes. Running turns
  // are skipped — a half-streamed answer is not worth restoring.
  useEffect(() => {
    if (!activeChatId || turns.length === 0) return;
    if (turns[turns.length - 1].answer.running) return;
    setChats((prev) => {
      const updated: StoredChat[] = [
        { id: activeChatId, title: turns[0].question, updatedAt: Date.now(), turns },
        ...prev.filter((c) => c.id !== activeChatId),
      ];
      saveChats(updated);
      return updated;
    });
  }, [turns, activeChatId]);

  useEffect(() => {
    fetchSources().then(setSources).catch(() => {});
    fetchBudget().then(setBudget).catch(() => {});
  }, []);

  // Every stream event lands on the newest turn — the only one that can be
  // running, because startAsk cancels any run in flight before appending.
  const patchLast = useCallback((fn: (s: AnswerState) => AnswerState) => {
    setTurns((ts) =>
      ts.length === 0 ? ts : [...ts.slice(0, -1), { ...ts[ts.length - 1], answer: fn(ts[ts.length - 1].answer) }],
    );
  }, []);

  const startAsk = useCallback(
    (question: string, skill: string | null = null) => {
      cancelAsk.current?.();
      if (!activeChatId) setActiveChatId(newChatId());
      // The conversation so far, as plain text. The server strips the model's
      // Sources/Coverage boilerplate and enforces its own budget; a turn that
      // errored has nothing to contribute and is left out.
      const history: Turn[] = turns
        .map((t) => ({ question: t.question, answer: t.answer.result?.answer ?? t.answer.text }))
        .filter((t) => t.answer.trim().length > 0);
      // A hand-picked skill opens the trail as its own step, because the one
      // thing the runtime cannot tell us — which skill is in play — is known
      // here for certain: the user chose it.
      const seed = skill
        ? [{ label: `Using: ${skillDisplayName(skill)}`, name: "skill", args: { skill } }]
        : [];
      setTurns((ts) => [...ts, { question, answer: { ...IDLE, running: true, steps: seed } }]);
      cancelAsk.current = ask(
        question,
        {
          onTool: (name, args) => {
            const label = describeTool(name, args);
            patchLast((s) => ({ ...s, activity: label, steps: [...s.steps, { label, name, args }] }));
          },
          onDelta: (text) => patchLast((s) => ({ ...s, text: s.text + text })),
          onDone: (result) => {
            patchLast((s) => ({ ...s, running: false, activity: null, text: result.answer, result }));
            // The budget just moved. Re-read it rather than decrementing a guess.
            fetchBudget().then(setBudget).catch(() => {});
          },
          onError: (message) => patchLast((s) => ({ ...s, running: false, error: message })),
        },
        history,
        skill,
      );
    },
    [turns, activeChatId, patchLast],
  );

  const newChat = useCallback(() => {
    cancelAsk.current?.();
    setActiveChatId(null);
    setTurns([]);
  }, []);

  const selectChat = useCallback(
    (id: string) => {
      cancelAsk.current?.();
      const chat = chats.find((c) => c.id === id);
      if (!chat) return;
      setActiveChatId(id);
      setTurns(chat.turns);
    },
    [chats],
  );

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

      try {
        const response = await search(q);
        setData(response);
        record(q);
      } catch (err) {
        setError(err instanceof Error ? err.message : "search failed");
      } finally {
        setBusy(false);
      }
    },
    [query, record],
  );

  const followUp = useCallback(
    (next: string, skill: string | null = null) => {
      setMode("chat");
      startAsk(next, skill);
    },
    [startAsk],
  );

  return (
    <SidebarProvider>
      <AppSidebar
        mode={mode}
        sources={sources}
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
          <ToolsScreen sources={sources} />
        ) : mode === "search" ? (
          <SearchScreen
            query={query}
            onQueryChange={setQuery}
            onSubmit={dig}
            busy={busy}
            error={error}
            data={data}
          />
        ) : (
          <ChatScreen
            turns={turns}
            chats={chats.map((c) => ({ id: c.id, title: c.title }))}
            activeId={activeChatId}
            onAsk={followUp}
            onNewChat={newChat}
            onSelectChat={selectChat}
          />
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
