// Pull requests 23–30.
//
// Numbers 23–30 because GitHub draws issues and pull requests from one
// sequence: the 22 issues are created first, so the first PR is #23. The
// seeder asserts this rather than hoping.
//
// Three states, and each is a different thing for the agent to get right:
//
//   merged (#23–#27)  A fix that shipped. The diff is the citation — "the
//                     timezone bug was fixed" resolves to code, not to someone
//                     saying so in a thread.
//   open   (#28, #29) Drafts with unresolved review arguments. A proposal, and
//                     reporting one as a decision is a wrong answer.
//   closed, unmerged (#30)
//                     The first offline sync attempt, abandoned after three
//                     weeks. This is the hard evidence behind issue #8: the
//                     release notes blame App Store review, and this PR is a
//                     three-week hole in that story that nobody can argue with.
//
// One honesty note about time. GitHub sets `created_at` on issues and pull
// requests server-side and there is no way to backdate it, so every item here
// will show today's date in the API. Only commits can be backdated
// (`author__date`). Dates that matter are therefore written into the text,
// which is also where the agent reads them from. #30 is created last and so
// carries the highest number while describing the earliest work; its body says
// so plainly.
//
// Review comments name a file, not a line. The seeder anchors each one to the
// first line of that file's first diff hunk, read back from the PR itself:
// Composio's wrapper rejects GitHub's file-level `subject_type` and demands a
// line, and a guessed line 422s on any file whose first change is not near the
// top. What the comment is *about* is the file, and the text says so.

import { P, says } from "./company.mjs";

