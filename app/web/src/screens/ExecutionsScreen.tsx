import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Clock } from "lucide-react";
import { TurnBlock } from "@/components/chat/TurnBlock";
import { TIMEZONE_NOTE, fetchExecution, fetchExecutions, istStamp, type Execution, type Schedule } from "@/lib/schedules";

/**
 * What the schedule has produced.
 *
 * A run is a record you open and read, not a conversation you continue — which
 * is why executions are their own table rather than chat sessions, and why
 * this list has no composer under it.
 *
 * Every time on this page is India Standard Time and says so. The schedule
 * belongs to the agent rather than to whichever browser is looking at it.
 */
export function ExecutionsScreen({
  agent,
  schedule,
  runId,
  agentColor,
  onSchedule,
}: {
  agent: string;
  /** The schedule itself, so the empty state can say what is coming. */
  schedule: Schedule | null;
  /** Set on /agents/:slug/executions/:id — one run, in full. */
  runId?: string;
  /** The agent's mark, so its runs are led by it here as they are in chat. */
  agentColor?: string;
  onSchedule: () => void;
}) {
  if (runId) return <Detail agent={agent} id={runId} agentColor={agentColor} />;
  return <Listing agent={agent} schedule={schedule} onSchedule={onSchedule} />;
}

function Listing({
  agent,
  schedule,
  onSchedule,
}: {
  agent: string;
  schedule: Schedule | null;
  onSchedule: () => void;
}) {
  const [runs, setRuns] = useState<Execution[] | null>(null);
  const [persisted, setPersisted] = useState(true);

  // Polled, and only while something is actually in flight. A run takes
  // fifteen seconds or so and Run now sends you straight here, so the row has
  // to fill itself in — but a list of finished runs changes only when a
  // schedule fires, and polling that forever would be a request every few
  // seconds for the life of the tab.
  const running = runs?.some((r) => r.status === "running") ?? false;
  useEffect(() => {
    let live = true;
    const load = () =>
      fetchExecutions(agent)
        .then((r) => {
          if (!live) return;
          setRuns(r.runs);
          setPersisted(r.persisted);
        })
        .catch(() => live && setRuns([]));

    load();
    if (!running) return () => void (live = false);
    const timer = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [agent, running]);

  if (runs === null) {
    return (
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="h-3.5 w-56 animate-pulse rounded bg-stone-200/70" />
      </main>
    );
  }

  if (!runs.length) {
    return (
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-16">
        <div className="mx-auto max-w-[420px] text-center">
          <Clock className="mx-auto size-6 text-stone-300" strokeWidth={1.8} />
          <p className="mt-3 text-[13.5px] font-medium text-stone-900">Nothing has run yet</p>
          <p className="mt-1.5 text-[12.5px]/[1.7] text-stone-500">
            {/* Three different situations, and they need three different
                sentences. "No runs yet" alone would read the same whether the
                agent is about to run, has no schedule, or is on a server that
                cannot keep the history — and only one of those is worth
                waiting through. */}
            {!persisted
              ? "This server has no database, so runs are not kept."
              : schedule?.enabled
                ? `${schedule.label}, starting ${istStamp(schedule.nextRunAt)}. ${TIMEZONE_NOTE}`
                : schedule
                  ? "This agent's schedule is paused."
                  : "Set this agent running on its own and every run will be kept here."}
          </p>
          {persisted && !schedule && (
            <button
              onClick={onSchedule}
              className="mt-4 inline-flex h-8 items-center rounded-lg bg-stone-900 px-3.5 text-[12.5px] font-medium text-stone-50"
            >
              Schedule
            </button>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="overflow-hidden rounded-xl border border-stone-200">
        <table className="w-full table-fixed">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50/60 text-[10.5px] tracking-[0.06em] text-stone-400 uppercase">
              <th className="w-[190px] py-2.5 pl-4 text-left font-medium">Triggered (IST)</th>
              <th className="w-[100px] py-2.5 text-left font-medium">Trigger</th>
              <th className="w-[110px] py-2.5 text-left font-medium">Status</th>
              <th className="py-2.5 text-left font-medium">Output</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b border-stone-100 last:border-b-0 hover:bg-stone-50/70">
                <td className="py-0 pl-0">
                  {/* The link fills the row rather than wrapping only the
                      timestamp, so the whole row is the target it looks like. */}
                  <Link to={`/agents/${run.agent}/executions/${run.id}`} className="block py-3.5 pl-4 text-[13px] text-stone-800">
                    {istStamp(run.triggeredAt)}
                  </Link>
                </td>
                <td className="py-3.5 text-[12.5px] text-stone-500">
                  {run.trigger === "manual" ? "Run now" : "Schedule"}
                </td>
                <td className="py-3.5">
                  <StatusPill status={run.status} />
                </td>
                <td className="py-3.5 pr-4">
                  <Link to={`/agents/${run.agent}/executions/${run.id}`} className="block truncate text-[13px] text-stone-500">
                    {run.status === "running"
                      ? "Running…"
                      : run.status === "error"
                        ? run.error
                        : run.answer || "—"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Detail({ agent, id, agentColor }: { agent: string; id: string; agentColor?: string }) {
  const [run, setRun] = useState<Execution | null | undefined>(undefined);

  const running = run?.status === "running";
  useEffect(() => {
    let live = true;
    const load = () =>
      fetchExecution(agent, id)
        .then((r) => live && setRun(r.run))
        .catch(() => live && setRun(null));

    load();
    if (!running) return () => void (live = false);
    const timer = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [agent, id, running]);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-6 py-6">
        <Link
          to={`/agents/${agent}/executions`}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-stone-500 hover:text-stone-900"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} />
          Executions
        </Link>

        {run === undefined && <div className="mt-6 h-3.5 w-56 animate-pulse rounded bg-stone-200/70" />}
        {run === null && <p className="mt-6 text-[13px] text-stone-500">That run is not here.</p>}

        {run && (
          <>
            <div className="mt-5 flex items-center gap-3">
              <p className="text-[13px] text-stone-500">{istStamp(run.triggeredAt)} IST</p>
              <StatusPill status={run.status} />
              <span className="text-[12.5px] text-stone-400">
                {run.trigger === "manual" ? "Run now" : "Schedule"}
              </span>
            </div>

            {run.status === "running" ? (
              // Nothing but the question and the fact that it is going. The
              // step trail is a LIVE thing driven by a stream, and there is no
              // stream here — a scheduled run has no browser attached, so the
              // steps are only stored when it finishes. Half a trail that
              // cannot advance would say less than one honest line.
              <div className="mt-6">
                <p className="text-[14.5px]/[1.6] text-stone-800">{run.input}</p>
                <p className="mt-4 text-[13px] text-stone-400">Running…</p>
              </div>
            ) : (
              /* The same component the Playground renders an answer with,
                 given the stored run reshaped as a turn. So an unverified
                 citation or a refusal is exactly as visible in an execution as
                 it is in a conversation — which is the whole reason for not
                 building a second renderer.

                 No error banner beneath it: TurnBlock already renders a
                 failure as the trail's last row, and a second copy printed the
                 same sentence twice. */
              <div className="mt-2">
                <TurnBlock
                  agentColor={agentColor}
                  turn={{
                    question: run.input,
                    answer: {
                      running: false,
                      steps: run.result?.steps ?? [],
                      text: run.result?.answer ?? "",
                      result: run.result ?? null,
                      error: run.error,
                    },
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function StatusPill({ status }: { status: Execution["status"] }) {
  const tone =
    status === "success"
      ? "bg-emerald-50 text-emerald-700"
      : status === "error"
        ? "bg-red-50 text-red-700"
        : "bg-stone-100 text-stone-500";
  return (
    <span className={`inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium ${tone}`}>
      {status === "running" ? "unfinished" : status}
    </span>
  );
}
