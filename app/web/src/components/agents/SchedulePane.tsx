import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Play, Trash2, X } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";
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

const UNITS: { value: Unit; label: string }[] = [
  { value: "minutes", label: "minutes" },
  { value: "hours", label: "hours" },
  { value: "days", label: "days" },
  { value: "months", label: "months" },
];

/**
 * Set the agent running on its own.
 *
 * A side pane rather than a dialog. A schedule is edited against the agent it
 * belongs to — you want its name, its tools and its tabs still on screen while
 * you decide what to ask it — and a modal blacks all of that out to show four
 * fields.
 *
 * A schedule is a saved question and an interval, and deliberately nothing
 * else. There is no retry count and no retry delay: the agent holds read tools
 * only, so a failed run leaves nothing half-done to recover — it shows as
 * failed and the next interval comes round.
 *
 * **Everything here is India Standard Time and it is not editable.** A schedule
 * belongs to the agent rather than to the browser that made it: it fires with
 * nobody watching, and the same schedule read in two places would otherwise
 * name two different times for one event. The zone is stated on screen rather
 * than assumed.
 */
export function SchedulePane({
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
  // Which way the interval is being written. A saved schedule opens on the
  // side it was written from: `interval` is null exactly when the cron is not
  // one this dropdown can produce, so a hand-written one cannot be silently
  // reopened as an approximation of itself.
  const [mode, setMode] = useState<"every" | "cron">(
    schedule && !schedule.interval ? "cron" : "every",
  );
  const [unit, setUnit] = useState<Unit>(schedule?.interval?.unit ?? "hours");
  const [every, setEvery] = useState<number>(schedule?.interval?.every ?? 1);
  const [cron, setCron] = useState(schedule?.cron ?? "0 9 * * 1");
  const [prompt, setPrompt] = useState(schedule?.prompt ?? "");
  const [busy, setBusy] = useState<null | "save" | "run" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Set after a save, so the pane can say where the output will appear rather
  // than leaving the reader to find it.
  const [saved, setSaved] = useState(false);

  // The banner names a real clock time, so it has to keep up with the clock.
  // Sitting on this pane for twenty minutes must not leave it promising a
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
  // true for every option on the dropdown rather than approximately true for
  // some. A hand-written cron has no anchor — it fires when it says — so the
  // banner there names the saved schedule's next run and nothing before it.
  const firstRun = firstRunLabel(nextSlot(now).toISOString());
  const spec = mode === "cron" ? { cron: cron.trim() } : { every, unit };
  const changed =
    !schedule ||
    prompt.trim() !== schedule.prompt ||
    (mode === "cron" ? cron.trim() !== schedule.cron : every !== schedule.interval?.every || unit !== schedule.interval?.unit);

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
      const res = await saveSchedule(agent, { prompt, ...spec, enabled: schedule?.enabled ?? true });
      onChange(res.schedule);
      setSaved(true);
      if (res.schedule.interval) {
        setMode("every");
        setUnit(res.schedule.interval.unit);
        setEvery(res.schedule.interval.every);
      }
      setCron(res.schedule.cron);
    });

  const toggle = () =>
    act("save", async () => {
      const res = await saveSchedule(agent, {
        prompt: schedule!.prompt,
        ...(schedule!.interval ? schedule!.interval : { cron: schedule!.cron }),
        enabled: !schedule!.enabled,
      });
      onChange(res.schedule);
    });

  const remove = () =>
    act("delete", async () => {
      await deleteSchedule(agent);
      onChange(null);
      onClose();
    });

  const runNow = () =>
    act("run", async () => {
      const res = await runScheduleNow(agent);
      onChange(res.schedule);
      setSaved(true);
    });

  return (
    <>
      <div className="fixed inset-0 z-10 bg-stone-900/25" onClick={onClose} />
      <aside
        aria-label="Schedule"
        className="fixed inset-y-0 right-0 z-20 flex w-[440px] max-w-full flex-col border-l border-stone-200 bg-white shadow-xl"
      >
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-stone-100 px-5">
          {/* The agent's name is already the page title behind this pane, and
              in the breadcrumb above it. A third copy said nothing. */}
          <h2 className="text-[13.5px] font-medium text-stone-900">Schedule</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-900"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <div>
            {/* The heading carries the switch, so "Run every" and the way you
                are writing it read as one decision rather than as a setting
                with an unexplained toggle underneath it. */}
            <div className="mb-1.5 flex h-6 items-center">
              <span className="text-[12px] font-medium text-stone-500">Run every</span>
              <div className="ml-auto inline-flex items-center gap-0.5 rounded-md bg-stone-100 p-0.5">
                <Mode active={mode === "every"} onClick={() => setMode("every")}>
                  Interval
                </Mode>
                <Mode active={mode === "cron"} onClick={() => setMode("cron")}>
                  Cron
                </Mode>
              </div>
            </div>

            {mode === "every" ? (
              // Half and half. The number is four characters at most, so a
              // field sized for a sentence reads as one that expects a
              // sentence; matching the two says they are one value.
              <div className="flex gap-2">
                <Select
                  className="w-1/2"
                  label="How many"
                  value={every}
                  onChange={setEvery}
                  options={INTERVALS[unit].map((n) => ({ value: n, label: String(n) }))}
                />
                <Select
                  className="w-1/2"
                  label="Unit"
                  value={unit}
                  onChange={pickUnit}
                  options={UNITS}
                />
              </div>
            ) : (
              <>
                <input
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  spellCheck={false}
                  aria-label="Cron expression"
                  placeholder="0 9 * * 1"
                  className="h-9 w-full rounded-lg border border-stone-200 px-2.5 font-mono text-[13px] placeholder:text-stone-300 focus:border-stone-400 focus:outline-none"
                />
                <p className="mt-1.5 text-[11.5px]/[1.6] text-stone-400">
                  minute hour day month weekday, read in IST. Runs are checked every 15 minutes, so
                  the minute field has to allow 0, 15, 30 or 45.
                </p>
              </>
            )}
          </div>

          {/* Large on purpose. This text is the whole job — it is what the
              agent will be asked with nobody watching, so it should be as
              visible here as an answer is in the Playground. */}
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-stone-500">Ask</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={7}
              placeholder={`What should ${agent} do?`}
              className="w-full resize-none rounded-lg border border-stone-200 px-3 py-2.5 text-[13px]/[1.7] placeholder:text-stone-300 focus:border-stone-400 focus:outline-none"
            />
          </label>

          <p className="rounded-lg bg-stone-50 px-3 py-2.5 text-[12px]/[1.7] text-stone-500">
            {schedule && !changed ? (
              schedule.enabled ? (
                <>
                  Next run at <span className="font-medium text-stone-800">{firstRunLabel(schedule.nextRunAt)}</span>.
                </>
              ) : (
                <>This schedule is paused, so it will not run.</>
              )
            ) : mode === "cron" ? (
              <>Saved as written. The next run is shown once it is saved.</>
            ) : (
              <>
                First run at <span className="font-medium text-stone-800">{firstRun}</span>, then{" "}
                {every === 1 ? `every ${unit.replace(/s$/, "")}` : `every ${every} ${unit}`}.
              </>
            )}{" "}
            {TIMEZONE_NOTE}
          </p>

          {error && (
            <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-[12px]/[1.7] text-amber-800">{error}</p>
          )}

          {saved && !changed && (
            <p className="text-[12px]/[1.7] text-stone-500">
              Every run is kept in{" "}
              <Link
                to={`/agents/${agent}/executions`}
                onClick={onClose}
                className="font-medium text-stone-800 underline underline-offset-2"
              >
                Executions
              </Link>
              .
            </p>
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-stone-100 px-5 py-3">
          {schedule && (
            <>
              {/* Pause rather than delete. A schedule is a question somebody
                  wrote; switching it off keeps it and its history, and the
                  destructive action is a separate one behind a confirmation. */}
              <button
                onClick={toggle}
                disabled={busy !== null}
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
                onClick={() => setConfirming(true)}
                disabled={busy !== null}
                aria-label="Delete schedule"
                className="inline-flex size-7 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-red-700 disabled:opacity-40"
              >
                <Trash2 className="size-3.5" strokeWidth={2} />
              </button>
            </>
          )}
          <button
            onClick={save}
            disabled={busy !== null || !prompt.trim() || (Boolean(schedule) && !changed)}
            className="ml-auto inline-flex h-8 items-center justify-center rounded-lg bg-stone-900 px-3.5 text-[12.5px] font-medium text-stone-50 disabled:opacity-30"
          >
            {busy === "save" ? "Saving…" : schedule ? "Save changes" : "Create"}
          </button>
        </footer>

        {confirming && (
          // Inside the pane, over the pane. Deleting a schedule is small
          // enough that leaving the agent's page to confirm it would be a
          // bigger interruption than the action.
          <div className="absolute inset-x-0 bottom-0 border-t border-stone-200 bg-white p-5 shadow-[0_-8px_24px_rgba(0,0,0,0.06)]">
            <p className="text-[13px] font-medium text-stone-900">Delete this schedule?</p>
            <p className="mt-1.5 text-[12.5px]/[1.6] text-stone-500">
              The agent stops running on its own. Everything it has already produced stays in
              Executions.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={remove}
                disabled={busy !== null}
                className="inline-flex h-9 items-center justify-center rounded-md bg-red-700 px-4 text-[13px] font-medium text-white hover:bg-red-800 disabled:opacity-40"
              >
                {busy === "delete" ? "Deleting…" : "Delete schedule"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="text-[12.5px] text-stone-500 hover:text-stone-900"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function Mode({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-5 items-center rounded px-2 text-[11.5px] font-medium transition-colors",
        active ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-900",
      )}
    >
      {children}
    </button>
  );
}
