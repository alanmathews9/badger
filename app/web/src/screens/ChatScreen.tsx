import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { ChatSummary } from "@/lib/history";
import { fetchAgents, fetchSkills, type AgentInfo, type SkillInfo } from "@/lib/ask";
import { Composer } from "@/components/chat/Composer";
import { SkillPane } from "@/components/chat/SkillPane";
import { TurnBlock, type ChatTurn } from "@/components/chat/TurnBlock";
import { AgentMark } from "@/components/agents/icons";

export type { ChatTurn };

/**
 * Ways in, for someone who has frozen at an empty box.
 *
 * Each shows something a single source cannot do: three sources disagreeing
 * about one delay, an answer that is mail-only, and a question that fires the
 * find-expert skill.
 *
 * THESE ROT AND NOTHING WILL TELL YOU — they are covered by no test, and an
 * earlier set named a company deleted from the corpus, so the first thing a
 * visitor saw was three questions returning nothing. Check them whenever the
 * corpus changes.
 */
const OPENERS = [
  "Why was the Android app five weeks late?",
  "Did we tell Brightsmile the app would be ready in March?",
  "Who should I ask about the offline sync layer?",
];

/**
 * The conversation screen: a history pane of past chats, the thread itself,
 * and the composer.
 *
 * Layout and wiring only; everything with its own behaviour lives in
 * `components/chat/`.
 */
