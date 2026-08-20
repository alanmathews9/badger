import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ChatScreen } from "@/screens/ChatScreen";
import { SearchScreen } from "@/screens/SearchScreen";
import { SkillsScreen } from "@/screens/SkillsScreen";
import { ToolsScreen } from "@/screens/ToolsScreen";
import {
  fetchBudget,
  fetchSources,
  search,
  type Budget,
  type SearchResponse,
  type SourcesResponse,
} from "@/lib/api";
import { ask, isStepVisible, skillFromRead, type Turn } from "@/lib/ask";
import type { AnswerState } from "@/components/AnswerCard";
import type { ChatTurn } from "@/screens/ChatScreen";
import {
  history,
  newChatId,
  type ChatSummary,
  type SearchEntry,
  type SearchFacts,
} from "@/lib/history";

const IDLE: AnswerState = {
  running: false,
  steps: [],
  text: "",
  result: null,
  error: null,
};

/**
 * The shell: a rail, and one of three destinations beside it.
 *
 * Destinations are URLs, not `useState`, so a conversation can be linked to
 * and reload lands where you were. `serveStatic` falls back to index.html so
 * any path serves the app.
 *
 *   /search        the box, empty
 *   /search?q=…    results for a query
 *   /chat          a new conversation
 *   /chat/:id      one conversation, linkable and reloadable
 *   /tools         what Badger can reach
 *
 * A reloaded `/search?q=…` re-runs the search rather than restoring stored
 * results. Retrieval costs no model call, so this is cheap and never stale.
 *
 * A search does not start the agent. Search is retrieval; Chat is the agent.
 */
