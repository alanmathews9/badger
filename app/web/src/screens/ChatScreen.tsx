import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronRight, ExternalLink, Loader2, MessageSquare, Plus } from "lucide-react";
import { Markdown, type Citation } from "@/components/Markdown";
import { BRAND_LOGOS } from "@/components/BrandLogos";
import type { SourceId } from "@/lib/api";
import { VerificationBadge } from "@/components/AnswerCard";
import type { AnswerState } from "@/components/AnswerCard";
import { splitAnswer, type OpenedItem, type ToolStep } from "@/lib/ask";

/** One exchange: the question asked, and everything the run produced. */
export type ChatTurn = { question: string; answer: AnswerState };

/**
 * The conversation screen: every exchange in a scrolling thread, and a way to
 * ask the next thing.
 *
 * Everything under an answer is derived from the run that produced it.
 * Sources are what that answer cites, verified against what the tools
 * returned, each linking to the real item for whoever has access. The step
 * trail above each answer shows the work as it happens and then collapses to
 * one quiet row — the detail (tool calls, the verification result, coverage)
 * stays reachable behind the chevron instead of being printed under every
 * answer.
 */
export function ChatScreen({
  turns,
  onAsk,
  onNewChat,
}: {
  turns: ChatTurn[];
  onAsk: (next: string) => void;
  onNewChat: () => void;
}) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const last = turns.at(-1);
  const running = last?.answer.running ?? false;

  // Follow the stream: new turns and new text both pull the view down.
  const lastTextLength = last?.answer.text.length ?? 0;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, lastTextLength]);

  const submit = (text: string) => {
    const next = text.trim();
    if (!next || running) return;
    setDraft("");
    onAsk(next);
  };

  const uncited = !running ? (last?.answer.result?.uncited ?? []) : [];

  return (
    <div className="flex h-dvh flex-col bg-white text-stone-900">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 px-4">
        <span className="truncate text-[13px] font-medium text-stone-600">
          {turns[0]?.question ?? "Chat"}
        </span>
        {turns.length > 0 && (
          <button
            onClick={onNewChat}
            className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-stone-200 px-2.5 text-xs text-stone-600 hover:bg-stone-50"
          >
            <Plus className="size-3.5" strokeWidth={2} />
            New chat
          </button>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-7">
        <div className="mx-auto max-w-[720px] pb-10">
          {turns.length === 0 ? (
            <div className="pt-10">
              <h1 className="text-[24px]/[1.4] font-semibold tracking-[-0.02em]">
                Ask Badger a question
              </h1>
              <p className="mt-2 text-sm text-stone-600">
                It searches, reads the threads, and answers with citations it can verify.
                Follow-ups carry the whole conversation, so ask the next thing in plain words.
              </p>
              <p className="mt-4 text-[12px] text-stone-500">
                Conversations live in this tab only — a refresh or “New chat” starts clean.
              </p>
            </div>
          ) : (
            turns.map((turn, i) => (
              <TurnBlock key={i} turn={turn} first={i === 0} isLast={i === turns.length - 1} />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </main>

      <div className="shrink-0 border-t border-stone-200 px-6 pt-3.5 pb-5">
        <div className="mx-auto max-w-[720px]">
          {/* Suggestions are the threads Badger read but did not cite — real
              next steps, and free. Generating suggestions with the model would
              be a second call to invent what we already know. */}
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

          <div className="flex h-[46px] items-center gap-2.5 rounded-lg border border-stone-300 pr-2 pl-3.5">
            <MessageSquare className="size-[17px] shrink-0 text-stone-400" strokeWidth={1.9} />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit(draft)}
              placeholder={turns.length === 0 ? "Ask Badger" : "Ask a follow-up"}
              className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-stone-400 focus:outline-none"
            />
            <button
              onClick={() => submit(draft)}
              disabled={!draft.trim() || running}
              aria-label="Send"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-stone-900 text-stone-50 disabled:opacity-40"
            >
              <ArrowUp className="size-[15px]" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
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
        <article className="mt-4 text-[15px]/[1.8] text-stone-800">
          <Markdown text={body} citations={citations} />
          {answer.running && answer.text && (
            <Loader2 className="mt-2 size-3.5 animate-spin text-stone-400" />
          )}
        </article>
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
    const searching = !answer.text;
    return (
      <div className="mt-4 flex flex-col gap-0.5">
        {steps.length === 0 ? (
          <StepRow step={null} live />
        ) : (
          steps.map((step, i) => (
            <StepRow key={i} step={step} live={searching && i === steps.length - 1} />
          ))
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
        <div className="mb-1 ml-[18px] max-w-full overflow-x-auto rounded-md bg-stone-50 px-2.5 py-1.5 font-mono text-[11px] text-stone-600">
          {step.name} {formatArgs(step.args)}
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

/** Which system an item came from. GitHub is the default, not the only one. */
const SOURCE_OF: Record<OpenedItem["kind"], SourceId> = {
  issue: "github",
  pr: "github",
  file: "github",
  mail: "gmail",
  doc: "drive",
};