export function ChatScreen({
  turns,
  chats,
  runningChatId,
  unseenChats,
  activeId,
  loading,
  chatsLoading,
  onAsk,
  onStop,
  onNewChat,
  onSelectChat,
  onManageSkills,
  openSkillPane = false,
  agent = null,
  heading = "What do you want to know?",
  paneTitle = "Chats",
  openers = OPENERS,
  agentColor,
  fill = false,
}: {
  turns: ChatTurn[];
  chats: ChatSummary[];
  /** The conversation being answered right now, if any. */
  runningChatId: string | null;
  /** Finished while the reader was elsewhere, and not opened since. */
  unseenChats: Set<string>;
  activeId: string | null;
  /** A past conversation is being fetched — see `openChat` in App. */
  loading: boolean;
  /** The list of past conversations has not arrived yet. */
  chatsLoading: boolean;
  onAsk: (next: string, skill: string | null, agent: string | null) => void;
  /** Abort the run in flight. */
  onStop: () => void;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  /** Leave for the manage-skills page. */
  onManageSkills: () => void;
  /** Arrive with the add-skill pane already open — the handover from Home's
      picker, where the pane does not exist. */
  openSkillPane?: boolean;
  /**
   * Every question here runs as this sub-agent, decided by the screen rather
   * than per message. Set on an agent's Playground; null in /chat.
   */
  agent?: string | null;
  /** The line above an empty conversation. */
  heading?: string;
  /** What the history pane calls itself. */
  paneTitle?: string;
  /** Ways in for an empty box. None on a Playground — see OPENERS. */
  openers?: string[];
  /** The agent's colour, drawn in place of Badger's mark wherever it would be. */
  agentColor?: string;
  /**
   * Fill the parent instead of the viewport. A Playground sits under an
   * agent's page header, so `h-dvh` there would push the composer off screen
   * by exactly the height of that header.
   */
  fill?: boolean;
}) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [paneOpen, setPaneOpen] = useState(openSkillPane);
  const [pending, setPending] = useState<string | null>(null);
  /** A suggestion waiting to be dropped into the box — never sent from here. */
  const [prefill, setPrefill] = useState<string | null>(null);

  useEffect(() => {
    // Neither list is offered on a Playground: the agent is already chosen,
    // and the skills it can reach are its own rather than Badger's.
    if (agent) return;
    fetchSkills().then(setSkills).catch(() => {});
    fetchAgents().then(setAgents).catch(() => {});
  }, [agent]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const last = turns.at(-1);
  const running = last?.answer.running ?? false;

  // Follow the stream: new turns, new steps and new text all pull the view
  // down. Steps count now because the trail grows during a run — without
  // them the newest step scrolls out of sight while the reader waits.
  const stepCount = last?.answer.steps.length ?? 0;
  const textLength = last?.answer.text.length ?? 0;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, stepCount, textLength]);

  // Follow-up chips: opened and not cited, offered as the next question — but
  // only under a name a person could have said themselves. Mail and Drive are
  // opened by opaque id, and an unresolved id would read as "What was in
  // 19ec95436f796f88?". Kind-blind, so a commit or blob digest is dropped too.
  // The honesty count still includes them: they really were opened.
  const isOpaque = (ref: string) => /^[0-9a-f]{12,}$/i.test(ref);
  const uncited = !running
    ? (last?.answer.result?.uncited ?? []).filter(
        (item) => !isOpaque(item.label) && !(isOpaque(item.ref) && item.label === item.ref),
      )
    : [];

  return (
    <div className={`flex ${fill ? "h-full" : "h-dvh"} bg-white text-stone-900`}>
      {/* ── Past chats ─────────────────────────────────────────────── */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-stone-200 bg-stone-50/50">
        <div className="px-4 pt-3.5 text-[11px] font-medium tracking-[0.08em] text-stone-400 uppercase">
          {paneTitle}
        </div>
        <div className="p-3">
          <button
            onClick={onNewChat}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white text-[12.5px] font-medium text-stone-700 hover:bg-stone-50"
          >
            <Plus className="size-3.5" strokeWidth={2} />
            New chat
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {chatsLoading ? (
            /* Rows of the right shape and varied width, so the pane does not
               resize when the real titles land. "No chats yet" used to show
               here, which was an assertion the app had no way to support. */
            <div className="flex animate-pulse flex-col gap-1 px-2.5 pt-1">
              {[80, 62, 71, 55].map((w, i) => (
                <div key={i} className="h-4 rounded bg-stone-200/70" style={{ width: `${w}%` }} />
              ))}
            </div>
          ) : chats.length === 0 ? (
            <p className="px-2 pt-1 text-[11.5px] text-stone-400">No chats yet</p>
          ) : (
            chats.map((c) => {
              // Amber while it is being answered, green when it finished
              // somewhere the reader was not looking. The dot sits in a fixed
              // 1.5-unit column that is always there, so a title never
              // reflows or re-truncates when the state changes under it.
              const state = c.id === runningChatId ? "running" : unseenChats.has(c.id) ? "done" : null;
              return (
                <button
                  key={c.id}
                  onClick={() => onSelectChat(c.id)}
                  title={
                    state === "running"
                      ? "Answering…"
                      : state === "done"
                        ? "Finished — not opened yet"
                        : c.title
                  }
                  className={
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] " +
                    (c.id === activeId
                      ? "bg-stone-200/70 text-stone-900"
                      : "text-stone-600 hover:bg-stone-100")
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="flex size-1.5 shrink-0 items-center justify-center">
                    {state === "running" ? (
                      <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                    ) : state === "done" ? (
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ── The thread ─────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {turns.length === 0 && !loading ? (
          /* The empty state centres the composer, and the composer is the only
             one on screen — it is not the bottom bar moved up, it is rendered
             here instead. Once a question is asked the thread appears and the
             composer returns to the bottom, which is the shape every chat
             product settles on: an empty box invites, a full thread anchors.

             Remounting the composer across that switch is deliberate and
             harmless: submitting already clears the draft and the picked
             skill, so there is no state worth carrying over. */
          <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
            {/* Nudged down so the COMPOSER sits on the true vertical centre,
                not the block as a whole. Three suggestion rows below outweigh
                one heading row above by roughly 60px, so centring the block
                leaves the box visibly high — which is what the eye reads,
                because the box is the thing you are about to use. Half the
                difference, applied here. */}
            <div className="w-full max-w-[720px] translate-y-[30px]">
              <div className="mb-8 flex items-center justify-center gap-3.5">
                {/* The mark alone, in ink, at the same weight as the words it
                    sits beside. It was a small dark app-tile stacked above the
                    heading; a tile is a favicon's job, and stacking put two
                    centred things where one line reads better. */}
                {agent ? (
                  <AgentMark color={agentColor} size={34} />
                ) : (
                  <img src="/mark.svg" alt="" aria-hidden="true" className="h-8 w-auto" />
                )}
                <h1 className="text-[30px]/[1.2] font-semibold tracking-[-0.025em]">{heading}</h1>
              </div>

              <Composer
                skills={skills}
                agents={agents}
                plain={!!agent}
                running={false}
                preset={pending}
                prefill={prefill}
                onSubmit={onAsk}
                onStop={onStop}
                onAddSkill={() => setPaneOpen(true)}
                onManageSkills={onManageSkills}
                onPresetUsed={() => setPending(null)}
                onPrefillUsed={() => setPrefill(null)}
              />

              {/* Quiet text rather than three outlined boxes. They are a way
                  in for someone who has frozen at an empty box, not three
                  buttons competing with the composer above them. */}
              <div className="mt-8 flex flex-col items-center gap-1">
                {openers.map((q) => (
                  <button
                    key={q}
                    onClick={() => setPrefill(q)}
                    className="rounded-md px-2.5 py-1.5 text-[13.5px] text-stone-500 transition-colors hover:bg-stone-50 hover:text-stone-900"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </main>
        ) : (
          <>
            <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-7">
              <div className="mx-auto max-w-[720px] pb-10">
                {loading ? (
                  <ChatSkeleton />
                ) : (
                  turns.map((turn, i) => (
                    <TurnBlock key={i} turn={turn} agentColor={agent ? agentColor : undefined} />
                  ))
                )}
                <div ref={bottomRef} />
              </div>
            </main>

            <div className="shrink-0 border-t border-stone-100 px-6 pt-4 pb-5">
              {uncited.length > 0 && (
                <div className="mx-auto mb-2.5 flex max-w-[720px] flex-wrap gap-1.5">
                  {uncited.slice(0, 3).map((item) => (
                    <button
                      key={item.kind + item.ref}
                      onClick={() => setPrefill(`Tell me about ${item.label}`)}
                      className="inline-flex h-7 items-center rounded-full border border-stone-200 bg-white px-3 text-xs text-stone-700 hover:bg-stone-50"
                    >
                      What was in {item.label}?
                    </button>
                  ))}
                </div>
              )}
              <Composer
                skills={skills}
                agents={agents}
                plain={!!agent}
                running={running}
                // Submitting under the loading skeleton kept the id being
                // loaded while discarding its turns, so the one new turn was
                // saved over the conversation just clicked. `busy` blocks that
                // without pretending there is a run to stop.
                busy={loading}
                preset={pending}
                prefill={prefill}
                onSubmit={onAsk}
                onStop={onStop}
                onAddSkill={() => setPaneOpen(true)}
                onManageSkills={onManageSkills}
                onPresetUsed={() => setPending(null)}
                onPrefillUsed={() => setPrefill(null)}
              />
            </div>
          </>
        )}
      </div>

      {paneOpen && !agent && (
        <>
          <div className="fixed inset-0 z-10 bg-stone-900/25" onClick={() => setPaneOpen(false)} />
          <SkillPane
            onClose={(slug) => {
              setPaneOpen(false);
              fetchSkills().then(setSkills).catch(() => {});
              setPending(slug);
            }}
          />
        </>
      )}
    </div>
  );
}

/**
 * The conversation, before it arrives.
 *
 * Shaped like a turn rather than drawn as a spinner: a bubble on the right, a
 * trail line, and three lines of answer. The point is that the layout does not
 * jump when the real content lands — a centred spinner would be replaced by
 * something a completely different size, which is its own small flinch.
 *
 * Deliberately only ONE turn, even though most conversations have several.
 * Guessing the length would mean the page shrinks or grows on arrival; one
 * turn is the honest floor, since a stored conversation always has at least
 * that.
 */
function ChatSkeleton() {
  return (
    <div className="animate-pulse pt-1" aria-hidden="true">
      <div className="flex justify-end">
        <div className="h-[42px] w-[62%] rounded-2xl bg-stone-100" />
      </div>
      <div className="mt-5 h-3 w-44 rounded bg-stone-100" />
      <div className="mt-6 flex flex-col gap-2.5">
        <div className="h-3.5 w-full rounded bg-stone-100" />
        <div className="h-3.5 w-full rounded bg-stone-100" />
        <div className="h-3.5 w-[72%] rounded bg-stone-100" />
      </div>
      <div className="mt-7 flex gap-3">
        <div className="h-3 w-16 rounded bg-stone-100" />
        <div className="h-3 w-32 rounded bg-stone-100" />
        <div className="h-3 w-28 rounded bg-stone-100" />
      </div>
    </div>
  );
}
