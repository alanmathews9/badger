import { useEffect, useRef, useState } from "react";
import { MessagesSquare, Search } from "lucide-react";
import { DigInput } from "./DigInput";
import { SkillMenu } from "./chat/SkillMenu";
import {
  fetchAgents,
  fetchSkills,
  parseSkillCommand,
  pickableSkills,
  slashFilter,
  type AgentInfo,
  type SkillInfo,
} from "@/lib/ask";
import { cn } from "@/lib/utils";

export type HomeMode = "search" | "chat";

/**
 * The home box, with its two destinations.
 *
 * Badger has always had both a search and an agent, and the home screen only
 * ever offered one of them: you typed, you got twenty rows, and the way to ask
 * a question instead was to notice Chat in the sidebar and start again. Glean
 * solves this by putting the choice on the box itself — Search and Ask as two
 * tabs over one input — and that is the right place for it, because the choice
 * is about what happens when you press Enter, not about which page you are on.
 *
 * **The two are a tab strip on a panel, not two buttons.** Buttons said
 * "these do something"; tabs say "the thing below belongs to whichever of
 * these is lit", which is exactly the relationship — one box, two
 * destinations. The panel is what gives the tabs an edge to sit on, and the
 * input inside it drops its own heavy border, because a framed box inside a
 * framed panel is one edge too many.
 *
 * **"/" still names a skill**, in chat mode. It is the same picker the chat
 * composer uses and the same three rules behind it — see `lib/ask.ts`, where
 * they live precisely so the two boxes cannot come to disagree about what
 * "/find-expert" means. In search mode a leading slash is just a character:
 * skills are instructions to an agent, and search has no agent to instruct.
 *
 * **The skill hint lives in the tab row, and that is why.** It was a line of
 * text under the box, present in chat and absent in search — so switching tabs
 * grew and shrank the panel and the whole centred column jumped. The tab row
 * is a fixed-height thing that already exists in both modes, so putting the
 * hint at its right end costs no height and nothing moves.
 */
export function HomeBar({
  value,
  onChange,
  onSearch,
  onAsk,
  onAddSkill,
  onManageSkills,
  busy,
}: {
  value: string;
  onChange: (next: string) => void;
  onSearch: () => void;
  /** Start a run and go to the conversation. See `askFromHome` in App. */
  onAsk: (question: string, skill: string | null, agent: string | null) => void;
  /** Author a new skill — which happens in Chat, where the pane lives. */
  onAddSkill: () => void;
  /** Open the manage-skills page. */
  onManageSkills: () => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState<HomeMode>("search");
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [command, setCommand] = useState<string | null>(null);
  /** The picked sub-agent. Menu only, never typed. */
  const [agent, setAgent] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetched here rather than passed down: the skills list is this box's own
  // business and nothing above it reads it. It is a cached GET of a handful of
  // names, so a second caller on Chat costs nothing worth threading state for.
  useEffect(() => {
    fetchSkills().then(setSkills).catch(() => {});
    fetchAgents().then(setAgents).catch(() => {});
  }, []);

  const chat = mode === "chat";
  const filter = chat ? slashFilter(value, command) : null;
  const menuVisible = chat && (menuOpen || filter != null);
  const pickable = pickableSkills(skills, filter ?? "");
  const pickableAgents = chat
    ? agents.filter((a) => a.slug.includes((filter ?? "").toLowerCase()))
    : [];
  const footerAt = pickable.length + pickableAgents.length;
  const rows = footerAt + 2; // + "Add your own skill", "Manage skills"

  useEffect(() => setHi(0), [filter, menuVisible]);

  const pick = (slug: string) => {
    setCommand(slug);
    onChange("");
    setMenuOpen(false);
    inputRef.current?.focus();
  };

  // An agent answers instead of Badger, so it replaces any picked skill.
  const pickAgent = (slug: string) => {
    setAgent(slug);
    setCommand(null);
    onChange("");
    setMenuOpen(false);
    inputRef.current?.focus();
  };

  // Sending to chat is the only path that has to parse: a skill can be picked
  // from the menu or typed as "/slug question", and both have to arrive at the
  // agent as a validated slug plus a question with the slug removed.
  const send = (to: HomeMode) => {
    if (to === "search") {
      if (value.trim()) onSearch();
      return;
    }
    const parsed = parseSkillCommand(value, command, skills);
    if (!parsed) return;
    onChange("");
    setCommand(null);
    setAgent(null);
    onAsk(parsed.question, agent ? null : parsed.skill, agent);
  };

  return (
    <div className="w-full rounded-2xl border border-stone-200/80 bg-stone-100/60 p-2">
      <div className="flex items-center gap-0.5 px-1.5">
        <Tab active={!chat} onClick={() => setMode("search")} icon={<Search className="size-3.5" strokeWidth={2} />}>
          Search
        </Tab>
        <Tab active={chat} onClick={() => setMode("chat")} icon={<MessagesSquare className="size-3.5" strokeWidth={2} />}>
          Ask
        </Tab>

        {/* Only in chat, but the row's height does not depend on it — see the
            note above about the panel jumping. */}
        <div className="ml-auto pr-1 text-[11.5px] text-stone-400">
          {chat && (
            <>
              Type <span className="font-mono text-stone-500">/</span> for skills
            </>
          )}
        </div>
      </div>

      <div className="relative mt-2">
        {menuVisible && (
          <SkillMenu
            skills={pickable}
            agents={pickableAgents}
            highlight={hi}
            onPick={pick}
            onPickAgent={pickAgent}
            onAdd={() => {
              setMenuOpen(false);
              onChange("");
              onAddSkill();
            }}
            onManage={() => {
              setMenuOpen(false);
              onChange("");
              onManageSkills();
            }}
          />
        )}

        <DigInput
          value={value}
          onChange={onChange}
          onSubmit={() => send(mode)}
          busy={busy}
          autoFocus
          tone="plain"
          inputRef={inputRef}
          command={chat ? command : null}
          agent={chat ? agent : null}
          icon={chat ? <MessagesSquare className="size-full" strokeWidth={1.9} /> : undefined}
          actionLabel={chat ? "Ask" : "Search"}
          placeholder={chat ? "Ask anything" : "Search for anything"}
          onKeyDown={(e) => {
            if (menuVisible && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setHi((v) => (v + (e.key === "ArrowDown" ? 1 : rows - 1)) % rows);
            } else if (menuVisible && e.key === "Enter") {
              e.preventDefault();
              if (hi < pickable.length) pick(pickable[hi].slug);
              else if (hi < footerAt) pickAgent(pickableAgents[hi - pickable.length].slug);
              else {
                setMenuOpen(false);
                onChange("");
                if (hi === footerAt) onAddSkill();
                else onManageSkills();
              }
            } else if (e.key === "Escape") {
              setMenuOpen(false);
              if (filter != null) onChange("");
            } else if (e.key === "Backspace" && value === "" && (command || agent)) {
              if (agent) setAgent(null);
              else setCommand(null);
            }
          }}
        />
      </div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        // The underline is drawn on both, transparent when inactive, so the
        // label never shifts by the two pixels a rule would otherwise add.
        "inline-flex items-center gap-1.5 border-b-2 px-2 pt-1 pb-1.5 text-[13px] transition-colors",
        active
          ? "border-amber-700 font-medium text-stone-900"
          : "border-transparent text-stone-500 hover:text-stone-800",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
