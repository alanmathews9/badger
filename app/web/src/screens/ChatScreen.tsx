import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { ChatSummary } from "@/lib/history";
import { fetchSkills, type SkillInfo } from "@/lib/ask";
import { Composer } from "@/components/chat/Composer";
import { SkillPane } from "@/components/chat/SkillPane";
import { TurnBlock, type ChatTurn } from "@/components/chat/TurnBlock";

export type { ChatTurn };

/**
 * Ways in, for someone who has frozen at an empty box.
 *
 * Each one is chosen to show something a single source cannot do: the first
 * returns three sources telling three different stories about the same delay,
 * the second is answerable from mail alone, and the third fires the
 * find-expert skill and has to weigh commits against who gets deferred to in
 * a thread.
 *
 * **These rot, and nothing here will tell you.** The Search screen carried an
 * equivalent set that named a consultancy deleted from the corpus, so the
 * first thing a visitor saw was three questions returning nothing — rendered
 * perfectly, covered by no test. Check them whenever the corpus changes.
 *
 * The durable version is Onyx's: starter messages live per-agent in the
 * database (`persona.starter_messages`) and the component renders nothing
 * when there are none, so a stale set is a config edit rather than a code
 * edit and an empty one degrades to a clean screen. Worth doing; not done.
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
 * This file used to be 743 lines and held the trail, the turn, the citation
 * rendering, the composer, the skill menu and the add-skill pane as well. It
 * is now the layout and the wiring; everything with its own behaviour lives
 * in `components/chat/`. That is not tidiness for its own sake — the trail
 * and the turn are the two pieces this revamp changed most, and neither could
 * be read without scrolling past the other.
 */
export function ChatScreen({
  turns,
  chats,
  activeId,
  loading,
  chatsLoading,
  onAsk,
  onStop,
  onNewChat,
  onSelectChat,
  openSkillPane = false,
}: {
  turns: ChatTurn[];
  chats: ChatSummary[];
  activeId: string | null;
  /** A past conversation is being fetched — see `openChat` in App. */
  loading: boolean;
  /** The list of past conversations has not arrived yet. */
  chatsLoading: boolean;
  onAsk: (next: string, skill: string | null) => void;
  /** Abort the run in flight. */
  onStop: () => void;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  /** Arrive with the add-skill pane already open — the handover from Home's
      picker, where the pane does not exist. */
  openSkillPane?: boolean;
}) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [paneOpen, setPaneOpen] = useState(openSkillPane);
  const [pending, setPending] = useState<string | null>(null);
  /** A suggestion waiting to be dropped into the box — never sent from here. */
  const [prefill, setPrefill] = useState<string | null>(null);

  useEffect(() => {
    fetchSkills().then(setSkills).catch(() => {});
  }, []);

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

  const uncited = !running ? (last?.answer.result?.uncited ?? []) : [];

  return (
    <div className="flex h-dvh bg-white text-stone-900">
      {/* ── Past chats ─────────────────────────────────────────────── */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-stone-200 bg-stone-50/50">
        <div className="px-4 pt-3.5 text-[11px] font-medium tracking-[0.08em] text-stone-400 uppercase">
          Chats
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
            chats.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelectChat(c.id)}
                className={
                  "block w-full truncate rounded-md px-2.5 py-1.5 text-left text-[12.5px] " +
                  (c.id === activeId
                    ? "bg-stone-200/70 text-stone-900"
                    : "text-stone-600 hover:bg-stone-100")
                }
              >
                {c.title}
              </button>
            ))
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
                <img src="/mark.svg" alt="" aria-hidden="true" className="h-8 w-auto" />
                <h1 className="text-[30px]/[1.2] font-semibold tracking-[-0.025em]">
                  What do you want to know?
                </h1>
              </div>

              <Composer
                skills={skills}
                running={false}
                preset={pending}
                prefill={prefill}
                onSubmit={onAsk}
                onStop={onStop}
                onAddSkill={() => setPaneOpen(true)}
                onPresetUsed={() => setPending(null)}
                onPrefillUsed={() => setPrefill(null)}
              />

              {/* Quiet text rather than three outlined boxes. They are a way
                  in for someone who has frozen at an empty box, not three
                  buttons competing with the composer above them. */}
              <div className="mt-8 flex flex-col items-center gap-1">
                {OPENERS.map((q) => (
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
                  turns.map((turn, i) => <TurnBlock key={i} turn={turn} />)
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
                running={running}
                preset={pending}
                prefill={prefill}
                onSubmit={onAsk}
                onStop={onStop}
                onAddSkill={() => setPaneOpen(true)}
                onPresetUsed={() => setPending(null)}
                onPrefillUsed={() => setPrefill(null)}
              />
            </div>
          </>
        )}
      </div>

      {paneOpen && (
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
