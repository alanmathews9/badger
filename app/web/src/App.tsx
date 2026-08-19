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
 * **Those destinations are URLs now, not `useState`.** They were a `mode`
 * string held in this component, which meant the address bar said `/` no
 * matter where you were: a reload dropped you back on Search, the back button
 * left the app entirely, and a conversation could not be linked to at all.
 * Onyx keeps the chat id in the URL for the same reason — their
 * `services/searchParams.ts` names `chatId` and `searchId` as first-class
 * params. The server has always been ready for this; `serveStatic` falls back
 * to index.html so any path serves the app.
 *
 *   /search        the box, empty
 *   /search?q=…    results for a query
 *   /chat          a new conversation
 *   /chat/:id      one conversation, linkable and reloadable
 *   /tools         what Badger can reach
 *
 * A reloaded `/search?q=…` **re-runs the search** rather than restoring stored
 * results. That is Onyx's rule too, and their `search_query` table says why in
 * a comment: less is stored "because the reply functionality is simply to
 * rerun the search query again as things may have changed". Retrieval costs no
 * model call, so re-running is cheap and never stale.
 *
 * **A Dig does not start the agent.** It did — the answer began writing itself
 * above the results on every search — and it was the wrong default three times
 * over: it spent a model call and a slot from the daily answer budget on every
 * search including the ones that were a lookup, it put fifteen seconds of
 * streaming above a list already complete in one, and it made the two halves
 * impossible to judge separately. Search is retrieval; Chat is the agent.
 */
