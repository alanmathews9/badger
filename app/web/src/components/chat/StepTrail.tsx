import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AnswerState } from "@/components/AnswerCard";
import { describeTool, summariseSteps, type ToolStep } from "@/lib/ask";
import { FoundRow } from "./SourceChip";

/**
 * The run's work, as a connected trail of steps.
 *
 * **Steps accumulate downward.** They used to overwrite: only `steps.at(-1)`
 * was drawn while running, on the argument that a growing list is motion
 * without information. Watching a real run says otherwise — a line that
 * replaces itself gives the reader nothing to hold on to and no sense of how
 * far along the work is, and it throws away the shape of the search (GitHub,
 * then the issue, then Gmail) which is the most interesting thing on screen
 * during the wait.
 *
 * **The badger sits on the topmost row and the rows are chained to it.** It
 * used to be an avatar in a column beside the whole block, which said "this
 * turn is Badger's" but left the steps looking like a separate list that
 * happened to be next to it. Marking the first row and running a hairline
 * between the markers says the stronger thing: these are one thread of work,
 * and it is the badger's. Claude's trail is built the same way.
 *
 * Once the answer lands the whole trail collapses to one summary row —
 * "Searched GitHub and Gmail, read 3 sources" — still carrying the mark,
 * which expands to bring the steps back.
 *
 * It used to end with a verification badge ("3 citations, all retrieved") and
 * the model's own coverage note. Both are gone from here. Verification still
 * runs on every answer and still marks a bad citation `[UNVERIFIED]` inline,
 * where it changes what the reader believes; a green tick inside a panel
 * almost nobody opens changed nothing. The coverage note was the model
 * counting its own tool calls back at the reader, which the trail above
 * already shows and shows more honestly.
 */
