import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { BRAND_LOGOS } from "@/components/BrandLogos";
import type { AnswerState } from "@/components/AnswerCard";
import { splitAnswer, type OpenedItem } from "@/lib/ask";
import { StepTrail } from "./StepTrail";
import { SOURCE_OF } from "./SourceChip";

/** One exchange: the question asked, and everything the run produced. */
export type ChatTurn = { question: string; answer: AnswerState };

/**
 * One question and everything its run produced, in conversation order.
 *
 * The question is a bubble on the right, not a heading: it is a marker in the
 * conversation, not a title for the document, and as an `<h1>` it made the
 * thing the reader already knows the largest element on the page.
 */
export function TurnBlock({ turn, agentColor }: { turn: ChatTurn; agentColor?: string }) {
  const { answer } = turn;
  const result = answer.result;
  const cited = result?.cited ?? [];
  const { body } = splitAnswer(answer.text);

  return (
    <section className="mt-8 first:mt-0">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-stone-100 px-4 py-2.5 text-[14.5px]/[1.6] text-stone-800">
          {turn.question}
        </div>
      </div>

      {/* No avatar column here. The badger marks the FIRST row of the step
          trail instead, with a hairline chaining the rows beneath it — see
          `StepTrail`. An avatar beside the whole block said "this turn is
          Badger's" but left the trail reading as a separate list parked next
          to a mark; leading the chain with it says the stronger thing, and
          gives the answer its full reading width back. */}
      <div className="mt-6">
        <StepTrail answer={answer} agentColor={agentColor} />

        {/* Neither an interruption nor a failure is rendered here — both are
            the last row of the trail, so they keep the badger and the chain.
            See `StepTrail`. */}
        {answer.stopped || answer.error ? null : (
          // NOTHING is rendered here while the run is live. The model
          // interleaves narration with tool calls and a tool call clears the
          // buffer, so streaming into this slot makes prose appear and vanish
          // repeatedly. In-flight text belongs to StepTrail, where work is
          // reported; this slot only ever holds a finished answer.
          !answer.running && (
            <article className="text-[15px]/[1.8] text-stone-800">
              <Markdown text={body} />
            </article>
          )
        )}

        {result && cited.length > 0 && <Sources cited={cited} />}
      </div>
    </section>
  );
}

/**
 * Everything the answer cites, three at a time.
 *
 * Seven links wrap to four rows and take more vertical space than the answer.
 * Three is enough to see what this rests on; the rest are one click away.
 *
 * The ONLY place a citation appears — inline markers were tried twice and
 * removed, see `Markdown`.
 */
function Sources({ cited }: { cited: OpenedItem[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? cited : cited.slice(0, 3);
  const hidden = cited.length - shown.length;

  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <span className="font-mono text-[10px] tracking-[0.1em] text-stone-400 uppercase">
        Sources
      </span>
      {shown.map((item) => (
        <SourceLink key={item.kind + item.ref} item={item} />
      ))}
      {(hidden > 0 || all) && (
        <button
          onClick={() => setAll((v) => !v)}
          className="text-[12.5px] text-stone-400 underline decoration-stone-300 underline-offset-2 hover:text-stone-600"
        >
          {hidden > 0 ? `+${hidden} more` : "Show fewer"}
        </button>
      )}
    </div>
  );
}

/**
 * One cited source, as a small link rather than a card.
 *
 * Opens the real item in a new tab, for whoever has access to the account
 * behind it. A citation the server could not build an address for renders as
 * plain text: a dead link would be worse.
 */
function SourceLink({ item }: { item: OpenedItem }) {
  const Logo = BRAND_LOGOS[SOURCE_OF[item.kind]];
  const inner = (
    <>
      <Logo size={12} />
      <span className="max-w-[260px] truncate">{item.label}</span>
    </>
  );

  // Links resolve only for someone holding the account behind them: the repo
  // is private and Drive and the mailbox are one demo account. Mail needs
  // saying out loud, because Gmail answers with an account chooser rather than
  // a recognisable "you do not have access" page.
  const mailbox = mailboxOf(item.url);
  const title = mailbox ? `Opens in ${mailbox} — the mailbox Badger indexed` : undefined;

  return (
    <span className="inline-flex items-center gap-1.5 rounded px-0.5 text-[12.5px]">
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