export default function App() {
  const navigate = useNavigate();

  const [sources, setSources] = useState<SourcesResponse>({ mode: "none", sources: [] });
  const [budget, setBudget] = useState<Budget | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  // The chat list is a Postgres round trip, so there is a real gap before it
  // arrives and the pane must not assert "No chats yet" during it.
  const [chatsLoading, setChatsLoading] = useState(true);
  const [searches, setSearches] = useState<SearchEntry[]>([]);

  // The run lives above the routes on purpose: switching to Search mid-answer
  // must not cancel it. Only starting another question does that.
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const cancelAsk = useRef<(() => void) | null>(null);

  // Is an answer still being written? `cancelAsk` cannot say (never cleared on
  // normal completion) and `turns` is not readable from the callbacks below.
  // `openChat` reads this to refuse to throw a live run away.
  const runningRef = useRef(false);

  // Which conversation is being answered, and which finished unseen — the
  // sidebar needs the id, not just runningRef's boolean. The app runs one
  // answer at a time, so `runningChatId` is the active chat or null.
  const [runningChatId, setRunningChatId] = useState<string | null>(null);
  const [unseenChats, setUnseenChats] = useState<Set<string>>(new Set());

  // Finished while the reader was elsewhere. Checked against the address bar,
  // not `activeChatId`: a run's conversation stays active while you read
  // Search, and only being on screen means you saw the answer.
  const markFinished = useCallback((id: string | null) => {
    setRunningChatId(null);
    if (!id) return;
    if (window.location.pathname.startsWith(`/chat/${id}`)) return;
    setUnseenChats((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // A conversation is being fetched. See `openChat` — the store is Postgres.
  const [loadingChat, setLoadingChat] = useState(false);
  const loadToken = useRef(0);

  // Read inside callbacks that must not be rebuilt on every change: a route
  // effect firing on handler identity would reload the chat mid-stream.
  const activeIdRef = useRef<string | null>(null);
  const setActive = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveChatId(id);
  }, []);

  useEffect(() => {
    fetchSources().then(setSources).catch(() => {});
    fetchBudget().then(setBudget).catch(() => {});
    history
      .listChats()
      .then(setChats)
      .catch(() => {})
      .finally(() => setChatsLoading(false));
    history.listSearches().then(setSearches).catch(() => {});
  }, []);

  /**
   * Has anything been ASKED in this conversation since it was opened?
   *
   * Without it, opening a chat saved it back with a fresh `updatedAt` and
   * every conversation clicked jumped to the top of the list.
   */
  const dirty = useRef(false);

  // Conversations this browser has already written a row for. See below.
  const listed = useRef<Set<string>>(new Set());

  // Persist whenever a turn finishes, and once at the START of a new
  // conversation so its row exists while the answer is being written —
  // otherwise a question in flight is invisible in the sidebar. Later saves
  // still wait for the turn, so a half-streamed answer is never what is
  // stored.
  useEffect(() => {
    if (!dirty.current) return;
    if (!activeChatId || turns.length === 0) return;
    const streaming = turns[turns.length - 1].answer.running;
    const firstSave = !listed.current.has(activeChatId);
    if (streaming && !firstSave) return;
    if (firstSave) listed.current.add(activeChatId);
    const record = { id: activeChatId, title: turns[0].question, updatedAt: Date.now(), turns };
    history
      .saveChat(record)
      .then(() => history.listChats())
      .then(setChats)
      .catch(() => {});
  }, [turns, activeChatId]);

  // Every stream event lands on the newest turn — the only one that can be
  // running, because startAsk cancels any run in flight before appending.
  const patchLast = useCallback((fn: (s: AnswerState) => AnswerState) => {
    setTurns((ts) =>
      ts.length === 0
        ? ts
        : [...ts.slice(0, -1), { ...ts[ts.length - 1], answer: fn(ts[ts.length - 1].answer) }],
    );
  }, []);

  const startAsk = useCallback(
    (question: string, skill: string | null = null, fresh = false) => {
      cancelAsk.current?.();
      dirty.current = true;
      // Abandon any conversation still being fetched. Its `setTurns` would
      // otherwise land after this question was appended and wipe it.
      loadToken.current++;
      setLoadingChat(false);

      // The first question mints an id and puts it in the address bar, so the
      // answer is linkable while it is written.
      //
      // `replace` only from /chat, where /chat and /chat/<id> are the same
      // conversation. From the search home it is a real move, and replacing
      // there would overwrite the /search entry so Back leaves the app.
      if (!activeIdRef.current) {
        const id = newChatId();
        setActive(id);
        navigate(`/chat/${id}`, { replace: !fresh });
      }

      // The conversation so far, as plain text. The server strips the model's
      // Sources/Coverage boilerplate and enforces its own budget; a turn that
      // errored has nothing to contribute and is left out.
      // `fresh` marks the first question of a new conversation. `turns` here
      // is a closure over the PREVIOUS one — the caller clears it in the same
      // tick and this array does not see that — so without the flag a question
      // from Home carries the last conversation's history into the prompt.
      const priorTurns: Turn[] = (fresh ? [] : turns)
        .map((t) => ({ question: t.question, answer: t.answer.result?.answer ?? t.answer.text }))
        .filter((t) => t.answer.trim().length > 0);

      // A hand-picked skill opens the trail as its own step.
      const seed = skill
        ? [{ name: "skill", args: { skill } }]
        : [];

      setTurns((ts) => [...ts, { question, answer: { ...IDLE, running: true, steps: seed } }]);
      runningRef.current = true;
      // activeIdRef, not activeChatId: the id was minted a few lines above and
      // the state has not re-rendered yet.
      setRunningChatId(activeIdRef.current);
      setUnseenChats((prev) => {
        if (!activeIdRef.current || !prev.has(activeIdRef.current)) return prev;
        const next = new Set(prev);
        next.delete(activeIdRef.current);
        return next;
      });

      // Captured now: by the time the stream ends the reader may have opened
      // another chat, and the dot must land on the row that was answered.
      const askedIn = activeIdRef.current;

      cancelAsk.current = ask(
        question,
        {
          onTool: (name, args, index) => {
            // Bookkeeping — see `isStepVisible`. Dropped here rather than at
            // render time so nothing downstream counts around it; its
            // narration stays in `text` for the next real step.
            if (!isStepVisible(name, args)) return;
            // The skill can arrive three ways — seeded here, announced by the
            // server, or the model reading a SKILL.md. Same event to a reader,
            // so whichever lands second is dropped.
            const slug =
              name === "skill" ? String(args.skill ?? "") || null : skillFromRead(args);
            // Text written BEFORE a tool call is narration, not the answer.
            // Both stream through one channel, so a tool call is the signal to
            // move it out of the answer area — MOVED onto the step it explains,
            // not deleted, or prose written mid-run vanishes off the screen.
            patchLast((s) => {
              if (slug && s.steps.some((step) => step.args.skill === slug)) return s;
              return {
                ...s,
                text: "",
                steps: [
                  ...s.steps,
                  {
                    name,
                    // Under the skill's slug, so the duplicate check above
                    // sees both forms alike.
                    args: slug ? { ...args, skill: slug } : args,
                    index,
                    narration: s.text.trim() || undefined,
                  },
                ],
              };
            });
          },
          // Matched on the run's own call number, not array position, which
          // the hidden steps and the skill row both shift.
          onResults: (index, results) =>
            patchLast((s) => ({
              ...s,
              steps: s.steps.map((step) => (step.index === index ? { ...step, found: results } : step)),
            })),
          onDelta: (text) => patchLast((s) => ({ ...s, text: s.text + text })),
          onDone: (result) => {
            runningRef.current = false;
            markFinished(askedIn);
            patchLast((s) => ({ ...s, running: false, text: result.answer, result }));
            // The budget just moved. Re-read it rather than decrementing a guess.
            fetchBudget().then(setBudget).catch(() => {});
          },
          onError: (message) => {
            runningRef.current = false;
            markFinished(askedIn);
            patchLast((s) => ({ ...s, running: false, error: message }));
          },
        },
        priorTurns,
        skill,
      );
    },
    [turns, navigate, patchLast, setActive, markFinished],
  );

  /**
   * Abort the run in flight.
   *
   * `ask`'s canceller aborts the socket and marks itself finished, so no
   * `onError` or `onDone` arrives and nothing else would clear `running`.
   *
   * Closes as `stopped`, not as an error: an interruption is a choice the
   * reader made, and a warning for that is wrong.
   */
  const stopAsk = useCallback(() => {
    cancelAsk.current?.();
    cancelAsk.current = null;
    runningRef.current = false;
    setRunningChatId(null);
    patchLast((s) => (s.running ? { ...s, running: false, stopped: true } : s));
  }, [patchLast]);

  /**
   * Point the conversation state at whatever `/chat/:id` currently names.
   *
   * A no-op when the id is already open, which is what keeps a running answer
   * alive: `startAsk` navigates to the id it just minted, and without the
   * guard the route change would reload it and discard the stream.
   *
   * The load is visible, because `getChat` is a Postgres request.
   */
  const openChat = useCallback(
    async (id: string | null, { force = false } = {}) => {
      // Opening is what "seen" means, so the dot clears before the early
      // return — clicking the row you are on is exactly that case.
      if (id) {
        setUnseenChats((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      if (id === activeIdRef.current) return;

      // An answer being written is not something a click can throw away.
      // While a run is live, bare `/chat` resolves to the conversation writing
      // it rather than clearing the turns — so New chat waits for the answer
      // or for Stop, which beats silently discarding it.
      //
      // `force` is the caller saying "I am starting a run, not discarding
      // one" — askFromHome, which must land on a clean conversation.
      if (!id && !force && runningRef.current && activeIdRef.current) {
        navigate(`/chat/${activeIdRef.current}`, { replace: true });
        return;
      }

      cancelAsk.current?.();
      runningRef.current = false;
      setRunningChatId(null);
      dirty.current = false;
      if (!id) {
        setActive(null);
        setTurns([]);
        setLoadingChat(false);
        return;
      }

      // Claim this load: the two requests can complete in either order.
      const token = ++loadToken.current;
      setActive(id);
      setTurns([]);
      setLoadingChat(true);

      const chat = await history.getChat(id).catch(() => null);
      if (token !== loadToken.current) return;
      setLoadingChat(false);

      // A conversation this browser has never held: land on a new chat rather
      // than an empty thread pretending to be theirs.
      if (!chat) {
        navigate("/chat", { replace: true });
        return;
      }
      setTurns(chat.turns);
    },
    [navigate, setActive],
  );

  /**
   * A question asked from the search home.
   *
   * Always a new conversation. `activeChatId` survives navigating away from
   * /chat, so without the reset a question typed on Home would append to
   * whatever was last open.
   *
   * `openChat(null)` is safe synchronously: its null branch has no await
   * before `setActive`. `force` because the live-answer guard would otherwise
   * make this reset a no-op.
   */
  const askFromHome = useCallback(
    (question: string, skill: string | null) => {
      openChat(null, { force: true });
      startAsk(question, skill, true);
    },
    [openChat, startAsk],
  );

  const recordSearch = useCallback((query: string, facts: SearchFacts) => {
    history
      .recordSearch(query, facts)
      .then(() => history.listSearches())
      .then(setSearches)
      .catch(() => {});
  }, []);

  return (
    <SidebarProvider>
      <AppSidebar sources={sources} searches={searches} budget={budget} />
      <SidebarInset>
        <Routes>
          <Route path="/" element={<Navigate to="/search" replace />} />
          <Route
            path="/search"
            element={
              <SearchRoute
                onSearched={recordSearch}
                onAsk={askFromHome}
                // The pane lives on Chat; ChatScreen opens it and strips the
                // param so the URL does not stay in a one-shot state.
                onAddSkill={() => navigate("/chat?new-skill=1")}
                onManageSkills={() => navigate("/skills")}
              />
            }
          />
          <Route
            path="/chat"
            element={<ChatRoute turns={turns} chats={chats} loading={loadingChat} chatsLoading={chatsLoading} runningChatId={runningChatId} unseenChats={unseenChats} onOpen={openChat} onAsk={startAsk} onStop={stopAsk} />}
          />
          <Route
            path="/chat/:id"
            element={<ChatRoute turns={turns} chats={chats} loading={loadingChat} chatsLoading={chatsLoading} runningChatId={runningChatId} unseenChats={unseenChats} onOpen={openChat} onAsk={startAsk} onStop={stopAsk} />}
          />
          <Route path="/skills" element={<SkillsScreen />} />
          <Route path="/tools" element={<ToolsScreen sources={sources} />} />
          {/* An unknown path is a typo or a stale link, not an error worth a
              page of its own. */}
          <Route path="*" element={<Navigate to="/search" replace />} />
        </Routes>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * Search, with the query in the URL.
 *
 * The URL is the source of truth for what has been searched; the box holds a
 * draft. Submitting writes `?q=` and the effect below runs it, so typing, a
 * suggestion, history, Back and a pasted link all take one path.
 */
function SearchRoute({
  onSearched,
  onAsk,
  onAddSkill,
  onManageSkills,
}: {
  onSearched: (query: string, facts: SearchFacts) => void;
  onAsk: (question: string, skill: string | null) => void;
  onAddSkill: () => void;
  onManageSkills: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";

  const [draft, setDraft] = useState(query);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Arriving from anywhere that is not the box — back button, a link, the
  // sidebar — the box has to catch up with the address bar.
  useEffect(() => setDraft(query), [query]);

  useEffect(() => {
    if (!query) {
      setData(null);
      setError(null);
      return;
    }
    // Two searches can be in flight when someone types fast or holds the back
    // button; the older one must not land on top of the newer.
    let live = true;
    setBusy(true);
    setError(null);
    setData(null);
    search(query)
      .then((response) => {
        if (!live) return;
        setData(response);
        // `path` is load-bearing: index and live disagree, so an entry that
        // does not say which answered cannot be judged later.
        onSearched(query, {
          resultCount: response.total,
          path: response.path,
          tookMs: response.tookMs,
          apiCalls: response.apiCalls,
        });
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : "search failed");
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [query, onSearched]);

  return (
    <SearchScreen
      query={draft}
      onQueryChange={setDraft}
      onAsk={onAsk}
      onAddSkill={onAddSkill}
      onManageSkills={onManageSkills}
      onSubmit={(raw) => {
        // An event handler forwarding its MouseEvent here fails silently.
        const next = (typeof raw === "string" ? raw : draft).trim();
        if (next) setParams({ q: next });
      }}
      busy={busy}
      error={error}
      data={data}
    />
  );
}

/** Chat, pointed at whichever conversation the path names. */
function ChatRoute({
  turns,
  chats,
  loading,
  chatsLoading,
  runningChatId,
  unseenChats,
  onOpen,
  onAsk,
  onStop,
}: {
  turns: ChatTurn[];
  chats: ChatSummary[];
  runningChatId: string | null;
  unseenChats: Set<string>;
  loading: boolean;
  chatsLoading: boolean;
  onOpen: (id: string | null) => void;
  onAsk: (question: string, skill: string | null) => void;
  onStop: () => void;
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    onOpen(id ?? null);
  }, [id, onOpen]);

  // Home's "Add your own skill" arrives as ?new-skill=1. Consumed on arrival,
  // or it would reopen the pane on every reload and on Back.
  const openSkillPane = params.get("new-skill") === "1";
  useEffect(() => {
    if (!openSkillPane) return;
    const next = new URLSearchParams(params);
    next.delete("new-skill");
    setParams(next, { replace: true });
  }, [openSkillPane, params, setParams]);

  return (
    <ChatScreen
      openSkillPane={openSkillPane}
      turns={turns}
      chats={chats}
      runningChatId={runningChatId}
      unseenChats={unseenChats}
      activeId={id ?? null}
      loading={loading}
      chatsLoading={chatsLoading}
      onStop={onStop}
      onAsk={onAsk}
      onManageSkills={() => navigate("/skills")}
      onNewChat={() => navigate("/chat")}
      onSelectChat={(next) => navigate(`/chat/${next}`)}
    />
  );
}