export function StepTrail({ answer }: { answer: AnswerState }) {
  const [open, setOpen] = useState(false);
  const { steps, running, result } = answer;

  if (running) {
    const rows = steps.length ? steps : [null];
    return (
      <div className="flex flex-col">
        {rows.map((step, i) => (
          <TrailRow key={i} lead={i === 0} running last={i === rows.length - 1}>
            <StepLine step={step} live={i === rows.length - 1} />
          </TrailRow>
        ))}
        {/* Whatever the model is writing right now. A run takes fifteen
            seconds, and this is the one thing on screen that says why the wait
            is happening.

            It sits HERE rather than in the answer area deliberately. This is a
            live scratchpad and it is allowed to change; an answer is not. */}
        {answer.text.trim() && (
          <p className="mt-1 pl-10 text-[12px]/[1.7] text-stone-400 italic line-clamp-3">
            {answer.text.trim()}
          </p>
        )}
      </div>
    );
  }

  // Stopped. The chain still stands — the badger on the lead row, whatever
  // steps did run, and the interruption as the final row rather than as a
  // stray line underneath. Without this the trail returned null the moment a
  // run was cancelled, so "Interrupted" appeared alone with no mark beside
  // it and nothing saying whose turn it was.
  if (answer.stopped) {
    return (
      <div className="mb-4 flex flex-col">
        {steps.map((step, i) => (
          <TrailRow key={i} lead={i === 0} running={false} last={false}>
            <StepLine step={step} live={false} />
          </TrailRow>
        ))}
        <TrailRow lead={steps.length === 0} running={false} last>
          <p className="flex h-6 items-center text-[13px] text-stone-400">Interrupted</p>
        </TrailRow>
      </div>
    );
  }

  // Failed. Same shape as stopped, and for the same reason: the badger keeps
  // the lead row, whatever steps ran stay on the chain, and the message is the
  // final row rather than a boxed notice floating underneath. It used to be an
  // amber alert panel with no mark beside it, which read as the page reporting
  // a fault rather than as Badger saying it could not finish — and amber says
  // "warning" for something that is simply an error. Red, and in Badger's own
  // voice, in the place every other thing it says appears.
  if (answer.error) {
    return (
      <div className="mb-4 flex flex-col">
        {steps.map((step, i) => (
          <TrailRow key={i} lead={i === 0} running={false} last={false}>
            <StepLine step={step} live={false} />
          </TrailRow>
        ))}
        <TrailRow lead={steps.length === 0} running={false} last>
          <p className="flex min-h-6 items-center text-[13px] text-red-700">{answer.error}</p>
        </TrailRow>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="mb-4 flex flex-col">
      <TrailRow lead running={false} last={!open}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-6 items-center gap-1 text-[12.5px] text-stone-400 hover:text-stone-600"
        >
          {summariseSteps(steps)}
          <ChevronRight
            className={"size-3.5 transition-transform " + (open ? "rotate-90" : "")}
            strokeWidth={2}
          />
        </button>
      </TrailRow>

      {open &&
        steps.map((step, i) => (
          <TrailRow key={i} lead={false} running={false} last={i === steps.length - 1}>
            <StepLine step={step} live={false} />
          </TrailRow>
        ))}

    </div>
  );
}

/**
 * One row of the chain: a marker, and a hairline running down to the next.
 *
 * `lead` rows carry the badger — the walking one while the run is live, the
 * resting mark once it is done. Everything after carries a dot. The connector
 * is `flex-1` inside a stretched column, so it grows to whatever height the
 * row's content turns out to be rather than being given a guessed length.
 */
function TrailRow({
  lead,
  running,
  last,
  children,
}: {
  lead: boolean;
  running: boolean;
  last: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <div className="flex w-8 shrink-0 flex-col items-center">
        {/* A fixed 24px band, and the row's first line of text is pinned to a
            band of the same height. Both centre inside it, so the marker sits
            on the text's optical centre whatever the marker happens to be.

            Everything before this top-aligned the marker to the row, which
            can never line up: text is centred within its line box, so a
            marker flush to the row's top always rides high.

            The 32px loader deliberately OVERFLOWS this band rather than
            shrinking to fit — it stays big, and centring keeps it on the same
            line. Because the band's height is fixed, the loader also stops
            eating the column, which is what left the lead row with no
            connector under it. */}
        <div className="flex h-6 shrink-0 items-center justify-center">
          {lead ? (
            <img
              src={running ? "/badger-thinking.svg" : "/mark.svg"}
              alt="Badger"
              className={running ? "size-8 max-w-none" : "h-5 w-auto max-w-none"}
            />
          ) : (
            <span className="size-2 rounded-full bg-stone-300" />
          )}
        </div>
        {/* Clears the loader's overflow, so the hairline starts below the
            drawing rather than behind it. */}
        {!last && <span className="mt-1 w-px flex-1 bg-stone-200" />}
      </div>
      <div className={"min-w-0 flex-1 " + (last ? "" : "pb-3")}>{children}</div>
    </div>
  );
}

/**
 * A step's line: the plain-language label, and — for a search — the documents
 * it found.
 *
 * The result list is the point of the row. "Searched Gmail" tells a reader
 * that something happened; the four subjects underneath tell them what Badger
 * is actually working from, which is the difference between waiting and
 * watching. The card scrolls rather than growing, so a search returning twelve
 * results does not push the composer off the screen.
 *
 * A null step is the moment before the first tool call: the model reading the
 * question, with nothing to expand yet.
 */
function StepLine({ step, live }: { step: ToolStep | null; live: boolean }) {
  const [open, setOpen] = useState(false);
  const found = step?.found ?? [];
  // Derived here, not read off the step — see `describeTool`. The tense has to
  // follow whether this row is the running one, and a label stored at call
  // time cannot know that. It also un-freezes the wording for conversations
  // saved before the labels last changed.
  const label = step ? describeTool(step.name, step.args, live) : "Thinking";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-6 items-center gap-2 text-[13px]">
        <button
          onClick={() => step && setOpen((v) => !v)}
          className={
            "group inline-flex min-w-0 items-center gap-1.5 text-left " +
            (live ? "text-stone-700 " : "text-stone-500 ") +
            (step ? "hover:text-stone-900" : "")
          }
        >
          <span className="truncate">{label}</span>
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
        {found.length > 0 && (
          <span className="ml-auto shrink-0 text-[11.5px] text-stone-400">
            {found.length} {found.length === 1 ? "result" : "results"}
          </span>
        )}
      </div>

      {found.length > 0 && (
        <div className="max-h-[164px] divide-y divide-stone-100 overflow-y-auto rounded-lg border border-stone-200 bg-white">
          {found.map((doc) => (
            <FoundRow key={doc.source + doc.kind + doc.ref} doc={doc} />
          ))}
        </div>
      )}

      {open && step && (
        <div className="flex flex-col gap-1.5">
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

/**
 * The call's arguments, compact enough to read on one or two lines.
 *
 * `_badger_*` are dropped: the preToolUse hook injects the run's user id and
 * repository into every call's arguments, and they are plumbing rather than
 * anything the model chose. Showing them put a session identifier on screen
 * inside what is meant to be a readout of the agent's own decisions.
 */
function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args).filter(
    ([k, v]) => v != null && v !== "" && !k.startsWith("_badger_"),
  );
  if (entries.length === 0) return "";
  const text = entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
  return text.length > 220 ? text.slice(0, 220) + "…" : text;
}
