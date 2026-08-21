import type { AskResult, ToolStep } from "@/lib/ask";

/**
 * The schedule API, and the interval vocabulary the modal is allowed to offer.
 *
 * **The list is closed, and it is closed on the server too.** Each of these is
 * faithfully expressible in cron, which is what the framework's schedule store
 * accepts and the only thing it accepts — see app/server/schedule-cron.mjs.
 * "Every 3 days" is missing because cron cannot say it, not because nobody
 * thought of it.
 */
export const INTERVALS: Record<Unit, number[]> = {
  minutes: [15, 30],
  hours: [1, 2, 3, 4, 6, 8, 12],
  days: [1],
  months: [1, 2, 3, 4, 6],
};

export type Unit = "minutes" | "hours" | "days" | "months";

export type Schedule = {
  id: string;
  agent: string;
  prompt: string;
  cron: string;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastResult?: string;
  /** Null when the cron was hand-written rather than chosen here. */
  interval: { every: number; unit: Unit } | null;
  /** "Every 30 minutes", or the raw cron when it is not one of ours. */
  label: string;
  /** Null when the schedule is switched off — there is no next run to name. */
  nextRunAt: string | null;
};

export type Execution = {
  id: string;
  agent: string;
  scheduleId: string;
  status: "running" | "success" | "error";
  triggeredAt: number;
  finishedAt: number | null;
  input: string;
  /** The listing carries the answer text; the detail carries `result`. */
  answer?: string;
  error: string | null;
  result?: (AskResult & { steps?: ToolStep[] }) | null;
};

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  // The server's own message is the useful one — "not a schedulable interval",
  // "Badger has used its answer budget for today" — so it is surfaced rather
  // than replaced with a status code.
  if (!res.ok) throw new Error(body?.error ?? `request failed (${res.status})`);
  return body as T;
}

export function fetchSchedule(agent: string) {
  return send<{ schedule: Schedule | null; timezone: string }>(`/api/agents/${agent}/schedule`);
}

export function saveSchedule(agent: string, spec: { prompt: string; every: number; unit: Unit; enabled?: boolean }) {
  return send<{ schedule: Schedule; timezone: string }>(`/api/agents/${agent}/schedule`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(spec),
  });
}

/** Run it now, whether or not it is due. Resolves when the run has finished. */
export function runScheduleNow(agent: string) {
  return send<{ ran: { id: string; status: string }; schedule: Schedule | null }>(
    `/api/agents/${agent}/schedule`,
    { method: "POST" },
  );
}

export function deleteSchedule(agent: string) {
  return send<{ removed: boolean }>(`/api/agents/${agent}/schedule`, { method: "DELETE" });
}

export function fetchExecutions(agent: string) {
  return send<{ persisted: boolean; runs: Execution[] }>(`/api/agents/${agent}/executions`);
}

export function fetchExecution(agent: string, id: string) {
  return send<{ persisted: boolean; run: Execution | null }>(`/api/agents/${agent}/executions/${id}`);
}

/**
 * Everything in the scheduling UI is India Standard Time, and it is never the
 * viewer's own zone.
 *
 * A schedule belongs to the agent, not to the browser that created it: it
 * fires while nobody is watching, and the same schedule rendered in Lisbon and
 * in Bengaluru would name two different times for one event. Naming one zone
 * everywhere costs a reader in another zone one conversion and costs nobody a
 * wrong answer. That is why the label is always on screen beside the time.
 */
const IST = "Asia/Kolkata";

export const TIMEZONE_NOTE = "Times are India Standard Time (IST).";

/** "4:45 PM", in IST. */
export function istTime(iso: string | number | null | undefined): string {
  if (iso == null) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleTimeString("en-US", {
    timeZone: IST,
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "21 Aug, 4:45 PM", in IST. What the Executions table shows. */
export function istStamp(iso: string | number | null | undefined): string {
  if (iso == null) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleString("en-GB", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * "First run at 4:45 PM", or with the day when it is not today.
 *
 * Today is decided in IST as well. A run at 00:30 IST is tomorrow for a reader
 * in London and today for the schedule, and the schedule is what is being
 * described.
 */
export function firstRunLabel(iso: string | null): string {
  if (!iso) return "—";
  const at = new Date(iso);
  const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST });
  return dayOf(at) === dayOf(new Date()) ? istTime(iso) : istStamp(iso);
}

/**
 * The next 15-minute mark — the anchor every schedule is built on.
 *
 * The same arithmetic the server does, and it needs no timezone: IST is offset
 * by 330 minutes, a whole number of slots, so the 15-minute grid is identical
 * in both. That is what lets the modal promise a first run time before the
 * schedule exists and be right.
 */
export function nextSlot(from: Date = new Date()): Date {
  const slot = 15 * 60 * 1000;
  return new Date(Math.floor(from.getTime() / slot) * slot + slot);
}
