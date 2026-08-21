import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Hammer, MoreHorizontal, Play, Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { AgentForm, useAgentDraft } from "@/components/agents/AgentPane";
import { ChatScreen, type ChatTurn } from "@/screens/ChatScreen";
import type { ChatSummary } from "@/lib/history";

/** What a name may be, applied while typing so "Support Badger" lands as a slug. */
export const asSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40);

/** Everything the Playground tab hands down to the chat screen. */
export type PlaygroundProps = {
  turns: ChatTurn[];
  chats: ChatSummary[];
  loading: boolean;
  chatsLoading: boolean;
  runningChatId: string | null;
  unseenChats: Set<string>;
  activeId: string | null;
  onAsk: (question: string) => void;
  onStop: () => void;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
};

/**
 * One agent, on the whole screen.
 *
 * Two tabs, because an agent is two things at once: a definition you write,
 * and something you talk to. Build is the editor; Playground is a normal
 * conversation that always runs as this agent.
 *
 * The name lives in the HEADER and is edited there. It is the agent's title
 * everywhere else on this page, and a second copy of it inside the form could
 * disagree with the one above it. Renaming is a real move on disk — the
 * runtime keys an agent by its directory — so the whole folder travels,
 * memory and all, and the Playground's conversations follow it.
 */
export function AgentScreen({
  slug,
  cloneFrom,
  tab = "build",
  playground,
}: {
  /** The agent being shown. Absent is the new-agent page. */
  slug?: string;
  /** Start from another agent's definition. New agents only. */
  cloneFrom?: string;
  tab?: "build" | "play";
  playground?: PlaygroundProps;
}) {
  const navigate = useNavigate();
  const isNew = !slug;

  // The name is a slug from the first keystroke, so an invalid one cannot be
  // produced. A clone opens under an obvious derived name.
  const [name, setName] = useState(slug ?? (cloneFrom ? `${cloneFrom}-copy` : "new-agent"));
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isNew) nameRef.current?.select();
  }, [isNew]);

  // A rename lands as a new URL, and the component keeps its state across it —
  // so without this the title would still show the name typed before the save
  // if anything else reset it.
  useEffect(() => {
    if (slug) setName(slug);
  }, [slug]);

  const draft = useAgentDraft({ slug, cloneFrom, name });
  const [confirming, setConfirming] = useState(false);

  const save = async () => {
    const saved = await draft.save();
    if (!saved) return;
    // A create, or a rename, moves the page. Same URL otherwise, so a plain
    // save stays put rather than re-mounting the editor under itself.
    if (saved !== slug) navigate(`/agents/${saved}/build`, { replace: isNew });
  };

  const remove = async () => {
    setConfirming(false);
    if (await draft.remove()) navigate("/agents", { replace: true });
  };

  return (
    <div className="flex h-dvh flex-col bg-white">
      {/* One bar: where you are on the left, which half of the agent you are
          looking at in the middle, and what you can do to it on the right.
          The tabs are absolutely centred rather than laid out between the two
          — the breadcrumb and the actions are different widths, so a flex
          centre would put the tabs slightly off centre and move them every
          time the name got longer. */}
      <header className="relative flex h-14 shrink-0 items-center gap-1.5 border-b border-stone-100 px-4">
        <Link
          to="/agents"
          className="shrink-0 rounded-md px-1.5 py-1 text-[13.5px] text-stone-500 hover:bg-stone-100 hover:text-stone-900"
        >
          Agents
        </Link>
        <ChevronRight className="size-3.5 shrink-0 text-stone-300" strokeWidth={2.2} />

        {/* The title IS the name field, on a new agent and an existing one
            alike. At rest it is just the name; hovering outlines it and
            focusing makes it an ordinary input, so it reads as editable
            without a filled box sitting in the breadcrumb all the time.

            Width follows the text. The face is monospaced, so `ch` is exact
            and the field never leaves a run of empty box after a short name. */}
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(asSlug(e.target.value))}
          spellCheck={false}
          aria-label="Agent name"
          style={{ width: `${Math.max(name.length, 8) + 2}ch` }}
          className="min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-1 font-mono text-[13.5px] font-medium hover:border-stone-200 focus:border-stone-300 focus:outline-none"
        />

        {/* A segmented control, not two buttons: the two tabs sit inside one
            recessed track and the active one is the raised tile in it. Same
            shape as shadcn's Tabs — but LINKS rather than a Tabs root, because
            these are URLs. The router owns which panel is showing, and a Tabs
            root would be a second copy of that state able to disagree with the
            address bar. */}
        {!isNew && (
          <nav
            aria-label="Agent view"
            className="absolute left-1/2 inline-flex h-9 -translate-x-1/2 items-center gap-1 rounded-lg bg-stone-100 p-1"
          >
            <Tab to={`/agents/${slug}/build`} active={tab === "build"} icon={<Hammer className="size-3.5" strokeWidth={2} />}>
              Build
            </Tab>
            <Tab to={`/agents/${slug}/play`} active={tab === "play"} icon={<Play className="size-3.5" strokeWidth={2} />}>
              Playground
            </Tab>
          </nav>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {!isNew && <HeaderMenu onDelete={() => setConfirming(true)} />}
          {tab === "build" && (
            <button
              onClick={save}
              disabled={!draft.savable}
              className="inline-flex h-8 items-center justify-center rounded-lg bg-stone-900 px-3.5 text-[12.5px] font-medium text-stone-50 disabled:opacity-30"
            >
              {draft.busy ? "Saving…" : isNew ? "Create agent" : "Save changes"}
            </button>
          )}
        </div>
      </header>

      {draft.error && (
        <p className="shrink-0 border-b border-amber-100 bg-amber-50 px-6 py-2 text-[12px] text-amber-800">
          {draft.error}
        </p>
      )}

      {tab === "play" && playground ? (
        <div className="min-h-0 flex-1">
          <ChatScreen
            fill
            agent={slug ?? null}
            agentColor={draft.spec.color}
            heading={`Welcome to ${name}`}
            paneTitle="Sessions"
            openers={[]}
            turns={playground.turns}
            chats={playground.chats}
            loading={playground.loading}
            chatsLoading={playground.chatsLoading}
            runningChatId={playground.runningChatId}
            unseenChats={playground.unseenChats}
            activeId={playground.activeId}
            onAsk={(question) => playground.onAsk(question)}
            onStop={playground.onStop}
            onNewChat={playground.onNewChat}
            onSelectChat={playground.onSelectChat}
            onManageSkills={() => navigate("/skills")}
          />
        </div>
      ) : (
        <AgentForm draft={draft} />
      )}

      {confirming && (
        <>
          <div className="fixed inset-0 z-20 bg-stone-900/25" onClick={() => setConfirming(false)} />
          <div className="fixed top-1/2 left-1/2 z-30 w-[min(420px,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200 bg-white p-5 shadow-xl">
            <p className="text-[13.5px] font-medium text-stone-900">
              Delete <span className="font-mono">{slug}</span>?
            </p>
            <p className="mt-1.5 text-[12.5px]/[1.6] text-stone-500">
              The folder is removed from the agent's repository.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={remove}
                disabled={draft.busy}
                className="inline-flex h-9 items-center justify-center rounded-md bg-red-700 px-4 text-[13px] font-medium text-white hover:bg-red-800 disabled:opacity-40"
              >
                {draft.busy ? "Deleting…" : "Delete agent"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="text-[12.5px] text-stone-500 hover:text-stone-900"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Everything that is not Save. One item today, and Delete is destructive. */
function HeaderMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Agent options"
        className="inline-flex size-8 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-900"
      >
        <MoreHorizontal className="size-4" strokeWidth={2} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-[160px] overflow-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
          <button
            onClick={() => {
              close();
              onDelete();
            }}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] text-red-700 hover:bg-stone-50"
          >
            <Trash2 className="size-3.5" strokeWidth={2} />
            Delete agent
          </button>
        </div>
      )}
    </div>
  );
}

function Tab({
  to,
  active,
  icon,
  children,
}: {
  to: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={
        "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors " +
        (active
          ? "bg-white text-stone-900 shadow-sm"
          : "text-stone-500 hover:text-stone-900")
      }
    >
      <span className={active ? "text-stone-700" : "text-stone-400"}>{icon}</span>
      {children}
    </Link>
  );
}
