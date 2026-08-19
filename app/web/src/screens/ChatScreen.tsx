import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, MessageSquare, Plus } from "lucide-react";
import { BadgerMark } from "@/components/BadgerMark";
import { Markdown, type Citation } from "@/components/Markdown";
import { BRAND_LOGOS } from "@/components/BrandLogos";
import type { SourceId } from "@/lib/api";
import { VerificationBadge } from "@/components/AnswerCard";
import type { AnswerState } from "@/components/AnswerCard";
import { splitAnswer, type OpenedItem } from "@/lib/ask";

/** One exchange: the question asked, and everything the run produced. */
export type ChatTurn = { question: string; answer: AnswerState };

/**
 * The conversation screen: every exchange in a scrolling thread, and a way to
 * ask the next thing.
 *
 * Everything under an answer is derived from the run that produced it.
 * Sources are what that answer cites, verified against what the tools
 * returned; the dashed card is what Badger read in full and then did not
 * cite. That gap is the cheapest honest signal in the product — it says what
 * was looked at, not just what was used. The tool trail above each answer is
 * the same idea applied to the work itself: the calls stay on screen after
 * the answer lands, instead of flashing past on a status line.
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
  const uncited = result?.uncited ?? [];
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

      <div className="mt-3 flex items-center gap-2.5">
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-stone-900">
          <BadgerMark size={14} />
        </span>
        <span className="font-mono text-[11.5px] text-stone-500">
          {answer.running
            ? (answer.activity ?? "thinking") + "…"
            : result
              ? [
                  `${result.toolCalls.length} tool ${result.toolCalls.length === 1 ? "call" : "calls"}`,
                  result.opened.length ? `${result.opened.length} threads read in full` : null,
                  `${cited.length} ${cited.length === 1 ? "source" : "sources"} cited`,
                  `${(result.tookMs / 1000).toFixed(1)}s`,
                  result.costUsd != null ? `$${result.costUsd.toFixed(4)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : ""}
        </span>
      </div>

      {/* The trail: every call this run made, kept on screen. While the run
          is live the newest call is already on the status line above, so the
          trail earns its place once there is more than one call to show. */}
      {answer.tools.length > 1 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {answer.tools.map((t, i) => (
            <span
              key={i}
              className="inline-flex h-6 items-center rounded-full bg-stone-100 px-2.5 font-mono text-[10.5px] text-stone-600"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {answer.error ? (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {answer.error}
        </p>
      ) : (
        <article className="mt-5 text-[15px]/[1.8] text-stone-800">
          <Markdown text={body} citations={citations} />
          {answer.running && answer.text && (
            <Loader2 className="mt-2 size-3.5 animate-spin text-stone-400" />
          )}
        </article>
      )}

      {result && (
        <>
          <div className="mt-7 flex items-center gap-3">
            <span className="font-mono text-[10px] tracking-[0.1em] text-stone-500 uppercase">
              Sources
            </span>
            <span className="h-px flex-1 bg-stone-100" />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {cited.map((item, i) => (
              <SourceCard
                key={item.kind + item.ref}
                item={item}
                index={i + 1}
                anchored={isLast}
              />
            ))}

            {/* The honesty signal, in its cheapest possible form. */}
            {uncited.length > 0 && (
              <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-stone-200 px-3 py-2.5">
                <span className="size-[19px] shrink-0 rounded-[5px] border border-stone-200 bg-stone-50" />
                <span className="text-xs text-stone-500">
                  {uncited.length} {uncited.length === 1 ? "item was" : "items were"} opened but
                  not cited
                </span>
              </div>
            )}

            {cited.length === 0 && uncited.length === 0 && (
              <p className="text-xs text-stone-500">
                This answer cites nothing, so there is nothing to check it against.
              </p>
            )}
          </div>

          {coverage && (
            <p className="mt-4 text-[12px]/[1.6] text-stone-500">
              <span className="font-mono text-[10px] tracking-[0.1em] text-stone-400 uppercase">
                Coverage
              </span>{" "}
              {coverage}
            </p>
          )}

          <div className="mt-4">
            <VerificationBadgeLight result={result} />
          </div>
        </>
      )}
    </section>
  );
}

/** The brand mark for one source, so every surface names it the same way. */
function SourceMark({ id, size }: { id: SourceId; size: number }) {
  const Logo = BRAND_LOGOS[id];
  return <Logo size={size} />;
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
 * One cited source.
 *
 * The glyph used to be the literal string "github" for every card, written
 * when GitHub was the only source and left in place after Gmail and Drive were
 * wired up — so a mail thread and a Drive document both displayed as GitHub.
 *
 * Only the latest turn's cards carry the `source-N` anchor ids the citation
 * superscripts jump to — with every turn anchored, the same id would exist
 * once per turn and the browser would jump to the wrong one.
 */
function SourceCard({
  item,
  index,
  anchored,
}: {
  item: OpenedItem;
  index: number;
  anchored: boolean;
}) {
  return (
    <div
      id={anchored ? `source-${index}` : undefined}
      className="flex items-center gap-2.5 rounded-lg border border-stone-200 px-3 py-2.5 target:border-amber-300 target:bg-amber-50"
    >
      <span className="size-[19px] shrink-0 rounded-[5px] bg-amber-700 text-center font-mono text-[10px]/[19px] font-semibold text-white">
        {index}
      </span>
      <SourceMark id={SOURCE_OF[item.kind]} size={13} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium">{item.label}</div>
        <div className="mt-0.5 truncate font-mono text-[10.5px] text-stone-500">
          {item.detail ?? item.kind}
        </div>
      </div>
    </div>
  );
}

/** The verification badge again, in the light palette this screen uses. */
function VerificationBadgeLight({ result }: { result: NonNullable<AnswerState["result"]> }) {
  return (
    <div className="rounded-lg bg-stone-900 px-3 py-2">
      <VerificationBadge result={result} />
    </div>
  );
}
