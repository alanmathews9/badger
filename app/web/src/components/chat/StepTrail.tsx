import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AnswerState } from "@/components/AnswerCard";
import { describeTool, summariseSteps, type ToolStep } from "@/lib/ask";
import { FoundRow } from "./SourceChip";
import { AgentMark } from "@/components/agents/icons";

/**
 * The run's work, as a connected trail of steps.
 *
 * Steps accumulate downward rather than overwriting: the shape of the search
 * (GitHub, then the issue, then Gmail) is the most interesting thing on screen
 * during the wait, and a line that replaces itself throws it away.
 *
 * The badger marks the topmost row and a hairline chains the rest to it, so
 * the steps read as one thread of work rather than a list beside an avatar.
 *
 * Once the answer lands the trail collapses to one summary row, which expands
 * to bring the steps back.
 *
 * No verification badge here. Verification still runs and still marks a bad
 * citation `[UNVERIFIED]` inline, where it changes what the reader believes; a
 * green tick inside a panel nobody opens changed nothing.
 */
export function StepTrail({ answer, agentColor }: { answer: AnswerState; agentColor?: string }) {
  const [open, setOpen] = useState(false);
  const { steps, running, result } = answer;

  if (running) {
    const rows = steps.length ? steps : [null];
    return (
      <div className="flex flex-col">
        {rows.map((step, i) => (
          <TrailRow key={i} lead={i === 0} running last={i === rows.length - 1} color={agentColor}>
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

  // Stopped. The chain still stands: the badger on the lead row, whatever
  // steps ran, and the interruption as the final row rather than a stray line
  // underneath with no mark beside it.
  if (answer.stopped) {
    return (
      <div className="mb-4 flex flex-col">
        {steps.map((step, i) => (
          <TrailRow key={i} lead={i === 0} running={false} last={false} color={agentColor}>
            <StepLine step={step} live={false} />
          </TrailRow>
        ))}
        <TrailRow lead={steps.length === 0} running={false} last color={agentColor}>
          <p className="flex h-6 items-center text-[13px] text-stone-400">Interrupted</p>
        </TrailRow>
      </div>
    );
  }

  // Failed. Same shape as stopped: the message is the final row rather than a
  // boxed notice floating underneath, which reads as the page reporting a
  // fault rather than Badger saying it could not finish.
  if (answer.error) {
    return (
      <div className="mb-4 flex flex-col">
        {steps.map((step, i) => (
          <TrailRow key={i} lead={i === 0} running={false} last={false} color={agentColor}>
            <StepLine step={step} live={false} />
          </TrailRow>
        ))}
        <TrailRow lead={steps.length === 0} running={false} last color={agentColor}>
          <p className="flex min-h-6 items-center text-[13px] text-red-700">{answer.error}</p>
        </TrailRow>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="mb-4 flex flex-col">
      <TrailRow lead running={false} last={!open} color={agentColor}>
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
  color,
  children,
}: {
  lead: boolean;
  running: boolean;
  last: boolean;
  /** A sub-agent's colour. Absent means this run was Badger's own. */
  color?: string;
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
          {lead && color ? (
            /* A sub-agent answered, so its own mark leads the trail. There is
               no thinking variant of it — the pulse says the same thing and
               swapping the mark mid-run would read as a change of author. */
            <AgentMark color={color} size={20} className={running ? "animate-pulse" : ""} />
          ) : lead ? (
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
 * The result list is the point of the row: "Searched Gmail" says something
 * happened, the subjects underneath say what Badger is working from. The card
 * scrolls rather than growing, so twelve results do not push the composer off
 * the screen.
 *
 * A null step is the moment before the first tool call.
 */
function StepLine({ step, live }: { step: ToolStep | null; live: boolean }) {
  const [open, setOpen] = useState(false);
  const found = step?.found ?? [];
  // Derived here, not read off the step — see `describeTool`. A label stored
  // at call time cannot know whether this row is the running one, and freezes
  // the wording into every conversation already saved.
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

      {/* What a search found, open while that search is the step in progress
          and folded away once the run has moved on.
          
          They used to be open on every row at once. Three searches in a row
          therefore stacked three result lists on screen, the trail grew to
          most of the viewport while the reader was waiting, and then the whole
          thing collapsed to one summary line when the answer landed — a jump
          rather than a settling. Showing only the live step keeps the trail
          about the height of its steps: the current one is open because it is
          what the agent is doing right now, and the finished ones say how many
          they found and wait behind the chevron for anyone who wants them. */}
      {found.length > 0 && (live || open) && (
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
 * repository into every call, so they are plumbing rather than the model's
 * decisions — and one of them is a session identifier.
 */
function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args).filter(
    ([k, v]) => v != null && v !== "" && !k.startsWith("_badger_"),
  );
  if (entries.length === 0) return "";
  const text = entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
  return text.length > 220 ? text.slice(0, 220) + "…" : text;
}