export default function App() {
  const navigate = useNavigate();

  const [sources, setSources] = useState<SourcesResponse>({ mode: "none", sources: [] });
  const [budget, setBudget] = useState<Budget | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  // The chat list is a Postgres round trip like everything else in history,
  // so there is a real gap before it arrives. Without this the pane asserted
  // "No chats yet" during every load — the confidently-wrong indicator this
  // project keeps finding, and wrong for anyone who has chats.
  const [chatsLoading, setChatsLoading] = useState(true);
  const [searches, setSearches] = useState<SearchEntry[]>([]);

  // The run lives above the routes on purpose: switching to Search mid-answer
  // must not cancel it. Only starting another question does that.
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const cancelAsk = useRef<(() => void) | null>(null);

  // A conversation is being fetched. See `openChat` — the store is Postgres.
  const [loadingChat, setLoadingChat] = useState(false);
  const loadToken = useRef(0);

  // The id is also read inside callbacks that must not be rebuilt on every
  // change — a route effect that fires whenever its handler's identity moves
  // would reload the conversation mid-stream.
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
   * Without this, opening a chat wrote it straight back: loading set `turns`,
   * the effect below saw turns change, and saved with a fresh `updatedAt` —
   * so clicking any conversation in the history jumped it to the top of the
   * list. Reading is not writing, and the list orders by when a conversation
   * was last *used*.
   */
  const dirty = useRef(false);

  // Persist a conversation whenever a turn finishes. Running turns are skipped
  // — a half-streamed answer is not worth restoring.
  useEffect(() => {
    if (!dirty.current) return;
    if (!activeChatId || turns.length === 0) return;
    if (turns[turns.length - 1].answer.running) return;
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

      // The first question in a new conversation mints its id and puts it in
      // the address bar, so the answer being written is already linkable.
      // `replace`, not `push`: /chat and /chat/<id> are the same conversation,
      // and back should leave it rather than land on an empty composer.
      if (!activeIdRef.current) {
        const id = newChatId();
        setActive(id);
        navigate(`/chat/${id}`, { replace: true });
      }

      // The conversation so far, as plain text. The server strips the model's
      // Sources/Coverage boilerplate and enforces its own budget; a turn that
      // errored has nothing to contribute and is left out.
      // `fresh` means "this is the first question of a new conversation", which
      // is what a question asked from the search home is. It exists because
      // `turns` here is a closure over the PREVIOUS conversation: the caller
      // clears it with openChat(null) in the same tick, and the functional
      // setTurns below sees that, but this array does not. Without the flag a
      // question asked from Home would silently carry the last conversation's
      // history into the prompt.
      const priorTurns: Turn[] = (fresh ? [] : turns)
        .map((t) => ({ question: t.question, answer: t.answer.result?.answer ?? t.answer.text }))
        .filter((t) => t.answer.trim().length > 0);

      // A hand-picked skill opens the trail as its own step, because the one
      // thing the runtime cannot tell us — which skill is in play — is known
      // here for certain: the user chose it.
      const seed = skill
        ? [{ name: "skill", args: { skill } }]
        : [];

      setTurns((ts) => [...ts, { question, answer: { ...IDLE, running: true, steps: seed } }]);

      cancelAsk.current = ask(
        question,
        {
          onTool: (name, args, index) => {
            // Bookkeeping the reader does not need — see `isStepVisible`. It
            // is dropped here rather than at render time so nothing downstream
            // has to count around it, and any narration it was carrying stays
            // in `text` to be attached to the next real step instead.
            if (!isStepVisible(name, args)) return;
            // The skill in play can arrive three ways: seeded here when you
            // picked it, announced by the server when it chose one, or as the
            // model reading a SKILL.md itself. All three are the same event to
            // a reader, so whichever lands second is dropped.
            const slug =
              name === "skill" ? String(args.skill ?? "") || null : skillFromRead(args);
            // Text written BEFORE a tool call is the model narrating its plan,
            // not the answer — it kept working after writing it. The runtime
            // streams both through one channel, so a tool call is the signal
            // that moves it out of the answer area.
            //
            // MOVED, not deleted. Clearing it outright was the earlier fix and
            // it caused a worse bug: a model that wrote prose and then called
            // one more tool had that prose disappear from the screen, so the
            // answer looked like it arrived, vanished, and arrived again.
            // Attaching it to the step it was explaining keeps the answer area
            // clean and loses nothing.
            patchLast((s) => {
              if (slug && s.steps.some((step) => step.args.skill === slug)) return s;
              return {
                ...s,
                text: "",
                steps: [
                  ...s.steps,
                  {
                    name,
                    // A skill read is recorded under the skill's own slug so
                    // the duplicate check above sees both forms alike.
                    args: slug ? { ...args, skill: slug } : args,
                    index,
                    narration: s.text.trim() || undefined,
                  },
                ],
              };
            });
          },
          // The documents a search found, attached to the step that found
          // them. Matched on the run's own call number rather than on array
          // position, which the hidden steps and the skill row both shift.
          onResults: (index, results) =>
            patchLast((s) => ({
              ...s,
              steps: s.steps.map((step) => (step.index === index ? { ...step, found: results } : step)),
            })),
          onDelta: (text) => patchLast((s) => ({ ...s, text: s.text + text })),
          onDone: (result) => {
            patchLast((s) => ({ ...s, running: false, text: result.answer, result }));
            // The budget just moved. Re-read it rather than decrementing a guess.
            fetchBudget().then(setBudget).catch(() => {});
          },
          onError: (message) => patchLast((s) => ({ ...s, running: false, error: message })),
        },
        priorTurns,
        skill,
      );
    },
    [turns, navigate, patchLast, setActive],
  );

  /**
   * Abort the run in flight.
   *
   * Cancelling the fetch is only half of it. `ask`'s canceller marks itself
   * finished and aborts the socket, so no `onError` and no `onDone` ever
   * arrive — which means nothing would clear `running`, and the turn would
   * spin for the rest of the session. The state has to be closed here.
   *
   * It closes as `stopped`, not as an error. The answer area renders nothing
   * while a run is live, so a stopped turn has no answer to show — but an
   * interruption is a choice the reader made, not a fault, and styling it as
   * one puts a warning on screen for something that went exactly as asked.
   */
  const stopAsk = useCallback(() => {
    cancelAsk.current?.();
    cancelAsk.current = null;
    patchLast((s) => (s.running ? { ...s, running: false, stopped: true } : s));
  }, [patchLast]);

  /**
   * Point the conversation state at whatever `/chat/:id` currently names.
   *
   * Deliberately a no-op when the id is already open, which is what keeps a
   * running answer alive: `startAsk` navigates to the id it just minted, and
   * without this guard the route change would immediately reload that
   * conversation from storage and throw away the stream.
   *
   * **The load is visible.** `getChat` is a request to Postgres, not a
   * localStorage read — the store has been server-backed since the database
   * landed — so clicking a past conversation changed the URL and then sat on
   * the previous conversation for a few hundred milliseconds. The address bar
   * said one thing and the screen said another, which reads as a click that
   * did not register.
   */
  const openChat = useCallback(
    async (id: string | null) => {
      if (id === activeIdRef.current) return;
      cancelAsk.current?.();
      dirty.current = false;
      if (!id) {
        setActive(null);
        setTurns([]);
        setLoadingChat(false);
        return;
      }

      // Claim this load. Clicking a second conversation before the first
      // arrives must not let the first one win the race and overwrite it —
      // the two requests can complete in either order.
      const token = ++loadToken.current;
      setActive(id);
      setTurns([]);
      setLoadingChat(true);

      const chat = await history.getChat(id).catch(() => null);
      if (token !== loadToken.current) return;
      setLoadingChat(false);

      // A link to a conversation this browser has never held — someone else's
      // id, or one cleared since. Say so by landing on a new chat rather than
      // showing an empty thread that pretends to be theirs.
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
   * /chat — nothing clears it, because ChatRoute's effect is what opens and
   * closes conversations and it does not run on /search — so without the
   * explicit reset a question typed on Home would append to whatever was last
   * open, minting no new id and appearing halfway down an old thread.
   *
   * `openChat(null)` is safe to call synchronously here: its null branch has
   * no await before `setActive`, which writes `activeIdRef` directly, so
   * `startAsk` sees the cleared id rather than a stale one.
   */
  const askFromHome = useCallback(
    (question: string, skill: string | null) => {
      openChat(null);
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
                // Authoring a skill happens in the pane, which lives on Chat.
                // The param is the handover; ChatScreen opens the pane and
                // strips it, so the URL does not stay in a one-shot state.
                onAddSkill={() => navigate("/chat?new-skill=1")}
                onManageSkills={() => navigate("/skills")}
              />
            }
          />
          <Route
            path="/chat"
            element={<ChatRoute turns={turns} chats={chats} loading={loadingChat} chatsLoading={chatsLoading} onOpen={openChat} onAsk={startAsk} onStop={stopAsk} />}
          />
          <Route
            path="/chat/:id"
            element={<ChatRoute turns={turns} chats={chats} loading={loadingChat} chatsLoading={chatsLoading} onOpen={openChat} onAsk={startAsk} onStop={stopAsk} />}
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
 * The URL is the single source of truth for what has been searched; the box
 * holds a draft, which is a different thing — you can type without having
 * searched. Submitting writes `?q=`, and the effect below is what actually
 * runs it, so a typed search, a suggestion click, a sidebar history item, the
 * back button and a pasted link all take exactly one path.
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
        // Record what the search actually cost, not just that it happened.
        // `path` is the load-bearing one: index and live disagree between
        // refreshes, so a history entry that did not say which answered
        // could not be judged later.
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
        // Guard the argument rather than trusting callers. An event handler
        // that forwards its MouseEvent here fails silently inside React.
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
  onOpen,
  onAsk,
  onStop,
}: {
  turns: ChatTurn[];
  chats: ChatSummary[];
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

  // Home's "Add your own skill" arrives as ?new-skill=1, because the pane
  // lives here. Consumed on arrival: leaving the param in the address bar
  // would reopen the pane on every reload and on the back button.
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