export const PULLS = [
  // ============================================================ merged fixes
  {
    number: 23,
    author: P.wei,
    branch: "fix/clinic-timezones",
    title: "Store each clinic's timezone and send reminders in local time",
    merge: true,
    body: `Fixes #1.

Adds \`clinics.timezone\` (IANA, not an offset — offsets are wrong twice a year)
and routes every human-facing time conversion through
\`api/src/clinics/timezone.js\`.

- \`reminders/schedule.js\` pins the evening reminder to 18:00 **clinic local**
- \`reminders/templates.js\` formats the appointment time in clinic local
- \`clinics/opening-hours.js\` compares against clinic-local wall time

Backfill: every existing clinic is Europe/London except the two Portuguese ones
and Meadow, who are the reason we found this.

Tested with a clinic forced to Australia/Melbourne: evening reminder lands at
18:00 AEDT, two-hour reminder lands two hours before the appointment rather
than nine hours after it.`,
    files: [
      {
        path: "api/src/clinics/timezone.js",
        date: "2026-03-20T14:15:00Z",
        message: "Clinic-local time conversion, one place only",
        content: `/**
 * Clinic-local time.
 *
 * Every clinic carries an IANA timezone (\`clinics.timezone\`, added March 2026).
 * Before that the whole service assumed UTC, which is invisible while every
 * customer is in Europe and wrong by eleven hours the moment one is not — see
 * issue #1, where Meadow Veterinary's reminders went out at 3am Melbourne time.
 *
 * The rule this file exists to enforce: **anything a human reads is clinic
 * local; anything we store is UTC.** No exceptions, and no "it's fine, they're
 * all in London".
 */
export function inClinicTime(clinic, instant) {
  const tz = clinic.timezone ?? "Europe/London";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    date: \`\${get("year")}-\${get("month")}-\${get("day")}\`,
    weekday: get("weekday"),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    timezone: tz,
  };
}

/** The reverse: a clinic-local wall time to a UTC instant. */
export function fromClinicTime(clinic, date, minutes) {
  const tz = clinic.timezone ?? "Europe/London";
  const naive = Date.parse(\`\${date}T\${pad(minutes / 60)}:\${pad(minutes % 60)}:00Z\`);
  return naive - offsetMillis(tz, naive);
}

const pad = (n) => String(Math.floor(n)).padStart(2, "0");

/** How far ahead of UTC \`tz\` is at \`instant\`, in milliseconds. */
function offsetMillis(tz, instant) {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(dtf.formatToParts(instant).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}
`,
      },
      {
        path: "api/src/reminders/schedule.js",
        date: "2026-03-20T14:22:00Z",
        message: "Schedule reminders against clinic-local time (#1)",
        content: `import { inClinicTime, fromClinicTime } from "../clinics/timezone.js";

/**
 * When to remind.
 *
 * Two reminders: one the evening before, one two hours ahead. The evening one
 * is pinned to 18:00 **clinic local** rather than "24 hours before", because a
 * 7am appointment would otherwise page a patient at 7am the day before.
 *
 * The clinic-local part is not decoration. Before March 2026 this function did
 * its arithmetic in UTC, and Meadow Veterinary's patients got their reminders
 * at 3am — issue #1.
 */
export async function scheduleReminders(db, booking, clinic) {
  const local = inClinicTime(clinic, booking.startsAt);
  const dayBefore = previousDay(local.date);

  const evening = fromClinicTime(clinic, dayBefore, 18 * 60);
  const twoHours = booking.startsAt - 2 * 60 * 60 * 1000;

  const rows = [
    { kind: "evening_before", sendAt: evening },
    { kind: "two_hours", sendAt: twoHours },
  ].filter((r) => r.sendAt > db.now());

  return db.reminders.insertMany(
    rows.map((r) => ({ ...r, bookingId: booking.id, clinicId: clinic.id, state: "pending" })),
  );
}

const previousDay = (date) => {
  const d = new Date(\`\${date}T12:00:00Z\`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
`,
      },
      {
        path: "api/src/reminders/templates.js",
        date: "2026-03-20T14:26:00Z",
        message: "Render appointment times in clinic-local time (#1)",
        content: `import { inClinicTime } from "../clinics/timezone.js";

const TEMPLATES = {
  evening_before: (v) =>
    \`Hi \${v.patient.firstName}, a reminder of your \${v.service} at \${v.clinic.name} \` +
    \`tomorrow at \${v.time}. Reply CANCEL if you can no longer make it.\`,
  two_hours: (v) =>
    \`\${v.clinic.name}: your \${v.service} is at \${v.time} today. See you shortly.\`,
};

export function render(kind, { booking, clinic, patient }) {
  const local = inClinicTime(clinic, booking.startsAt);
  const time = \`\${String(Math.floor(local.minutes / 60)).padStart(2, "0")}:\` +
    String(local.minutes % 60).padStart(2, "0");
  return TEMPLATES[kind]({ patient, clinic, service: booking.serviceName, time });
}
`,
      },
      {
        path: "api/src/clinics/opening-hours.js",
        date: "2026-03-20T14:31:00Z",
        message: "Compare opening hours against clinic-local time (#1)",
        content: `import { inClinicTime } from "./timezone.js";

/**
 * Is this instant inside the clinic's opening hours?
 *
 * Exceptions (bank holidays, the Thursday a practice closes at noon) override
 * the weekly pattern, which is why they are checked first.
 */
export async function isWithinOpeningHours(db, clinic, startsAt) {
  const local = inClinicTime(clinic, startsAt);

  const exception = await db.openingHourExceptions.forDate(clinic.id, local.date);
  if (exception) return exception.closed ? false : within(exception, local.minutes);

  const weekly = await db.openingHours.forWeekday(clinic.id, local.weekday);
  return weekly ? within(weekly, local.minutes) : false;
}

const within = (h, minutes) => minutes >= h.opens && minutes < h.closes;
`,
      },
    ],
    reviewComments: [
      {
        path: "api/src/clinics/timezone.js",
        body: says(P.dev, `Good that this is one file. The thing that will break us later is somebody adding a sixth call site and formatting a time inline because it is two lines. Worth a lint rule eventually.`),
      },
      {
        path: "api/src/reminders/schedule.js",
        body: says(P.tomas, `\`previousDay\` anchors at noon before subtracting a day — is that deliberate?`),
      },
    ],
    comments: [
      says(P.wei, `Yes, deliberate: subtracting 24 hours from midnight lands on the previous day in half the world's timezones on DST boundaries. Noon is far enough from both edges that nothing can reach across.`),
      says(P.dev, `Approving. One follow-up worth doing separately: the reminder rows already written before this merge still carry UTC-derived send times. There are 40-odd of them in the next 48 hours and I would rather recompute them than explain them.`),
      says(P.wei, `Recomputed by hand after merge. Meadow confirmed the evening batch arrived at 18:00 their time on the 24th.`),
    ],
  },
  {
    number: 24,
    author: P.karan,
    branch: "fix/slot-lock",
    title: "Lock the slot when a booking is confirmed",
    merge: true,
    body: `Fixes #2.

Two parts, in this order:

1. A unique index on \`(clinic_id, starts_at)\`. This is what makes double
   booking impossible rather than unlikely.
2. \`api/src/booking/slot-lock.js\` — a 90-second hold taken at the start of the
   booking flow, so the second receptionist is told "slot just taken" while
   they are still looking at an empty form, rather than after they have typed a
   patient's details in.

Availability now excludes held slots as well as booked ones.

The index is the correctness fix. The hold is the manners.`,
    files: [
      {
        path: "api/src/booking/slot-lock.js",
        date: "2026-02-18T11:05:00Z",
        message: "Hold a slot for the length of a booking attempt (#2)",
        content: `const HOLD_SECONDS = 90;

/**
 * Take an exclusive hold on a slot.
 *
 * Added for issue #2: two receptionists could both confirm the same 9:40 slot,
 * because availability was read and the booking written in two separate
 * transactions with a human pause in between. The unique index on
 * (clinic_id, starts_at) does the real work; this function is the friendly
 * error around it.
 */
export async function holdSlot(db, { clinicId, startsAt, serviceId }) {
  try {
    return await db.slotHolds.insert({
      clinicId,
      startsAt,
      serviceId,
      expiresAt: db.now() + HOLD_SECONDS * 1000,
    });
  } catch (err) {
    if (err.code === "23505") throw new Conflict("slot just taken");
    throw err;
  }
}

export const releaseHold = (db, hold) => (hold ? db.slotHolds.delete(hold.id) : null);

/** Called by the sweeper every 30s. Holds outlive a crashed request otherwise. */
export const expireHolds = (db) => db.slotHolds.deleteExpired(db.now());
`,
      },
      {
        path: "api/src/booking/create.js",
        date: "2026-02-18T11:12:00Z",
        message: "Hold the slot before taking the deposit (#2)",
        content: `import { holdSlot, releaseHold } from "./slot-lock.js";
import { isWithinOpeningHours } from "../clinics/opening-hours.js";
import { takeDeposit } from "../payments/deposits.js";
import { scheduleReminders } from "../reminders/schedule.js";

/**
 * Create an appointment.
 *
 * The order matters. We hold the slot before we touch money, because a failed
 * payment that leaves a booking behind is worse than a held slot that expires.
 */
export async function createBooking(db, { clinicId, patientId, startsAt, serviceId }) {
  const clinic = await db.clinics.byId(clinicId);
  if (!clinic) throw new NotFound("clinic");

  if (!(await isWithinOpeningHours(db, clinic, startsAt))) {
    throw new BadRequest("outside opening hours");
  }

  const hold = await holdSlot(db, { clinicId, startsAt, serviceId });
  try {
    const service = await db.services.byId(serviceId);
    const deposit = await takeDeposit(db, { patientId, service, clinic });

    const booking = await db.bookings.insert({
      clinicId,
      patientId,
      serviceId,
      startsAt,
      depositId: deposit?.id ?? null,
      state: "confirmed",
    });

    await scheduleReminders(db, booking, clinic);
    return booking;
  } catch (err) {
    await releaseHold(db, hold);
    throw err;
  }
}
`,
      },
      {
        path: "api/src/booking/availability.js",
        date: "2026-02-18T11:18:00Z",
        message: "Exclude held slots from availability (#2)",
        content: `/**
 * Free slots for one clinic on one day.
 *
 * This reads. It does not reserve anything, and it must not be treated as a
 * guarantee that the slot is still free by the time a booking arrives — that is
 * what \`slot-lock.js\` is for. Two receptionists looking at the same screen see
 * the same list, which is correct; it stops being correct the moment both of
 * them click.
 */
export async function availableSlots(db, { clinicId, serviceId, date }) {
  const clinic = await db.clinics.byId(clinicId);
  const service = await db.services.byId(serviceId);
  const hours = await db.openingHours.forDay(clinicId, date);
  if (!hours) return [];

  const taken = await db.bookings.between(clinicId, hours.opens, hours.closes);
  const held = await db.slotHolds.active(clinicId, hours.opens, hours.closes);

  const slots = [];
  for (let t = hours.opens; t + service.minutes <= hours.closes; t += clinic.slotMinutes) {
    const busy =
      taken.some((b) => overlaps(b, t, service.minutes)) ||
      held.some((h) => overlaps(h, t, service.minutes));
    if (!busy) slots.push(t);
  }
  return slots;
}

const overlaps = (a, start, minutes) =>
  a.startsAt < start + minutes && start < a.startsAt + a.minutes;
`,
      },
    ],
    reviewComments: [
      {
        path: "api/src/booking/slot-lock.js",
        body: says(P.priya, `90 seconds — where does that number come from?`),
      },
    ],
    comments: [
      says(P.karan, `From watching the front desk at a practice for an afternoon. The median time from opening the form to confirming is about 25 seconds; the tail is someone taking a phone number over the phone, which ran to just under a minute. 90 covers that and still expires within a patient's patience if the tab is abandoned.`),
      says(P.dev, `Approving. Note the sweeper is the only thing cleaning up holds from crashed requests, so if the sweeper stops we lose slots quietly. Alert on \`slot_holds\` older than five minutes, please, as a follow-up.`),
      says(P.karan, `Alert added.`),
    ],
  },
  {
    number: 25,
    author: P.ana,
    branch: "fix/webhook-idempotency",
    title: "Make the payment webhook idempotent",
    merge: true,
    body: `Fixes #3.

A \`payment_events\` table with a unique index on \`provider_event_id\`. We record
that we have seen an event **in the same transaction** as applying its effect,
so a retry finds the row and returns 200 without doing anything twice.

Verified by replaying the 17 March event log against staging: 61 duplicate
charge events, all correctly ignored, no deposit touched twice.

The provider documents at-least-once delivery. We built against at-most-once.
That is the whole bug.`,
    files: [
      {
        path: "api/src/payments/webhook.js",
        date: "2026-03-19T16:20:00Z",
        message: "Record every provider event before acting on it (#3)",
        content: `import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The payment provider's webhook.
 *
 * **Every handler here must be idempotent.** The provider retries on any
 * non-2xx and on a timeout, and it does not promise to stop at one retry. On
 * 17 March 2026 a provider timeout produced a retry storm and 61 patients were
 * charged twice — issue #3. The fix is the \`payment_events\` table and the
 * unique index on \`provider_event_id\`: we record that we have seen an event
 * before we act on it, in the same transaction.
 */
export async function handleWebhook(db, provider, req) {
  if (!verify(provider.secret, req.rawBody, req.headers["x-signature"])) {
    return { status: 401 };
  }

  const event = JSON.parse(req.rawBody);
  const first = await db.paymentEvents.insertIfAbsent({
    providerEventId: event.id,
    type: event.type,
    receivedAt: db.now(),
  });
  if (!first) return { status: 200, body: { duplicate: true } };

  switch (event.type) {
    case "charge.succeeded":
      await db.deposits.markPaid(event.data.depositId, event.data.chargeId);
      break;
    case "charge.failed":
      await db.deposits.markFailed(event.data.depositId, event.data.failureCode);
      break;
    case "refund.succeeded":
      await db.refunds.markComplete(event.data.refundId);
      break;
    default:
      break; // Unknown types are recorded and ignored, never 500'd back.
  }
  return { status: 200 };
}

function verify(secret, body, signature) {
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(String(signature ?? ""), "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
`,
      },
    ],
    reviewComments: [
      {
        path: "api/src/payments/webhook.js",
        body: says(P.sofia, `\`insertIfAbsent\` needs to be the same transaction as the effect or this is the same bug with a smaller window. Confirm it is?`),
      },
    ],
    comments: [
      says(P.ana, `Confirmed — both inside the request's transaction, and the test that would catch a regression is \`webhook.duplicate.test.js\`, which asserts the deposit row is untouched on the second delivery.`),
      says(P.sofia, `Then approving. One thought for later: \`payment_events\` grows forever. Not urgent at our volume, but somebody should put a retention window on it before it is a surprise.`),
      says(P.ana, `Noted, and related to #16 in a way I had not expected — we have no retention policy for anything.`),
    ],
  },
  {
    number: 26,
    author: P.tomas,
    branch: "feat/offline-sync-v2",
    title: "Offline sync, second attempt",
    merge: true,
    body: `The offline sync layer, rebuilt around **intents rather than state**.

The first attempt (PR #30) mirrored server state onto the device and reconciled
with last-writer-wins. It worked with one device and produced bookings nobody
had made with two, because last-writer-wins across clocks that disagree is a
coin toss. We abandoned it after three weeks rather than patching it.

This version:

- an append-only queue of intents, each with a client-generated UUID
- the server deduplicates on that UUID, so a replayed intent is a no-op
- conflicts surface to staff instead of being resolved silently
- the queue drains in order and stops at the first unresolved intent

\`mobile/app/src/sync/README.md\` records both attempts, because the next person
to look at this deserves to know it has been written twice and why.

This is the work that made 4.2 five weeks late. See #8 for the accounting.`,
    files: [
      {
        path: "mobile/app/src/sync/queue.js",
        date: "2026-04-01T17:30:00Z",
        message: "Offline sync, second attempt: intent queue with client UUIDs",
        content: `import { randomUUID } from "../util/uuid.js";

/**
 * The offline intent queue.
 *
 * Append-only, ordered, persisted to disk on every write. An intent is a thing
 * the user asked for — "book this slot", "cancel this booking" — never a
 * snapshot of state. That distinction is the whole difference between this and
 * the version that was thrown away; see README.md in this directory.
 */
export class SyncQueue {
  constructor(storage, api) {
    this.storage = storage;
    this.api = api;
    this.draining = false;
  }

  async enqueue(type, payload) {
    const intent = { id: randomUUID(), type, payload, queuedAt: Date.now(), attempts: 0 };
    await this.storage.append("sync-queue", intent);
    return intent.id;
  }

  /**
   * Drain in order, stopping at the first intent that is not resolved.
   *
   * Order is not an optimisation. Cancelling a booking that has not been
   * created yet is a 404, and retrying it forever is how the first version
   * managed to wedge itself.
   */
  async drain() {
    if (this.draining) return { drained: 0 };
    this.draining = true;
    let drained = 0;

    try {
      for (const intent of await this.storage.read("sync-queue")) {
        const result = await this.api.apply(intent, { idempotencyKey: intent.id });

        if (result.status === "applied" || result.status === "duplicate") {
          await this.storage.remove("sync-queue", intent.id);
          drained++;
          continue;
        }
        if (result.status === "conflict") {
          await this.storage.move("sync-queue", "sync-conflicts", intent.id);
          drained++;
          continue;
        }
        break; // Network or server error. Leave it queued and try again later.
      }
    } finally {
      this.draining = false;
    }
    return { drained };
  }
}
`,
      },
      {
        path: "mobile/app/src/sync/README.md",
        date: "2026-04-02T09:00:00Z",
        message: "Record what happened to the sync layer, twice",
        content: `# Offline sync

Staff use this app in treatment rooms with bad signal. The requirement is that
a booking taken offline is not lost and is not applied twice when the phone
comes back.

## What is here now

An append-only local queue (\`queue.js\`) of intents, each with a client-generated
UUID. On reconnect the queue is drained in order; the server deduplicates on
that UUID. Conflicts — the slot was taken while we were offline — surface to the
member of staff rather than being resolved silently.

## This is the second version, and the history matters

The first attempt (PR #30, opened 12 January 2026, abandoned 2 February after
three weeks) tried to mirror the server's state locally and reconcile with
last-writer-wins. It worked on one device. With two receptionists on two phones
in the same practice it produced bookings nobody had made, because
last-writer-wins with clocks that disagree is a coin toss with extra steps.

We stopped, rather than patching it. The second attempt (this one, PR #26,
merged 1 April 2026) inverted the model: send intents, not state, and let the
server stay the only place where truth lives.

The five weeks between the planned and actual ship dates for 4.2 are mostly
this. If you are reading the release notes instead, they say App Store review;
review took four days of the thirty-five. Issue #8 has the full accounting.

Whether a third rewrite is worth it is issue #9, and it is open. Nobody has
decided.
`,
      },
      {
        path: "mobile/app/src/booking/BookingScreen.js",
        date: "2026-04-01T17:35:00Z",
        message: "Queue the booking intent when offline",
        content: `import { useConnectivity } from "../net/useConnectivity.js";
import { useSyncQueue } from "../sync/useSyncQueue.js";

/**
 * The booking screen.
 *
 * Offline is a normal state here, not an error. If we are offline the intent is
 * queued and the row appears in the diary marked "pending"; when the queue
 * drains it either confirms or moves to conflicts, and staff are told which.
 * The one thing this screen must never do is claim a booking is confirmed
 * before the server has said so.
 */
export function BookingScreen({ clinic, slot, patient }) {
  const online = useConnectivity();
  const queue = useSyncQueue();
  const [state, setState] = useState("idle");

  async function confirm() {
    setState("saving");
    if (!online) {
      await queue.enqueue("booking.create", {
        clinicId: clinic.id,
        patientId: patient.id,
        startsAt: slot.startsAt,
        serviceId: slot.serviceId,
      });
      setState("queued");
      return;
    }
    try {
      await api.createBooking({ clinicId: clinic.id, startsAt: slot.startsAt });
      setState("confirmed");
    } catch (err) {
      setState(err.offline ? "queued" : "failed");
      if (err.offline) await queue.enqueue("booking.create", { clinicId: clinic.id });
    }
  }

  return <BookingForm state={state} online={online} onConfirm={confirm} />;
}
`,
      },
    ],
    reviewComments: [
      {
        path: "mobile/app/src/sync/queue.js",
        body: says(P.dev, `Strict ordering means one wedged intent blocks everything behind it. I know that is deliberate. I want it written down as a known cost rather than discovered by support in three months.`),
      },
      {
        path: "mobile/app/src/sync/README.md",
        body: says(P.priya, `This file is the most valuable thing in the PR and I would like more of the repository to look like it.`),
      },
    ],
    comments: [
      says(P.tomas, `Written down — it is now in #9 as one of the three known edges, along with conflicts being staff-visible and there being no server-side view of a device's queue.`),
      says(P.nadia, `Small thing from reading it fresh: \`drain()\` guards against re-entry with a boolean, which is fine on one thread, but the reconnect handler and the foreground handler can both call it within a tick of each other. They do here, on a flaky connection at app start.`),
      says(P.tomas, `Good catch and it is benign today — the second call returns \`{drained: 0}\` immediately. Left as is with a comment rather than adding a lock we do not need yet.`),
      says(P.priya, `Merging. For the record so that #8 has something to point at: this is the second time this layer has been built, and the first attempt is PR #30.`),
    ],
  },
  {
    number: 27,
    author: P.karan,
    branch: "feat/patient-phone-search",
    title: "Search patients by phone number",
    merge: true,
    body: `Fixes #6. Top of the Feature Request Log for two quarters.

\`phone_normalised\` is a generated column: digits only, leading zero and country
code dropped. Search tries phone first when the term is mostly digits, and falls
back to the existing trigram name search otherwise.

07700 900123, +44 7700 900123 and 7700900123 all find the same patient.`,
    files: [
      {
        path: "api/src/patients/search.js",
        date: "2026-05-11T10:05:00Z",
        message: "Search patients by phone number as well as name (#6)",
        content: `/**
 * Patient lookup for the front desk.
 *
 * Name search is trigram; phone search is exact on a normalised column, because
 * a receptionist reading a number off a caller display types it a different way
 * every time. \`phone_normalised\` strips everything but digits and drops a
 * leading country code, so 07700 900123, +44 7700 900123 and 7700900123 all
 * find the same patient. Issue #6.
 */
export async function searchPatients(db, clinicId, term) {
  const digits = term.replace(/\\D/g, "");

  if (digits.length >= 6) {
    const byPhone = await db.patients.byNormalisedPhone(clinicId, normalise(digits));
    if (byPhone.length) return byPhone;
  }
  return db.patients.searchByName(clinicId, term.trim(), { limit: 20 });
}

/** Drop a leading 0 or country code so stored and typed numbers compare equal. */
export function normalise(digits) {
  if (digits.startsWith("00")) return digits.slice(2).replace(/^\\d{1,3}/, "");
  if (digits.startsWith("0")) return digits.slice(1);
  return digits.length > 10 ? digits.slice(digits.length - 10) : digits;
}
`,
      },
    ],
    reviewComments: [
      {
        path: "api/src/patients/search.js",
        body: says(P.dev, `\`normalise\` taking the last 10 digits is a guess that happens to be right for the UK and Portugal and wrong for Australia, where mobiles are 9 after the leading zero. Meadow will find this.`),
      },
    ],
    comments: [
      says(P.karan, `Correct, and I would rather ship the UK/PT version now than block on a phone-number library. Filed as a follow-up on my own list; the failure mode is "no result", not "wrong patient", which is the right way round.`),
      says(P.marta, `Confirming the failure mode matters more than the coverage here. A receptionist who gets no result types the name. A receptionist who gets the wrong patient books an appointment for a stranger.`),
    ],
  },

  // ================================================================ open work
  {
    number: 28,
    author: P.dev,
    branch: "feat/per-clinic-branding",
    title: "Per-clinic branding — draft",
    draft: true,
    body: `Draft for #10. **Not ready, and the shape is still being argued about.**

Logo and colours per clinic, behind a \`branding\` feature flag. Booking page
reads them; the SMS sender name is deliberately **not** in here, because that is
per-country registration with the provider and it is weeks rather than days.

Open question in review: does branding live on the \`clinics\` row or in its own
table? Brightsmile will want group-level defaults roughly ten minutes after we
ship per-clinic, and one of these two answers makes that a migration.`,
    files: [
      {
        path: "api/src/clinics/branding.js",
        date: "2026-07-14T15:40:00Z",
        message: "Draft: per-clinic logo and colours behind a flag",
        content: `/**
 * Per-clinic branding. DRAFT — see #10 and the review on PR #28.
 *
 * Reads three columns off the clinic row: \`logo_url\`, \`brand_primary\`,
 * \`brand_secondary\`. Everything falls back to the Arkind defaults, so a clinic
 * that has set nothing looks exactly as it does today.
 *
 * What this deliberately does NOT do is change the SMS sender name. That is an
 * alphanumeric sender ID, it is registered per country with the provider, and
 * it is not permitted in every market we operate in. Shipping it badly means
 * messages silently not delivering, which is worse than a generic sender.
 */
const DEFAULTS = {
  logoUrl: "/static/arkind-mark.svg",
  primary: "#17695D",
  secondary: "#DCEBE8",
  displayName: null, // null => the clinic's own name
};

export function brandingFor(clinic, flags) {
  if (!flags.branding) return DEFAULTS;
  return {
    logoUrl: clinic.logoUrl ?? DEFAULTS.logoUrl,
    primary: clinic.brandPrimary ?? DEFAULTS.primary,
    secondary: clinic.brandSecondary ?? DEFAULTS.secondary,
    displayName: clinic.brandDisplayName ?? clinic.name,
  };
}

export const isBranded = (clinic, flags) =>
  Boolean(flags.branding && (clinic.logoUrl || clinic.brandPrimary));
`,
      },
    ],
    reviewComments: [
      {
        path: "api/src/clinics/branding.js",
        body: says(P.dev, `Three columns on \`clinics\` is the cheap version and I think it is the wrong one. Brightsmile have four local brands across forty practices; the moment they ask to set a brand once and apply it to ten clinics, this becomes a table and a backfill. Doing it as \`brand_profiles\` now costs a day.`),
      },
      {
        path: "api/src/clinics/branding.js",
        body: says(P.luca, `A day now against a migration later is only a good trade if the later thing happens. I would take the columns and accept the migration, because I am not confident per-clinic branding ships at all — it has been reprioritised twice.`),
      },
    ],
    comments: [
      says(P.dev, `Then we are disagreeing about the probability rather than the design, which is at least a smaller argument.`),
      says(P.elena, `From the account side: Joris asked about group defaults in the same sentence as he asked for branding, in June. It is not a hypothetical follow-up, it is the actual request.`),
      says(P.luca, `That does move me. Leaving the draft as it is until #10 gets a decision in H2 planning — I do not want to build the table version and have it sit unmerged for a quarter either.`),
    ],
  },
  {
    number: 29,
    author: P.dev,
    branch: "feat/reminder-queue",
    title: "Move reminders onto a queue — draft",
    draft: true,
    body: `Draft for #12. **Do not merge while #12 is unresolved.**

Replaces the 60-second cron in \`api/src/reminders/send.js\` with a worker
consuming a real queue: retries with backoff, a dead-letter, and concurrency
that is designed rather than accidental.

Sofia's counter-proposal in #12 — an advisory lock plus two columns on the
existing table — is not in this branch and may well be the better answer. This
exists so that the comparison is between two things that exist rather than
between one thing and a description.`,
    files: [
      {
        path: "api/src/reminders/queue-worker.js",
        date: "2026-07-22T10:15:00Z",
        message: "Draft: reminder worker with retries and a dead-letter",
        content: `/**
 * Reminder worker. DRAFT — see #12, which is unresolved.
 *
 * One worker, N concurrency, explicit retry policy. The point is not
 * throughput: the evening batch is ~900 messages and Postgres handles that
 * without noticing. The point is that today's concurrency safety comes from
 * running exactly one instance of the api process, which stops being true
 * during every deploy.
 */
const RETRIES = [30_000, 120_000, 600_000]; // 30s, 2m, 10m, then dead-letter.
const CONCURRENCY = 8;

export function startReminderWorker(queue, sms, db) {
  return queue.consume("reminders", { concurrency: CONCURRENCY }, async (job) => {
    const reminder = await db.reminders.byId(job.data.reminderId);
    if (!reminder || reminder.state !== "pending") return;

    // A reminder that arrives after its window has passed is worse than one
    // that never arrives. This check is the reason retries are bounded.
    if (db.now() > reminder.sendAt + 30 * 60 * 1000) {
      await db.reminders.mark(reminder.id, "expired");
      return;
    }

    try {
      await sms.send(job.data.phone, job.data.text);
      await db.reminders.mark(reminder.id, "sent");
    } catch (err) {
      const delay = RETRIES[job.attempts];
      if (delay === undefined) {
        await db.reminders.mark(reminder.id, "dead");
        throw new DeadLetter(err);
      }
      await job.retryIn(delay);
    }
  });
}
`,
      },
    ],
    reviewComments: [
      {
        path: "api/src/reminders/queue-worker.js",
        body: says(P.sofia, `The 30-minute expiry window is the best idea in this branch and it does not need a broker. I would take that one function into the current sender today, independently of how #12 lands.`),
      },
      {
        path: "api/src/reminders/queue-worker.js",
        body: says(P.dev, `Agreed on the window. On the broker: concurrency 8 against an SMS provider limit of 100/s is arbitrary — it should be derived from the provider limit, not picked.`),
      },
    ],
    comments: [
      says(P.priya, `Holding this. #12 has two credible positions and merging the branch would settle the argument by accident, which is the worst way to settle it.`),
      says(P.sofia, `No objection to it existing. I would rather review a real diff than a paragraph.`),
    ],
  },
  {
    number: 30,
    author: P.tomas,
    branch: "abandoned/offline-sync-v1",
    title: "Offline sync, first attempt",
    close: true,
    body: `**Closed unmerged, 2 February 2026, after three weeks.** Opened 12 January.

The approach: mirror the server's booking state onto the device, let the device
write to its own copy while offline, and reconcile on reconnect with
last-writer-wins on a timestamp.

It works with one device. It does not work with two, which is every practice
that has more than one receptionist:

- Device A and device B both hold a stale copy of the same slot.
- Both write. Both reconcile. Last-writer-wins picks the one with the later
  clock, and phone clocks disagree by seconds to minutes.
- The result is a booking nobody made, or a booking that quietly disappears.

We spent a week trying to fix the reconciliation before accepting the model was
wrong rather than the implementation. Stopping was the right call and I want it
recorded as a decision rather than as an abandonment.

The second attempt is PR #26: send intents, not state.

Kept for reference, not for merging. Issue #8 accounts for the 21 days.`,
    files: [
      {
        path: "mobile/app/src/sync/mirror.js",
        date: "2026-01-12T09:40:00Z",
        message: "First attempt: mirror server bookings to a local store",
        content: `/**
 * Local mirror of the server's booking state. ABANDONED — see PR #30.
 *
 * The device holds a copy of every booking for its clinic for the next 14 days,
 * refreshed on foreground and on a 5-minute poll. Writes go to the mirror
 * first, so the UI is instant, and reconcile.js pushes them up later.
 */
export class BookingMirror {
  constructor(storage) {
    this.storage = storage;
  }

  async replace(bookings, serverTime) {
    await this.storage.write("mirror", {
      bookings,
      syncedAt: serverTime,
      dirty: [],
    });
  }

  /** Apply a local change immediately and mark it for push. */
  async applyLocal(change) {
    const state = await this.storage.read("mirror");
    const next = merge(state.bookings, change);
    await this.storage.write("mirror", {
      ...state,
      bookings: next,
      dirty: [...state.dirty, { ...change, at: Date.now() }],
    });
    return next;
  }

  async dirty() {
    return (await this.storage.read("mirror")).dirty;
  }
}

const merge = (bookings, change) =>
  change.deleted
    ? bookings.filter((b) => b.id !== change.id)
    : [...bookings.filter((b) => b.id !== change.id), change];
`,
      },
      {
        path: "mobile/app/src/sync/reconcile.js",
        date: "2026-01-26T16:20:00Z",
        message: "First attempt: last-writer-wins reconciliation",
        content: `/**
 * Reconcile the local mirror with the server. ABANDONED — see PR #30.
 *
 * Last-writer-wins on \`updatedAt\`. This is the line that killed the design:
 * \`updatedAt\` on a local change is the **device's** clock, and two phones in
 * one practice do not agree. We tried server-stamping on receipt, which just
 * moves the race to arrival order, and a vector clock, which is a week of work
 * to make conflicts precise when what we actually needed was to not have them.
 */
export async function reconcile(mirror, api) {
  const dirty = await mirror.dirty();
  const server = await api.bookingsSince((await mirror.state()).syncedAt);

  const resolved = [];
  for (const local of dirty) {
    const remote = server.find((b) => b.id === local.id);
    if (!remote) {
      resolved.push(await api.push(local));
      continue;
    }
    // Here be dragons. See the note at the top of this file.
    resolved.push(local.at > Date.parse(remote.updatedAt) ? await api.push(local) : remote);
  }
  return resolved;
}
`,
      },
    ],
    reviewComments: [
      {
        path: "mobile/app/src/sync/reconcile.js",
        body: says(P.dev, `This is comparing a device clock to a server timestamp. On the test phones that is a few seconds; in a practice it will be whatever the handset's NTP last managed. I do not think this can be made correct.`),
      },
      {
        path: "mobile/app/src/sync/mirror.js",
        body: says(P.nadia, `(reading this months later, for context) — the mirror itself is fine. It is only the reconcile step that assumes the device can decide.`),
      },
    ],
    comments: [
      says(P.tomas, `Dev is right and I spent a week finding that out the expensive way. Server-stamping on receipt moves the race to arrival order rather than removing it, and a vector clock makes the conflicts precise when the actual requirement is to not have conflicts at all.`),
      says(P.priya, `Closing it rather than parking it. A branch that is "paused" gets revived by someone who did not read this thread.`),
      says(P.tomas, `Closed, unmerged, 2 February. Starting again on the intent model — that becomes PR #26.`),
    ],
  },
];
