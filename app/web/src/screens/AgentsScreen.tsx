import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Copy, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { AgentMark } from "@/components/agents/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNavigate } from "react-router-dom";
import { fetchAgents, removeAgent, type AgentInfo } from "@/lib/ask";

/**
 * Every sub-agent Badger can hand a question to, as cards.
 *
 * Each card is a real folder under `agents/<slug>/` in the agent's own git
 * repository, holding its own agent.yaml, SOUL.md, tools and skills.
 *
 * DELIBERATELY SPARSE — a name and when it was made, and nothing else. No
 * role line, no tool count, no description. This screen is for choosing an
 * agent, not for reading about one; everything else is on the agent's own
 * page, one click away.
 *
 * Clicking a card opens its Playground, because the common thing to do with
 * an agent is talk to it. Edit, on the menu, opens Build.
 */
export function AgentsScreen() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  /** The agent a delete has been offered for, and not yet answered. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchAgents()
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);
  useEffect(load, [load]);

  const remove = async (slug: string) => {
    setConfirming(null);
    await removeAgent(slug);
    load();
  };

  return (
    <div className="flex h-dvh flex-col bg-white">
      {/* The same header and page gutters as Tools. Agents used to centre a
          720px column, which on a wide screen left the one card marooned in
          the middle of an empty page with an unexplained margin either side.
          A grid that starts at the left gutter and fills rightwards has the
          same shape at one card and at twenty. */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 px-6">
        <h1 className="text-[15px] font-semibold">Agents</h1>
        <button
          onClick={() => navigate("/agents/new")}
          className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-stone-900 px-3 text-[12.5px] font-medium text-stone-50"
        >
          <Plus className="size-3.5" strokeWidth={2.2} />
          New agent
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {agents === null ? (
          <div className="grid animate-pulse gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[164px] rounded-xl border border-stone-200 bg-stone-50" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-stone-200 px-6 py-16 text-center">
            <Bot className="size-6 text-stone-300" strokeWidth={1.6} />
            <p className="mt-3 text-[14px] font-medium text-stone-800">No agents yet</p>
            <p className="mt-1 max-w-[380px] text-[12.5px]/[1.6] text-stone-500">
              An agent answers in Badger's place, with its own instructions and only the tools you
              give it.
            </p>
            <button
              onClick={() => navigate("/agents/new")}
              className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-stone-900 px-3 text-[12.5px] font-medium text-stone-50"
            >
              <Plus className="size-3.5" strokeWidth={2.2} />
              New agent
            </button>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((a) => (
              <li key={a.slug} className="relative">
                {/* Stacked: mark, name, what it is for, when it last changed.
                    The name carries the weight because it is what you came to
                    the page to pick, and the role is clamped to two lines — it
                    is one sentence by construction, and a card that grows with
                    it would break the grid's rhythm. */}
                <button
                  onClick={() => navigate(`/agents/${a.slug}/play`)}
                  className="flex h-[164px] w-full flex-col items-start rounded-xl border border-stone-200 bg-white p-4 text-left transition-colors hover:border-stone-300 hover:bg-stone-50"
                >
                  <AgentMark color={a.color} size={30} />
                  <span className="mt-3 w-full truncate pr-7 font-mono text-[14px] font-semibold">
                    {a.slug}
                  </span>
                  <p className="mt-1.5 line-clamp-2 text-[12.5px]/[1.6] text-stone-600">
                    {a.role || a.goal}
                  </p>
                  {/* At the foot of the card, and relative. When an agent was
                      MADE stops mattering the moment you edit it; how long ago
                      it last changed is what you scan a list of agents for.
                      The absolute date rides in the tooltip, since that is what
                      "3 hours ago" hides. */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="mt-auto cursor-default text-[11.5px] text-stone-400">
                        {relativeLabel(a.updatedAt)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={6}>
                      Last updated: {relativeLabel(a.updatedAt)} ({exactLabel(a.updatedAt)})
                    </TooltipContent>
                  </Tooltip>
                </button>

                <CardMenu
                  onEdit={() => navigate(`/agents/${a.slug}/build`)}
                  onClone={() => navigate(`/agents/new?from=${encodeURIComponent(a.slug)}`)}
                  onDelete={() => setConfirming(a.slug)}
                />
              </li>
            ))}
          </ul>
        )}
      </main>

      {confirming && (
        <>
          <div className="fixed inset-0 z-20 bg-stone-900/25" onClick={() => setConfirming(null)} />
          <div className="fixed top-1/2 left-1/2 z-30 w-[min(420px,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200 bg-white p-5 shadow-xl">
            <p className="text-[13.5px] font-medium text-stone-900">
              Delete <span className="font-mono">{confirming}</span>?
            </p>
            <p className="mt-1.5 text-[12.5px]/[1.6] text-stone-500">
              The folder is removed from the agent's repository.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => remove(confirming)}
                className="inline-flex h-9 items-center justify-center rounded-md bg-red-700 px-4 text-[13px] font-medium text-white hover:bg-red-800"
              >
                Delete agent
              </button>
              <button
                onClick={() => setConfirming(null)}
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

/** Steps for "3 hours ago", largest first. */
const SPANS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/**
 * How long ago, in words.
 *
 * `Intl.RelativeTimeFormat` rather than a hand-rolled table: it is in every
 * browser this app runs in, and it gets the plurals and the reader's own
 * language right for free.
 */
function relativeLabel(at: string): string {
  if (!at) return "";
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return "";

  const seconds = Math.round((then - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of SPANS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/** The date behind the relative one. Shown on hover, where there is room. */
function exactLabel(at: string): string {
  if (!at) return "";
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The three things you can do to an agent without opening it. */
function CardMenu({
  onEdit,
  onClone,
  onDelete,
}: {
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={box} className="absolute top-2.5 right-2.5">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Agent options"
        className="inline-flex size-7 items-center justify-center rounded-md text-stone-400 hover:bg-stone-200/60 hover:text-stone-900"
      >
        <MoreHorizontal className="size-4" strokeWidth={2} />
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-[160px] overflow-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
          <MenuItem icon={<Pencil className="size-3.5" strokeWidth={2} />} onClick={pick(onEdit)}>
            Edit
          </MenuItem>
          <MenuItem icon={<Copy className="size-3.5" strokeWidth={2} />} onClick={pick(onClone)}>
            Clone agent
          </MenuItem>
          <MenuItem
            danger
            icon={<Trash2 className="size-3.5" strokeWidth={2} />}
            onClick={pick(onDelete)}
          >
            Delete agent
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  danger = false,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] hover:bg-stone-50 " +
        (danger ? "text-red-700" : "text-stone-700")
      }
    >
      {icon}
      {children}
    </button>
  );
}
