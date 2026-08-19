import { useEffect, useRef, useState } from "react";
import { ArrowUp, Plus, Square } from "lucide-react";
import { skillDisplayName, type SkillInfo } from "@/lib/ask";
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
  running,
  preset,
  prefill,
  onSubmit,
  onStop,
  onAddSkill,
  onPresetUsed,
  onPrefillUsed,
}: {
  skills: SkillInfo[];
  running: boolean;
  /** A skill to pre-fill — set when the add-skill pane has just written one. */
  preset: string | null;
  /** Text to drop into the box, from a suggestion. Never sent on its own. */
  prefill: string | null;
  onSubmit: (question: string, skill: string | null) => void;
  /** Abort the run in flight. Only reachable while `running`. */
  onStop: () => void;
  onAddSkill: () => void;
  onPresetUsed: () => void;
  onPrefillUsed: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  /** The picked skill, shown as a /command token ahead of the text. */
  const [command, setCommand] = useState<string | null>(null);
  /** Which menu row the keyboard has highlighted. */
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Slash mode: the draft is "/" plus a token still being typed. Once the
  // token ends in a space the command is settled and becomes the token.
  const slashing = command ? null : draft.match(/^\/(\S*)$/);
  const menuVisible = menuOpen || slashing != null;
  const filter = (slashing?.[1] ?? "").toLowerCase();

  const pickable = skills
    .filter((s) => ["recent-activity", "find-expert"].includes(s.slug) || s.origin === "custom")
    .filter(
      (s) => s.slug.includes(filter) || skillDisplayName(s.slug).toLowerCase().includes(filter),
    );

  const insertSkill = (slug: string) => {
    setCommand(slug);
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
    let next = text.trim();
    if (!next || running) return;
    // The token is the skill; a hand-typed leading /slug also counts.
    let skill: string | null = command;
    const typed = next.match(/^\/([a-z0-9-]+)\s+([\s\S]+)$/);
    if (!skill && typed && skills.some((s) => s.slug === typed[1])) {
      skill = typed[1];
      next = typed[2].trim();
    }
    if (!next || next.startsWith("/")) return;
    setDraft("");
    setCommand(null);
    onSubmit(next, skill);
  };

  const openPane = () => {
    setMenuOpen(false);
    setDraft("");
    onAddSkill();
  };

  return (
    <div className="relative mx-auto max-w-[720px]">
      {menuVisible && (
        <SkillMenu skills={pickable} highlight={hi} onPick={insertSkill} onAdd={openPane} />
      )}

      <div className="rounded-2xl border border-stone-200 shadow-sm transition-colors focus-within:border-stone-300">
        <div className="flex items-start gap-1.5 px-4 pt-3.5">
          {command && (
            <span className="shrink-0 font-mono text-[13px] font-medium text-amber-700">
              /{command}
            </span>
          )}
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              const rows = pickable.length + 1; // + "Add your own"
              if (menuVisible && e.key === "ArrowDown") {
                e.preventDefault();
                setHi((v) => (v + 1) % rows);
              } else if (menuVisible && e.key === "ArrowUp") {
                e.preventDefault();
                setHi((v) => (v - 1 + rows) % rows);
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (menuVisible) {
                  if (hi < pickable.length) insertSkill(pickable[hi].slug);
                  else openPane();
                } else submit(draft);
              } else if (e.key === "Escape") {
                setMenuOpen(false);
                if (slashing) setDraft("");
              } else if (e.key === "Backspace" && draft === "" && command) {
                setCommand(null);
              }
            }}
            placeholder={command ? "What do you want to know?" : "Write a message…"}
            rows={2}
            className="block w-full resize-none bg-transparent text-sm placeholder:text-stone-400 focus:outline-none"
          />
        </div>
        <div className="flex items-center px-2.5 pb-2.5">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Skills"
            className="inline-flex size-8 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100"
          >
            <Plus className="size-[18px]" strokeWidth={1.9} />
          </button>
          <div className="ml-auto flex items-center gap-1.5">
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
            <button
              onClick={() => submit(draft)}
              disabled={!draft.trim() || running}
              aria-label="Send"
              className="inline-flex size-8 items-center justify-center rounded-lg bg-stone-900 text-stone-50 disabled:opacity-30"
            >
              <ArrowUp className="size-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
