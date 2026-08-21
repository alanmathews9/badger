import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, Loader2, Play, Trash2 } from "lucide-react";
import {
  INTERVALS,
  TIMEZONE_NOTE,
  deleteSchedule,
  firstRunLabel,
  nextSlot,
  runScheduleNow,
  saveSchedule,
  type Schedule,
  type Unit,
} from "@/lib/schedules";

const UNITS: Unit[] = ["minutes", "hours", "days", "months"];

/**
 * Set the agent running on its own.
 *
 * A schedule is a saved question and an interval, and that is deliberately all
 * it is. There is no retry count and no retry delay: the agent holds read tools
 * only, so a failed run leaves nothing half-done to recover — it shows as
 * failed and the next interval comes round.
 *
 * **Everything here is India Standard Time and it is not editable.** A schedule
 * belongs to the agent rather than to the browser that made it: it fires with
 * nobody watching, and the same schedule read in two places would otherwise
 * name two different times for one event. The zone is stated on screen rather
 * than assumed.
 */
export function ScheduleModal({
  agent,
  schedule,
  onClose,
  onChange,
}: {
  agent: string;
  /** What is already saved, or null for a first schedule. */
  schedule: Schedule | null;
  onClose: () => void;
  onChange: (schedule: Schedule | null) => void;
}) {
  const [unit, setUnit] = useState<Unit>(schedule?.interval?.unit ?? "hours");
  const [every, setEvery] = useState<number>(schedule?.interval?.every ?? 1);
  const [prompt, setPrompt] = useState(schedule?.prompt ?? "");
  const [busy, setBusy] = useState<null | "save" | "run" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  // Set after a create, so the modal can say where the output will appear
  // rather than just closing and leaving the reader to find it.
  const [created, setCreated] = useState(false);

  // The banner names a real clock time, so it has to keep up with the clock.
  // Sitting on this dialog for twenty minutes must not leave it promising a
  // first run that has already been and gone.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Changing the unit has to move the number with it: 30 is a real number of
  // minutes and not a real number of months, and a form that lets you ask for
  // one and then refuses it has wasted the reader's time.
  const pickUnit = (next: Unit) => {
    setUnit(next);
    if (!INTERVALS[next].includes(every)) setEvery(INTERVALS[next][0]);
  };

  // The anchor is the next 15-minute mark whatever the interval, so this is
  // true for every option on the dropdown, not approximately true for some.
  const firstRun = firstRunLabel(nextSlot(now).toISOString());
  const changed =
    !schedule ||
    prompt.trim() !== schedule.prompt ||
    every !== schedule.interval?.every ||
    unit !== schedule.interval?.unit;

  const act = async (kind: "save" | "run" | "delete", run: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await run();
    } catch (err) {
      setError(err instanceof Error ? err.message : "that did not work");
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    act("save", async () => {
      const { schedule: saved } = await saveSchedule(agent, { prompt, every, unit, enabled: schedule?.enabled ?? true });
      onChange(saved);
      setCreated(true);
    });

  const toggle = () =>
    act("save", async () => {
      const { schedule: saved } = await saveSchedule(agent, {
        prompt: schedule!.prompt,
        every: schedule!.interval!.every,
        unit: schedule!.interval!.unit,
        enabled: !schedule!.enabled,
      });
      onChange(saved);
    });

  const remove = () =>
    act("delete", async () => {
      await deleteSchedule(agent);
      onChange(null);
      onClose();
    });

  const runNow = () =>
    act("run", async () => {
      const { schedule: saved } = await runScheduleNow(agent);
      onChange(saved);
      setCreated(true);
    });

  return (
    <>
      <div className="fixed inset-0 z-20 bg-stone-900/25" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Schedule"
        className="fixed top-1/2 left-1/2 z-30 w-[min(520px,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200 bg-white shadow-xl"
      >
        <header className="flex h-12 items-center gap-2 border-b border-stone-100 px-5">
          <Clock className="size-4 text-stone-400" strokeWidth={2} />
          <h2 className="text-[13.5px] font-medium text-stone-900">Schedule</h2>
          <span className="ml-auto font-mono text-[12px] text-stone-400">{agent}</span>
        </header>

        <div className="space-y-4 p-5">
          <Field label="Run every">
            <div className="flex gap-2">
              <select
                value={every}
                onChange={(e) => setEvery(Number(e.target.value))}
                className="h-9 w-24 rounded-lg border border-stone-200 bg-white px-2.5 text-[13px] focus:border-stone-400 focus:outline-none"
              >
                {INTERVALS[unit].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <select
                value={unit}
                onChange={(e) => pickUnit(e.target.value as Unit)}
                className="h-9 flex-1 rounded-lg border border-stone-200 bg-white px-2.5 text-[13px] focus:border-stone-400 focus:outline-none"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </Field>

          {/* Large on purpose. This text is the whole job — it is what the
              agent will be asked with nobody watching, so it should be as
              visible here as an answer is in the Playground. */}
          <Field label="Ask">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="What should this agent go and find out?"
              className="w-full resize-none rounded-lg border border-stone-200 px-3 py-2.5 text-[13px]/[1.7] placeholder:text-stone-300 focus:border-stone-400 focus:outline-none"
            />
          </Field>

          <p className="rounded-lg bg-stone-50 px-3 py-2.5 text-[12px]/[1.7] text-stone-500">
            {schedule && !changed ? (
              schedule.enabled ? (
                <>
                  Next run at <span className="font-medium text-stone-800">{firstRunLabel(schedule.nextRunAt)}</span>.
                </>
              ) : (
                <>This schedule is paused, so it will not run.</>
              )
            ) : (
              <>
                First run at <span className="font-medium text-stone-800">{firstRun}</span>, then {" "}
                {every === 1 ? `every ${unit.replace(/s$/, "")}` : `every ${every} ${unit}`}.
              </>
            )}{" "}
            {TIMEZONE_NOTE}
          </p>

          {error && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px]/[1.6] text-amber-800">{error}</p>
          )}

          {created && !changed && (
            <p className="text-[12px]/[1.7] text-stone-500">
              Every run is kept in{" "}
              <Link to={`/agents/${agent}/executions`} onClick={onClose} className="font-medium text-stone-800 underline underline-offset-2">
                Executions
              </Link>
              .
            </p>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-stone-100 px-5 py-3">
          {schedule && (
            <>
              {/* Pause rather than delete. A schedule is a question somebody
                  wrote; switching it off keeps it and its history, and the
                  destructive action is a separate one. */}
              <button
                onClick={toggle}
                disabled={busy !== null || !schedule.interval}
                className="text-[12.5px] text-stone-500 hover:text-stone-900 disabled:opacity-40"
              >
                {schedule.enabled ? "Pause" : "Resume"}
              </button>
              <button
                onClick={runNow}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 text-[12.5px] text-stone-500 hover:text-stone-900 disabled:opacity-40"
              >
                {busy === "run" ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                {busy === "run" ? "Running…" : "Run now"}
              </button>
              <button
                onClick={remove}
                disabled={busy !== null}
                aria-label="Delete schedule"
                className="inline-flex size-7 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-red-700 disabled:opacity-40"
              >
                <Trash2 className="size-3.5" strokeWidth={2} />
              </button>
            </>
          )}
          <div className="ml-auto flex items-center gap-3">
            <button onClick={onClose} className="text-[12.5px] text-stone-500 hover:text-stone-900">
              Close
            </button>
            <button
              onClick={save}
              disabled={busy !== null || !prompt.trim() || (Boolean(schedule) && !changed)}
              className="inline-flex h-8 items-center justify-center rounded-lg bg-stone-900 px-3.5 text-[12.5px] font-medium text-stone-50 disabled:opacity-30"
            >
              {busy === "save" ? "Saving…" : schedule ? "Save changes" : "Create"}
            </button>
          </div>
        </footer>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-stone-500">{label}</span>
      {children}
    </label>
  );
}
