import { useState } from "react";
import { ArrowUp, Loader2, MessageSquare } from "lucide-react";
import { BadgerMark } from "@/components/BadgerMark";
import { Markdown, type Citation } from "@/components/Markdown";
import { SourceGlyph } from "@/components/SourceGlyph";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { VerificationBadge } from "@/components/AnswerCard";
import type { AnswerState } from "@/components/AnswerCard";
import { splitAnswer, type OpenedItem } from "@/lib/ask";

/**
 * The reading screen: one question, the full answer, its sources, and a way
 * to ask the next thing.
 *
 * Everything here is derived from the run that produced the answer. Sources
 * are what the answer cites, verified against what the tools returned; the
 * dashed card is what Badger read in full and then did not cite. That gap is
 * the cheapest honest signal in the product — it says what was looked at, not
 * just what was used.
 */
export function ChatScreen({
  question,
  answer,
  onFollowUp,
}: {
  question: string;
  answer: AnswerState;
  onFollowUp: (next: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const result = answer.result;

  const cited = result?.cited ?? [];
  const uncited = result?.uncited ?? [];
  const { body, coverage } = splitAnswer(answer.text);
  const citations: Citation[] = cited.map((item, i) => ({
    token: item.kind === "file" ? item.ref : `#${item.ref}`,
    index: i + 1,
  }));

  const submit = (text: string) => {
    const next = text.trim();
    if (!next || answer.running) return;
    setDraft("");
    onFollowUp(next);
  };

  return (
    <div className="flex h-dvh flex-col bg-white text-stone-900">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 px-4">
        <SidebarTrigger className="text-stone-500" />
        <span className="truncate text-[13px] font-medium text-stone-600">
          {question || "Chat"}
        </span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-7">
        <div className="mx-auto max-w-[720px] pb-10">
          {!question ? (
            <div className="pt-10">
              <h1 className="text-[24px]/[1.4] font-semibold tracking-[-0.02em]">
                Ask Badger a question
              </h1>
              <p className="mt-2 text-sm text-stone-600">
                It searches, reads the threads, and answers with citations it can verify. Start
                from Search, or type below.
              </p>
              <p className="mt-4 text-[12px] text-stone-500">
                Past conversations are not saved yet — that needs a store, which is the next piece
                of work.
              </p>
            </div>
          ) : (
            <h1 className="text-[24px]/[1.4] font-semibold tracking-[-0.02em] text-pretty">
              {question}
            </h1>
          )}

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
                  <SourceCard key={item.kind + item.ref} item={item} index={i + 1} />
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
        </div>
      </main>

      <div className="shrink-0 border-t border-stone-200 px-6 pt-3.5 pb-5">
        <div className="mx-auto max-w-[720px]">
          {/* Suggestions are the threads Badger read but did not cite — real
              next steps, and free. Generating suggestions with the model would
              be a second call to invent what we already know. */}
          {uncited.length > 0 && !answer.running && (
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
              placeholder="Ask a follow-up"
              className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-stone-400 focus:outline-none"
            />
            <button
              onClick={() => submit(draft)}
              disabled={!draft.trim() || answer.running}
              aria-label="Send follow-up"
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

function SourceCard({ item, index }: { item: OpenedItem; index: number }) {
  return (
    <div
      id={`source-${index}`}
      className="flex items-center gap-2.5 rounded-lg border border-stone-200 px-3 py-2.5 target:border-amber-300 target:bg-amber-50"
    >
      <span className="size-[19px] shrink-0 rounded-[5px] bg-amber-700 text-center font-mono text-[10px]/[19px] font-semibold text-white">
        {index}
      </span>
      <SourceGlyph id="github" size={13} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium">{item.label}</div>
        <div className="mt-0.5 truncate font-mono text-[10.5px] text-stone-500">
          {item.detail ?? (item.kind === "file" ? "file" : `${item.kind} ${item.ref}`)}
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
