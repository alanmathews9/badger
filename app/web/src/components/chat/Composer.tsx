import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Plus, Square } from "lucide-react";
import {
  parseSkillCommand,
  pickableSkills,
  slashFilter,
  type AgentInfo,
  type SkillInfo,
} from "@/lib/ask";
import { ListeningHint, MicButton } from "@/components/MicButton";
import { useDictation } from "@/hooks/use-dictation";
import { SkillMenu } from "./SkillMenu";

/**
 * The composer: a rounded box with the plus for skills at the bottom left,
 * and skills invoked as slash text ("/find-expert who owns payments?") rather
 * than a separate chip.
 *
 * Lifted out of `ChatScreen` unchanged in behaviour. It owns the draft, the
 * picked skill and the menu's keyboard state — all of which are the
 * composer's own business, and none of which the thread above it ever read.
 */
export function Composer({
  skills,
  agents = [],
  plain = false,
  running,
  busy = false,
  preset,
  prefill,
  onSubmit,
  onStop,
  onAddSkill,
  onManageSkills,
  onPresetUsed,
  onPrefillUsed,
}: {
  skills: SkillInfo[];
  /** Sub-agents a question can be routed to instead of Badger. */
  agents?: AgentInfo[];
  /**
   * The box and nothing else — no `+`, no slash menu.
   *
   * For an agent's Playground, where the agent is already decided and the
   * skills on offer are Badger's rather than that agent's own. A menu of
   * things which cannot apply is worse than no menu.
   */
  plain?: boolean;
  /** An answer is being written. This is what puts Stop on screen. */
  running: boolean;
  /**
   * The composer cannot be used, but nothing is running — a stored
   * conversation is still arriving. Kept separate from `running` because
   * folding the two together put a Stop button on screen with no run behind
   * it: pressing it called a spent canceller and did nothing at all.
   */
  busy?: boolean;
  /** A skill to pre-fill — set when the add-skill pane has just written one. */
  preset: string | null;
  /** Text to drop into the box, from a suggestion. Never sent on its own. */
  prefill: string | null;
  onSubmit: (question: string, skill: string | null, agent: string | null) => void;
  /** Abort the run in flight. Only reachable while `running`. */
  onStop: () => void;
  onAddSkill: () => void;
  onManageSkills: () => void;
  onPresetUsed: () => void;
  onPrefillUsed: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  /** The picked skill, shown as a /command token ahead of the text. */
  const [command, setCommand] = useState<string | null>(null);
  /** The picked agent. Menu only: "/" names a skill, never an agent. */
  const [agent, setAgent] = useState<string | null>(null);
  /** Which menu row the keyboard has highlighted. */
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mic = useDictation(setDraft);

  // Slash mode: the draft is "/" plus a token still being typed. Once the
  // token ends in a space the command is settled and becomes the token.
  // The three rules — what filters, what is offered, how a typed command is
  // split — are shared with the home bar; see lib/ask.ts.
  const filter = slashFilter(draft, command);
  const menuVisible = !plain && (menuOpen || filter != null);
  const pickable = pickableSkills(skills, filter ?? "");
  const pickableAgents = agents.filter((a) => a.slug.includes((filter ?? "").toLowerCase()));

  const insertSkill = (slug: string) => {
    setCommand(slug);
    setDraft("");
    setMenuOpen(false);
    inputRef.current?.focus();
  };

  // An agent replaces Badger for the question, so picking one clears any
  // skill: skill matching is Badger-only and a sub-agent loads its own.
  const insertAgent = (slug: string) => {
    setAgent(slug);
    setCommand(null);
    setDraft("");
    setMenuOpen(false);
    inputRef.current?.focus();
  };

  // A skill saved in the pane lands in the box ready to use. The command
  // state lives here, so the pane hands the slug up to the screen and the
  // screen hands it back down — and it is cleared immediately, or saving the
  // same skill name twice would not re-fill it the second time.
  useEffect(() => {
    if (!preset) return;
    setCommand(preset);
    setDraft("");
    inputRef.current?.focus();
    onPresetUsed();
  }, [preset, onPresetUsed]);

  // A suggestion fills the box and stops there. It used to send immediately,
  // which took the decision away at the exact moment someone is deciding —
  // and left no way to adjust the wording first, which is the main reason to
  // start from an example at all.
  useEffect(() => {
    if (!prefill) return;
    setDraft(prefill);
    inputRef.current?.focus();
    onPrefillUsed();
  }, [prefill, onPrefillUsed]);

  // Keyboard highlight resets to the top row whenever the list changes.
  useEffect(() => {
    setHi(0);
  }, [filter, menuVisible]);

  const submit = (text: string) => {
    if (running || busy) return;
    mic.stop();
    const parsed = parseSkillCommand(text, command, skills);
    if (!parsed) return;
    setDraft("");
    setCommand(null);
    setAgent(null);
    onSubmit(parsed.question, agent ? null : parsed.skill, agent);
  };

  const openPane = () => {
    setMenuOpen(false);
    setDraft("");
    onAddSkill();
  };

  const openManage = () => {
    setMenuOpen(false);
    setDraft("");
    onManageSkills();
  };

  return (
    <div className="relative mx-auto max-w-[720px]">
      {menuVisible && (
        <SkillMenu
          skills={pickable}
          agents={pickableAgents}
          highlight={hi}
          onPick={insertSkill}
          onPickAgent={insertAgent}
          onAdd={openPane}
          onManage={openManage}
        />
      )}

      <div className="rounded-2xl border border-stone-200 shadow-sm transition-colors focus-within:border-stone-300">
        <div className="flex items-start gap-1.5 px-4 pt-3.5">
          {command && (
            <span className="shrink-0 font-mono text-[13px] font-medium text-amber-700">
              /{command}
            </span>
          )}
          {agent && (
            <span className="shrink-0 font-mono text-[13px] font-medium text-sky-700">
              @{agent}
            </span>
          )}
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              const rows = pickable.length + pickableAgents.length + 2;
              if (menuVisible && e.key === "ArrowDown") {
                e.preventDefault();
                setHi((v) => (v + 1) % rows);
              } else if (menuVisible && e.key === "ArrowUp") {
                e.preventDefault();
                setHi((v) => (v - 1 + rows) % rows);
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (menuVisible) {
                  const footerAt = pickable.length + pickableAgents.length;
                  if (hi < pickable.length) insertSkill(pickable[hi].slug);
                  else if (hi < footerAt) insertAgent(pickableAgents[hi - pickable.length].slug);
                  else if (hi === footerAt) openPane();
                  else openManage();
                } else submit(draft);
              } else if (e.key === "Escape") {
                setMenuOpen(false);
                if (filter != null) setDraft("");
              } else if (e.key === "Backspace" && draft === "" && (command || agent)) {
                if (agent) setAgent(null);
                else setCommand(null);
              }
            }}
            placeholder={command || agent ? "What do you want to know?" : "Write a message…"}
            rows={2}
            className="block w-full resize-none bg-transparent text-sm placeholder:text-stone-400 focus:outline-none"
          />
        </div>
        <div className="flex items-center px-2.5 pb-2.5">
          {!plain && (
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Skills"
              className="inline-flex size-8 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100"
            >
              <Plus className="size-[18px]" strokeWidth={1.9} />
            </button>
          )}
          {mic.listening && <ListeningHint className="ml-2" />}
          {mic.starting && <span className="ml-2 text-[12px] text-stone-500">Starting…</span>}
          <div className="ml-auto flex items-center gap-1.5">
            {mic.supported && (
              <MicButton
                listening={mic.listening}
                starting={mic.starting}
                error={mic.error}
                onClick={() => (mic.listening ? mic.cancel() : mic.toggle(draft))}
                className="size-8"
              />
            )}
            {/* Stop is only ever present while a run is in flight, and it sits
                beside Send rather than replacing it — replacing would move the
                target under a cursor already heading for it. Aborting the
                fetch is what stops the agent: the server treats a closed
                socket as "stop", so the run ends rather than burning tokens
                into a socket nobody is reading. */}
            {running && (
              <button
                onClick={onStop}
                aria-label="Stop"
                className="inline-flex size-8 items-center justify-center rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50"
              >
                <Square className="size-3 fill-current" strokeWidth={0} />
              </button>
            )}
            {mic.listening ? (
              <button
                onClick={() => mic.stop()}
                aria-label="Keep dictated text"
                title="Keep"
                className="inline-flex size-8 items-center justify-center rounded-lg bg-stone-900 text-stone-50"
              >
                <Check className="size-4" strokeWidth={2.2} />
              </button>
            ) : (
              <button
                onClick={() => submit(draft)}
                disabled={!draft.trim() || running || busy}
                aria-label="Send"
                className="inline-flex size-8 items-center justify-center rounded-lg bg-stone-900 text-stone-50 disabled:opacity-30"
              >
                <ArrowUp className="size-4" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
