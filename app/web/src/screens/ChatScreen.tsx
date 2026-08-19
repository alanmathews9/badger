import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronRight, ExternalLink, FileText, Loader2, Plus, Upload, X } from "lucide-react";
import { Markdown, type Citation } from "@/components/Markdown";
import { BRAND_LOGOS } from "@/components/BrandLogos";
import type { SourceId } from "@/lib/api";
import type { ChatSummary } from "@/lib/history";
import { VerificationBadge } from "@/components/AnswerCard";
import type { AnswerState } from "@/components/AnswerCard";
import {
  createSkill,
  fetchSkills,
  skillDisplayName,
  splitAnswer,
  type OpenedItem,
  type SkillInfo,
  type ToolStep,
} from "@/lib/ask";

/** One exchange: the question asked, and everything the run produced. */
export type ChatTurn = { question: string; answer: AnswerState };

/**
 * The conversation screen: a history pane of past chats, the thread itself,
 * and a Claude-style composer — a rounded box with the plus for skills at the
 * bottom left, and skills invoked as slash text ("/find-expert who owns
 * payments?") rather than a separate chip.
 */
export function ChatScreen({
  turns,
  chats,
  activeId,
  onAsk,
  onNewChat,
  onSelectChat,
}: {
  turns: ChatTurn[];
  chats: ChatSummary[];
  activeId: string | null;
  onAsk: (next: string, skill: string | null) => void;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paneOpen, setPaneOpen] = useState(false);
  /** The picked skill, shown as a blue /command token ahead of the text. */
  const [command, setCommand] = useState<string | null>(null);
  /** Which menu row the keyboard has highlighted. */
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchSkills().then(setSkills).catch(() => {});
  }, []);

  // Slash mode: the draft is "/" plus a token still being typed. Once the
  // token ends in a space the command is settled and becomes the blue token.
  const slashing = command ? null : draft.match(/^\/(\S*)$/);
  const menuVisible = (menuOpen || slashing != null) && !paneOpen;
  const filter = (slashing?.[1] ?? "").toLowerCase();

  const pickable = skills
    .filter((s) => ["recent-activity", "find-expert"].includes(s.slug) || s.origin === "custom")
    .filter(
      (s) => s.slug.includes(filter) || skillDisplayName(s.slug).toLowerCase().includes(filter),
    );

  // Picking a skill sets the blue /command token — still just text in the
  // box's flow, deletable with backspace, but visibly a skill.
  const insertSkill = (slug: string) => {
    setCommand(slug);
    setDraft("");
    setMenuOpen(false);
    inputRef.current?.focus();
  };

  // Keyboard highlight resets to the top row whenever the list changes.
  useEffect(() => {
    setHi(0);
  }, [filter, menuVisible]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const last = turns.at(-1);
  const running = last?.answer.running ?? false;

  // Follow the stream: new turns and new text both pull the view down.
  const lastTextLength = last?.answer.text.length ?? 0;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, lastTextLength]);

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
    onAsk(next, skill);
  };

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
          {chats.length === 0 ? (
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
        <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-7">
          <div className="mx-auto max-w-[680px] pb-10">
            {turns.length === 0 ? (
              <div className="pt-10">
                <h1 className="text-[24px]/[1.4] font-semibold tracking-[-0.02em]">
                  Ask Badger a question
                </h1>
                <div className="mt-7 flex flex-col items-start gap-2">
                  {[
                    "What changed in the last two weeks?",
                    "Who knows about payments?",
                    "Why was the Android app five weeks late?",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => submit(q)}
                      className="rounded-lg border border-stone-200 px-3.5 py-2 text-left text-[13px] text-stone-700 hover:bg-stone-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((turn, i) => (
                <TurnBlock key={i} turn={turn} first={i === 0} isLast={i === turns.length - 1} />
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </main>

        {/* ── Composer ─────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-stone-100 px-6 pt-4 pb-5">
          <div className="relative mx-auto max-w-[680px]">
            {uncited.length > 0 && (
              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {uncited.slice(0, 3).map((item) => (
                  <button
                    key={item.kind + item.ref}
                    onClick={() => submit(`Tell me about ${item.label}`)}
                    className="inline-flex h-7 items-center rounded-full border border-stone-200 bg-white px-3 text-xs text-stone-700 hover:bg-stone-50"
                  >
                    What was in {item.label}?
                  </button>
                ))}
              </div>
            )}

            {menuVisible && (
              <SkillMenu
                skills={pickable}
                highlight={hi}
                onPick={insertSkill}
                onAdd={() => {
                  setMenuOpen(false);
                  setDraft("");
                  setPaneOpen(true);
                }}
              />
            )}

            <div className="rounded-2xl border border-stone-200 shadow-sm transition-colors focus-within:border-stone-300">
              <div className="flex items-start gap-1.5 px-4 pt-3.5">
                {command && (
                  <span className="shrink-0 font-mono text-[13px] font-medium text-blue-600">
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
                        else {
                          setMenuOpen(false);
                          setDraft("");
                          setPaneOpen(true);
                        }
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
                <button
                  onClick={() => submit(draft)}
                  disabled={!draft.trim() || running}
                  aria-label="Send"
                  className="ml-auto inline-flex size-8 items-center justify-center rounded-lg bg-stone-900 text-stone-50 disabled:opacity-30"
                >
                  <ArrowUp className="size-4" strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {paneOpen && (
        <>
          <div
            className="fixed inset-0 z-10 bg-stone-900/25"
            onClick={() => setPaneOpen(false)}
          />
          <SkillPane
            onClose={(slug) => {
              setPaneOpen(false);
              fetchSkills().then(setSkills).catch(() => {});
              if (slug) insertSkill(slug);
            }}
          />
        </>
      )}
    </div>
  );
}

/** One question and everything its run produced, in conversation order. */
function TurnBlock({ turn, first, isLast }: { turn: ChatTurn; first: boolean; isLast: boolean }) {
  const { answer } = turn;
  const result = answer.result;
  const cited = result?.cited ?? [];
  const { body, coverage } = splitAnswer(answer.text);
  // The token is the literal string the answer contains, so the superscript
  // can be attached to it. GitHub items are cited by number, everything else
  // by the name it was cited under.
  const citations: Citation[] = cited.map((item, i) => ({
    token: item.kind === "issue" || item.kind === "pr" ? `#${item.ref}` : item.ref,
    index: i + 1,
  }));

  return (
    <section className={first ? "" : "mt-10 border-t border-stone-100 pt-8"}>
      <h1 className="text-[20px]/[1.4] font-semibold tracking-[-0.02em] text-pretty">
        {turn.question}
      </h1>

      <StepTrail answer={answer} coverage={coverage} />

      {answer.error ? (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {answer.error}
        </p>
      ) : (
        // NOTHING is rendered here while the run is live.
        //
        // Streaming text straight into the answer area was the bug: the model
        // interleaves narration with tool calls, and a tool call clears the
        // buffer, so the reader watched prose appear, vanish, appear again and
        // vanish again before the real answer landed. Moving the cleared text
        // into the trail was not enough — the vanishing was the complaint, and
        // it kept happening.
        //
        // So the answer slot only ever holds a finished answer. In-flight text
        // is shown by StepTrail as what it actually is: work in progress, in
        // the place where work is reported.
        !answer.running && (
          <article className="mt-4 text-[15px]/[1.8] text-stone-800">
            <Markdown text={body} citations={citations} />
          </article>
        )
      )}

      {result && cited.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="font-mono text-[10px] tracking-[0.1em] text-stone-400 uppercase">
            Sources
          </span>
          {cited.map((item, i) => (
            <SourceLink key={item.kind + item.ref} item={item} index={i + 1} anchored={isLast} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The run's work, as a trail of steps.
 *
 * While the run is live every step is its own row, the newest one spinning —
 * "Searching Drive for offboarding process", "Reading a document" — and each
 * row expands to show the actual tool call behind the plain-language line.
 * Once the answer lands the whole trail collapses to one quiet summary row;
 * expanding it brings the steps back, with the verification result and the
 * coverage note at the bottom. Those two used to be printed under every
 * answer; they are still checked on every run, just shown to whoever opens
 * the work rather than to everyone.
 */
function StepTrail({ answer, coverage }: { answer: AnswerState; coverage: string | null }) {
  const [open, setOpen] = useState(false);
  const { steps, running, result } = answer;

  if (running) {
    // Only the newest step shows while the run is live — the same choice Onyx
    // makes. A growing list mid-run is motion without information; the full
    // trail is one click away the moment the answer lands.
    const current = steps.at(-1) ?? null;
    return (
      <div className="mt-4 flex flex-col gap-1 text-[12.5px] text-stone-500">
        <div className="flex items-center gap-1.5">
          <Loader2 className="size-3 shrink-0 animate-spin text-stone-400" />
          {current ? current.label : "Thinking"}…
          {steps.length > 1 && <span className="text-stone-400">· step {steps.length}</span>}
        </div>
        {/* Whatever the model is writing right now, or its reason for the step
            it is on. A run takes fifteen seconds; "Searching Gmail" for all of
            it reads as a hang, and this is the one thing on screen that says
            why the wait is happening.
        
            It sits HERE rather than in the answer area deliberately. This is a
            live scratchpad and it is allowed to change; an answer is not. */}
        {(answer.text.trim() || current?.narration) && (
          <p className="pl-[18px] text-[12px]/[1.7] text-stone-400 italic line-clamp-3">
            {answer.text.trim() || current?.narration}
          </p>
        )}
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[12px] text-stone-400 hover:text-stone-600"
      >
        <ChevronRight
          className={"size-3.5 transition-transform " + (open ? "rotate-90" : "")}
          strokeWidth={2}
        />
        {steps.length === 0
          ? "Answered without searching"
          : `Worked through ${steps.length} ${steps.length === 1 ? "step" : "steps"}`}
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-0.5 border-l border-stone-100 pl-3">
          {steps.map((step, i) => (
            <StepRow key={i} step={step} live={false} />
          ))}
          <div className="mt-2 flex flex-col gap-1.5">
            <VerificationBadge result={result} />
            {coverage && <p className="text-[12px]/[1.6] text-stone-500">{coverage}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One step. The row is the plain-language line; the chevron opens the actual
 * tool call — name and arguments — for whoever wants to see the work itself.
 * A null step is the moment before the first tool call: the model reading the
 * question, with nothing to expand yet.
 */
function StepRow({ step, live }: { step: ToolStep | null; live: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => step && setOpen((v) => !v)}
        className="group inline-flex items-center gap-1.5 py-0.5 text-left text-[12.5px] text-stone-500 hover:text-stone-700"
      >
        {live ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-stone-400" />
        ) : (
          <span className="size-1 shrink-0 rounded-full bg-stone-300 mx-1" />
        )}
        {step ? step.label : "Thinking"}
        {live && "…"}
        {step && (
          <ChevronRight
            className={
              "size-3 shrink-0 text-stone-300 transition-transform group-hover:text-stone-400 " +
              (open ? "rotate-90" : "")
            }
            strokeWidth={2}
          />
        )}
      </button>
      {open && step && (
        <div className="mb-1 ml-[18px] flex flex-col gap-1.5">
          {step.narration && (
            <p className="text-[12px]/[1.6] text-stone-500 italic">{step.narration}</p>
          )}
          <div className="max-w-full overflow-x-auto rounded-md bg-stone-50 px-2.5 py-1.5 font-mono text-[11px] text-stone-600">
            {step.name} {formatArgs(step.args)}
          </div>
        </div>
      )}
    </div>
  );
}

/** The call's arguments, compact enough to read on one or two lines. */
function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args).filter(([, v]) => v != null && v !== "");
  if (entries.length === 0) return "";
  const text = entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
  return text.length > 220 ? text.slice(0, 220) + "…" : text;
}

/**
 * One cited source, as a small link rather than a card.
 *
 * The link opens the real item — the issue on GitHub, the document on Drive,
 * the thread in Gmail — in a new tab, for whoever has access to the account
 * behind it. A citation the server could not build an address for renders as
 * plain text; a dead link would be worse.
 *
 * Only the latest turn's sources carry the `source-N` anchor ids the citation
 * superscripts jump to — with every turn anchored, the same id would exist
 * once per turn and the browser would jump to the wrong one.
 */
function SourceLink({
  item,
  index,
  anchored,
}: {
  item: OpenedItem;
  index: number;
  anchored: boolean;
}) {
  const Logo = BRAND_LOGOS[SOURCE_OF[item.kind]];
  const inner = (
    <>
      <Logo size={12} />
      <span className="max-w-[260px] truncate">{item.label}</span>
    </>
  );

  // Every source link resolves only for someone holding the account behind it
  // — the repository is private, the Drive and the mailbox are one demo
  // account. That is inherent to citing federated sources, not a bug, but a
  // reader who clicks and gets Google's account chooser deserves to know why
  // rather than concluding the citation was invented. Mail is the case that
  // needs saying out loud, because Gmail answers with a chooser rather than a
  // recognisable "you do not have access" page.
  const mailbox = mailboxOf(item.url);
  const title = mailbox ? `Opens in ${mailbox} — the mailbox Badger indexed` : undefined;

  return (
    <span
      id={anchored ? `source-${index}` : undefined}
      className="inline-flex items-center gap-1.5 rounded px-0.5 text-[12.5px] target:bg-amber-50"
    >
      <span className="font-mono text-[10px] font-semibold text-amber-700">{index}</span>
      {item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          title={title}
          className="inline-flex items-center gap-1.5 text-stone-600 underline decoration-stone-300 underline-offset-2 hover:text-stone-900 hover:decoration-stone-500"
        >
          {inner}
          <ExternalLink className="size-3 text-stone-400" strokeWidth={2} />
        </a>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-stone-600">{inner}</span>
      )}
    </span>
  );
}


/** The mailbox a Gmail citation opens in, read back out of its own link. The
 *  server put it there as `authuser`; parsing it here beats threading the
 *  address through every layer for one tooltip. */
function mailboxOf(url?: string): string | null {
  if (!url?.startsWith("https://mail.google.com/")) return null;
  try {
    return new URL(url).searchParams.get("authuser");
  } catch {
    return null;
  }
}

/** Which system an item came from. GitHub is the default, not the only one. */
const SOURCE_OF: Record<OpenedItem["kind"], SourceId> = {
  issue: "github",
  pr: "github",
  file: "github",
  mail: "gmail",
  doc: "drive",
};

/**
 * The compact skills menu — opened by the plus, or by typing "/". Sized to
 * its content rather than the composer's width. Picking an item pre-fills
 * the slash command into the input.
 */
function SkillMenu({
  skills,
  highlight,
  onPick,
  onAdd,
}: {
  skills: SkillInfo[];
  highlight: number;
  onPick: (slug: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="absolute bottom-full left-0 z-10 mb-2 w-72 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg">
      {skills.map((s, i) => (
        <button
          key={s.slug}
          onClick={() => onPick(s.slug)}
          className={
            "flex w-full items-start gap-2.5 px-3.5 py-2 text-left hover:bg-stone-50 " +
            (i === highlight ? "bg-stone-100" : "")
          }
        >
          <FileText className="mt-0.5 size-3.5 shrink-0 text-stone-400" strokeWidth={1.9} />
          <span className="min-w-0">
            <span className="block font-mono text-[12.5px] font-medium text-stone-900">
              {s.slug}
            </span>
            {s.description && (
              <span className="block truncate text-[11.5px] text-stone-500">{s.description}</span>
            )}
          </span>
        </button>
      ))}
      <button
        onClick={onAdd}
        className={
          "flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[12.5px] text-stone-600 hover:bg-stone-50 " +
          (skills.length > 0 ? "border-t border-stone-100 " : "") +
          (highlight === skills.length ? "bg-stone-100" : "")
        }
      >
        <Plus className="size-3.5" strokeWidth={2} />
        Add your own skill
      </button>
    </div>
  );
}

/**
 * The add-skill side pane. The three fields are the framework's own SKILL.md
 * shape: the name; the description — the trigger, the only part the model
 * sees before deciding; and the steps, loaded once the trigger fires. Saving
 * writes a real SKILL.md into the agent's repo (the same mechanism its own
 * learning uses) and pre-fills the new slash command into the composer.
 */
function SkillPane({ onClose }: { onClose: (slug: string | null) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await createSkill({ name, description, instructions });
    setSaving(false);
    if (result.error) setError(result.error);
    else onClose(result.slug ?? null);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setSaving(true);
    setError(null);
    const result = await createSkill({ file: await file.text() });
    setSaving(false);
    if (result.error) setError(result.error);
    else onClose(result.slug ?? null);
  };

  const field =
    "mt-1 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] placeholder:text-stone-400 focus:border-stone-400 focus:outline-none";
  const label = "text-[11px] font-medium text-stone-500";
  const hint = "font-normal text-stone-400";

  return (
    <div className="fixed inset-y-0 right-0 z-20 flex w-[380px] max-w-full flex-col border-l border-stone-200 bg-white shadow-xl">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-stone-100 px-4">
        <span className="text-[13.5px] font-semibold">New skill</span>
        <button
          onClick={() => onClose(null)}
          aria-label="Close"
          className="inline-flex size-7 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100"
        >
          <X className="size-4" strokeWidth={2} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3.5">
          <div>
            <div className={label}>Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Summarise for a customer"
              className={field}
            />
          </div>
          <div>
            <div className={label}>
              When should Badger use it? <span className={hint}>— the trigger it reads to decide</span>
            </div>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. When an answer will be sent to a customer"
              className={field}
            />
          </div>
          <div>
            <div className={label}>
              What should Badger do? <span className={hint}>— the steps once the trigger fires</span>
            </div>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={"1. Answer as a short summary a customer could read.\n2. Never name internal staff or internal disagreements.\n3. Lead with what the customer gets and when."}
              rows={7}
              className={field + " resize-y"}
            />
          </div>
          {error && <p className="text-[12px] text-amber-700">{error}</p>}

          <div className="mt-1 flex items-center gap-3">
            <span className="h-px flex-1 bg-stone-100" />
            <span className="text-[11px] text-stone-400">or</span>
            <span className="h-px flex-1 bg-stone-100" />
          </div>

          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-stone-300 px-3 py-2.5 text-[12.5px] text-stone-600 hover:bg-stone-50">
            <Upload className="size-3.5" strokeWidth={2} />
            Upload your own SKILL.md
            <input
              type="file"
              accept=".md,text/markdown"
              className="hidden"
              onChange={(e) => upload(e.target.files?.[0])}
            />
          </label>
        </div>
      </div>

      <div className="shrink-0 border-t border-stone-100 px-4 py-3">
        <button
          onClick={save}
          disabled={saving || !name.trim() || !description.trim() || !instructions.trim()}
          className="inline-flex h-8 w-full items-center justify-center rounded-md bg-stone-900 text-xs font-medium text-stone-50 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save skill"}
        </button>
        <p className="mt-2 text-center text-[11px] text-stone-400">
          Lands in the agent's own repo — usable on the next question via /
        </p>
      </div>
    </div>
  );
}
