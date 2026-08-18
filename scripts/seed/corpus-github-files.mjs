// The repository files.
//
// Written, not cloned, for a measured reason: GitHub's REST code search does
// not serve private repositories at all (NOTES.md §4e — zero hits and
// `incomplete_results: true`, for every token class, on repos five minutes to
// two months old). A large third-party codebase would therefore be bulk Badger
// cannot search, and it would contradict every issue we write about it.
//
// So the files are sized to a single job: **every issue that names a file has a
// file to name.** They are reachable through `github_file` on a known path and
// through `github_commits`, which is exactly how the agent uses them — never
// through search. Anything that has to be *found* rather than *fetched* belongs
// in an issue body instead.
//
// Commits are backdated with `author__date`, which CREATE_OR_UPDATE_FILE_CONTENTS
// accepts. Committer date is left alone; GitHub stamps it with the seeding time
// and will not be argued with. `git log` therefore shows the authored history
// and the API's `commit.author.date` agrees with the corpus.
//
// Two files are load-bearing beyond their content:
//
//   handbook/leave.md   — deliberately stale. It says five days' carry-over with
//                         no deadline; Drive's Leave Policy 2026 says ten days by
//                         31 March. Both are reachable. A search engine that
//                         returns only one of them is lying by omission.
//   mobile/app/src/sync/README.md
//                       — records both rewrites in prose, so the "why was it
//                         five weeks late" answer has a citation that resolves to
//                         code rather than to an argument about code.

/**
 * Files committed to `main` before any issue or pull request exists.
 *
 * `date` is the authored commit date. `message` is the commit message, written
 * as a changelog entry because `github_commits` is one of the agent's five
 * tools and a wall of "wip" would make it useless.
 */
export const FILES = [
  // ------------------------------------------------------------------ root
  {
    path: "README.md",
    date: "2026-01-05T09:00:00Z",
    message: "Describe the repository layout",
    content: `# arkind

Appointment booking for small clinics. Patients book online, get a reminder,
and leave a deposit; clinics get a diary that does not double-book.

    api/        Node service. Booking, availability, reminders, payments.
    mobile/     React Native app, iOS and Android, one codebase.
    docs/       Architecture, runbook, integrations.
    handbook/   How the company works. Leave, security, on-call, expenses.
    playbooks/  What to do when something is on fire.

Two sites: Bengaluru and Lisbon. Platform and Mobile are in Bengaluru,
Payments and Infrastructure in Lisbon, and the on-call rota spans both — see
\`handbook/on-call.md\`, and issue #13 for why that is contested.

## Running it

    npm install
    npm run dev            # api on :4000, seeded with two clinics
    npm test

The mobile app needs its own install under \`mobile/\`; see \`mobile/README.md\`.
`,
  },

  // ------------------------------------------------------------------- api
  {
    path: "api/src/booking/create.js",
    date: "2026-01-05T09:12:00Z",
    message: "Booking creation: validate, hold the slot, take the deposit",
    content: `import { isWithinOpeningHours } from "../clinics/opening-hours.js";
import { takeDeposit } from "../payments/deposits.js";
import { scheduleReminders } from "../reminders/schedule.js";

/**
 * Create an appointment.
 *
 * Availability is checked by the caller. There is a window between that check
 * and this insert, and today nothing closes it.
 */
export async function createBooking(db, { clinicId, patientId, startsAt, serviceId }) {
  const clinic = await db.clinics.byId(clinicId);
  if (!clinic) throw new NotFound("clinic");

  if (!(await isWithinOpeningHours(db, clinic, startsAt))) {
    throw new BadRequest("outside opening hours");
  }

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
}
`,
  },
  {
    path: "api/src/booking/availability.js",
    date: "2026-01-05T09:20:00Z",
    message: "Availability: free slots for a clinic and service",
    content: `/**
 * Free slots for one clinic on one day.
 *
 * This reads. It does not reserve anything, and it must not be treated as a
 * guarantee that the slot is still free by the time a booking arrives. Two
 * receptionists looking at the same screen see the same list, which is correct;
 * it stops being correct the moment both of them click, and nothing downstream
 * of here does anything about that.
 */
export async function availableSlots(db, { clinicId, serviceId, date }) {
  const clinic = await db.clinics.byId(clinicId);
  const service = await db.services.byId(serviceId);
  const hours = await db.openingHours.forDay(clinicId, date);
  if (!hours) return [];

  const taken = await db.bookings.between(clinicId, hours.opens, hours.closes);

  const slots = [];
  for (let t = hours.opens; t + service.minutes <= hours.closes; t += clinic.slotMinutes) {
    if (!taken.some((b) => overlaps(b, t, service.minutes))) slots.push(t);
  }
  return slots;
}

const overlaps = (a, start, minutes) =>
  a.startsAt < start + minutes && start < a.startsAt + a.minutes;
`,
  },
  {
    path: "api/src/clinics/opening-hours.js",
    date: "2026-01-06T10:40:00Z",
    message: "Opening hours, including the per-clinic exception list",
    content: `/**
 * Is this instant inside the clinic's opening hours?
 *
 * Exceptions (bank holidays, the Thursday a practice closes at noon) override
 * the weekly pattern, which is why they are checked first.
 *
 * Times are UTC throughout. Every clinic is in the UK or Portugal, so the
 * difference is an hour at most and nobody books at 00:30.
 */
export async function isWithinOpeningHours(db, clinic, startsAt) {
  const local = utcParts(startsAt);

  const exception = await db.openingHourExceptions.forDate(clinic.id, local.date);
  if (exception) return exception.closed ? false : within(exception, local.minutes);

  const weekly = await db.openingHours.forWeekday(clinic.id, local.weekday);
  return weekly ? within(weekly, local.minutes) : false;
}

const within = (h, minutes) => minutes >= h.opens && minutes < h.closes;

const utcParts = (instant) => {
  const d = new Date(instant);
  return {
    date: d.toISOString().slice(0, 10),
    weekday: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
};
`,
  },
  {
    path: "api/src/reminders/schedule.js",
    date: "2026-01-07T08:30:00Z",
    message: "Schedule reminders 24h and 2h before an appointment",
    content: `/**
 * When to remind.
 *
 * Two reminders: one the evening before, one two hours ahead. The evening one
 * is pinned to 18:00 rather than "24 hours before", because a 7am appointment
 * would otherwise page a patient at 7am the day before.
 *
 * 18:00 of what, exactly, is UTC. Everyone is within an hour of it.
 */
export async function scheduleReminders(db, booking, clinic) {
  const day = new Date(booking.startsAt);
  day.setUTCDate(day.getUTCDate() - 1);
  day.setUTCHours(18, 0, 0, 0);

  const evening = day.getTime();
  const twoHours = booking.startsAt - 2 * 60 * 60 * 1000;

  const rows = [
    { kind: "evening_before", sendAt: evening },
    { kind: "two_hours", sendAt: twoHours },
  ].filter((r) => r.sendAt > db.now());

  return db.reminders.insertMany(
    rows.map((r) => ({ ...r, bookingId: booking.id, clinicId: clinic.id, state: "pending" })),
  );
}
`,
  },
  {
    path: "api/src/reminders/send.js",
    date: "2026-01-07T08:44:00Z",
    message: "Reminder sender: claim due rows, send, mark",
    content: `import { render } from "./templates.js";

const BATCH = 200;

/**
 * Send every reminder that is due.
 *
 * Runs on a 60-second cron. This is the design issue #12 wants to replace with
 * a queue, and the argument there is worth reading before changing anything
 * here: the cron is single-writer by accident (one instance, \`FOR UPDATE SKIP
 * LOCKED\`), and a queue would make the concurrency real.
 */
export async function sendDueReminders(db, sms, now = db.now()) {
  const due = await db.reminders.claimDue(now, BATCH);
  let sent = 0;

  for (const reminder of due) {
    const booking = await db.bookings.byId(reminder.bookingId);
    const clinic = await db.clinics.byId(reminder.clinicId);
    if (!booking || booking.state !== "confirmed") {
      await db.reminders.mark(reminder.id, "skipped");
      continue;
    }

    const patient = await db.patients.byId(booking.patientId);
    try {
      await sms.send(patient.phone, render(reminder.kind, { booking, clinic, patient }));
      await db.reminders.mark(reminder.id, "sent");
      sent++;
    } catch (err) {
      // Three attempts, then give up loudly. A reminder that arrives late is
      // worse than one that never arrives.
      await db.reminders.retryOrFail(reminder.id, err);
    }
  }
  return sent;
}
`,
  },
  {
    path: "api/src/reminders/templates.js",
    date: "2026-01-07T08:52:00Z",
    message: "Reminder message templates",
    content: `const TEMPLATES = {
  evening_before: (v) =>
    \`Hi \${v.patient.firstName}, a reminder of your \${v.service} at \${v.clinic.name} \` +
    \`tomorrow at \${v.time}. Reply CANCEL if you can no longer make it.\`,
  two_hours: (v) =>
    \`\${v.clinic.name}: your \${v.service} is at \${v.time} today. See you shortly.\`,
};

export function render(kind, { booking, clinic, patient }) {
  const at = new Date(booking.startsAt);
  const time = \`\${String(at.getUTCHours()).padStart(2, "0")}:\` +
    String(at.getUTCMinutes()).padStart(2, "0");
  return TEMPLATES[kind]({ patient, clinic, service: booking.serviceName, time });
}
`,
  },
  {
    path: "api/src/payments/webhook.js",
    date: "2026-01-08T11:50:00Z",
    message: "Payment provider webhook",
    content: `import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The payment provider's webhook.
 *
 * Signature-checked, then dispatched on type. Each handler applies the effect
 * to the deposit or refund row it names.
 */
export async function handleWebhook(db, provider, req) {
  if (!verify(provider.secret, req.rawBody, req.headers["x-signature"])) {
    return { status: 401 };
  }

  const event = JSON.parse(req.rawBody);

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
      break; // Unknown types are ignored, never 500'd back.
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
  {
    path: "api/src/payments/deposits.js",
    date: "2026-01-08T12:10:00Z",
    message: "Deposits: take, refund, and the no-show rules",
    content: `/**
 * Deposits.
 *
 * A deposit is 10% of the appointment value with a floor of EUR 5, set per
 * clinic and overridable per service. Whether that should be a percentage at
 * all is issue #15, which is open — do not treat the number here as settled
 * policy, only as what the code currently does.
 *
 * Refunds go back automatically when a patient cancels more than 24 hours
 * ahead. Inside 24 hours it is the clinic's call. The customer-facing promise
 * is five working days (Support / Refund Policy); issue #7 measured nine, and
 * the gap was the provider's payout schedule rather than anything here.
 */
export async function takeDeposit(db, { patientId, service, clinic }) {
  if (!clinic.depositsEnabled || service.depositExempt) return null;

  const amount = Math.max(clinic.depositMinimum ?? 500, Math.round(service.priceCents * 0.1));
  return db.deposits.create({ patientId, clinicId: clinic.id, amountCents: amount });
}

export async function refundDeposit(db, provider, depositId, { reason }) {
  const deposit = await db.deposits.byId(depositId);
  if (deposit.state !== "paid") throw new BadRequest("nothing to refund");

  const refund = await provider.refunds.create({
    chargeId: deposit.chargeId,
    idempotencyKey: \`refund-\${depositId}\`,
  });
  return db.refunds.create({ depositId, providerRefundId: refund.id, reason });
}
`,
  },

  // ---------------------------------------------------------------- mobile
  {
    path: "mobile/README.md",
    date: "2026-01-05T09:30:00Z",
    message: "Mobile app: how to build and what is in here",
    content: `# arkind mobile

React Native, one codebase for iOS and Android. Used by clinic staff, not by
patients — patients book on the web.

    src/booking/     The diary and the booking flow
    src/sync/        Offline queue. Read src/sync/README.md before touching it.
    src/net/         Connectivity detection
    src/patients/    Patient list and search

## Build

    npm install
    npm run android          # or: npm run ios
    npm run test

## Releases

Version numbers are set in \`app.json\` and the release is cut from \`main\`.
The process, including what to write in the store listing, is in
\`playbooks/releases.md\`. Android goes out through Play, iOS through App Store
Connect, and review times differ by a lot — see issue #8 before quoting either
of them as a reason for a date.
`,
  },
  {
    path: "mobile/app/src/net/connectivity.js",
    date: "2026-02-11T15:40:00Z",
    message: "Treat a lost connection as a state change, not an exception (#4)",
    content: `/**
 * Connectivity.
 *
 * Issue #4: the app crashed when it lost signal mid-booking, because the
 * booking screen awaited a fetch that never resolved and the unhandled
 * rejection took the screen down with it. Connectivity is now a state the UI
 * subscribes to, and every network call goes through a timeout.
 */
const TIMEOUT_MS = 8000;

export function watchConnectivity(netinfo, onChange) {
  let online = true;
  return netinfo.subscribe((state) => {
    const next = Boolean(state.isConnected && state.isInternetReachable !== false);
    if (next !== online) {
      online = next;
      onChange(online);
    }
  });
}

export async function withTimeout(promise, ms = TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new OfflineError()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class OfflineError extends Error {
  constructor() {
    super("offline");
    this.offline = true;
  }
}
`,
  },

  // ------------------------------------------------------------------ docs
  {
    path: "docs/architecture.md",
    date: "2026-01-09T11:00:00Z",
    message: "Architecture overview",
    content: `# Architecture

One Node service, one Postgres, one React Native app. Deliberately small: forty
people, one product, and nothing here is at a scale that needs anything else.

    clinic staff ──▶ mobile app (React Native) ──┐
    patients     ──▶ web booking page ───────────┼──▶ api (Node) ──▶ Postgres
                                                 │        │
                                    SMS provider ◀┘        └──▶ payment provider

## The pieces

**api** — HTTP, Node 22. Booking, availability, reminders, payments, patients.
Deployed as one process; there is no service mesh and there is not going to be
one this year.

**Postgres 15.** One primary. A reporting replica is planned — whether it goes
to 15 or 16 is issue #21, which is open and low stakes.

**Reminders** run on a 60-second cron inside the api process, claiming due rows
with \`FOR UPDATE SKIP LOCKED\`. This is single-writer because there is one
instance of the process, which is a fact about our deployment rather than a
property of the design. Issue #12 proposes moving it to a real queue; that is
open, and there are two positions in the thread.

**Payments** are a thin layer over the provider. We store no card data. The
webhook is idempotent on \`provider_event_id\` — see \`api/src/payments/webhook.js\`
and issue #3 for what happens when it is not.

**Mobile sync** is an offline intent queue. Read \`mobile/app/src/sync/README.md\`
before changing it; it has been written twice and the reasons are recorded.

## Timezones

Store UTC, display clinic-local, and every clinic carries an IANA timezone.
This was not true until March 2026 and issue #1 is what it cost.

## What we do not have

No message broker, no cache, no search cluster, no microservices. Every one of
those has been proposed at least once and the answer has been "not at forty
people" each time.
`,
  },
  {
    path: "docs/runbook.md",
    date: "2026-01-09T11:20:00Z",
    message: "Runbook: the things that break and what to do",
    content: `# Runbook

On-call rota and escalation: \`handbook/on-call.md\`. Incident process:
\`playbooks/incident-response.md\`. This file is only the mechanics.

## Reminders have stopped going out

Symptom: \`reminders_sent_total\` flat for more than five minutes during the day.

1. Check the cron is running: \`SELECT max(claimed_at) FROM reminders;\`
2. Check the SMS provider status page before anything else. Two of the three
   times this has fired, it was them.
3. If rows are claimed but not sent, the sender is erroring per-row — check
   \`reminders.last_error\`, most recently a provider rate limit.
4. Reminders are not replayed automatically once their send window has passed.
   Sending a 24-hour reminder six hours late is worse than not sending it.

## Patients charged twice

Assume the webhook. Query \`payment_events\` for the \`provider_event_id\` and
count rows; more than one means the unique index is not doing its job and you
should page Payments. Refund immediately, apologise, then investigate — the
money going back is not the part that needs a decision. See issue #3, and the
17 March 2026 incident review.

## The app is crashing on launch after a release

Roll back the store release. Play allows a staged rollout halt; App Store
Connect needs a new build. Both are slower than you want them to be at the
moment you want them.

## Double bookings

Should be impossible since February 2026 (unique index on clinic_id, starts_at).
If it happens, capture both booking rows before doing anything else — the index
being absent on a replica is a different problem from the index not holding.
`,
  },
  {
    path: "docs/integrations.md",
    date: "2026-01-09T11:35:00Z",
    message: "Integrations: SMS, payments, calendar",
    content: `# Integrations

## SMS

One provider, used for reminders and for the cancel-by-reply flow. Rate limited
at 100 messages/second, which we have never approached; the evening batch peaks
around 900 messages in a minute.

Delivery receipts are recorded but not acted on. "Did the patient get it?" is
answerable in the provider's dashboard, not in ours — which is a gap that shows
up in support threads more often than it should.

## Payments

One provider. Deposits, refunds, and a webhook for state changes. We hold no
card data; the app never sees a PAN. Idempotency on our side is
\`payment_events.provider_event_id\`, on their side an \`idempotencyKey\` we send
on every mutating call.

Payouts to clinics are on the provider's schedule, T+3 to T+5 working days. This
is the reason refunds appeared to take nine days rather than the five the policy
promises — issue #7. The policy is a Support document; the schedule is theirs.

## Calendar

Read-only iCal feed per clinic, so practices can see the diary in whatever they
already use. No two-way sync, and no plans for one: a calendar that can create
bookings would need to respect deposits and opening hours, and at that point it
is the booking API with a worse interface.

## Apple Wallet

Proposed in issue #22, not built.
`,
  },

  // -------------------------------------------------------------- handbook
  {
    path: "handbook/leave.md",
    date: "2024-11-19T10:00:00Z",
    message: "Leave policy",
    content: `# Leave

25 days a year plus public holidays, pro rata in your first year.

Book it in the HR system and tell your team lead. There is no approval queue —
if the team can cover it, take it.

## Carry-over

**Up to 5 days may be carried into the next year.** There is no deadline for
using carried days; they sit in your balance until you take them.

Anything above 5 days is lost at the end of December. If you are heading for
that, your lead should be helping you spend it rather than watching it expire.

## Sick leave

Tell your lead, and do not work. There is no cap and we do not count.

## Parental leave

Six months at full pay for the primary carer, twelve weeks for the secondary,
in both sites. Talk to People at least three months ahead so cover can be
planned properly.
`,
  },
  {
    path: "handbook/security.md",
    date: "2026-01-12T09:15:00Z",
    message: "Security handbook: access, devices, patient data",
    content: `# Security

We hold patient names, phone numbers, and appointment times. That is medical-
adjacent personal data in two jurisdictions, and it is the reason for most of
what follows.

## Access

Least privilege, requested in writing, approved by the system owner. Ravi keeps
the Access Register — it is in Drive under Security & Access, and it is the
record, not this page.

Production database access is named-individual only, time-boxed to 24 hours,
and requires a second approver. "I need to check something" is not a reason;
"I am debugging INC-2026-03-17 and need to read payment_events" is.

## Devices

Full-disk encryption, screen lock at five minutes, and no patient data on a
personal machine. The mobile app on a staff phone is fine — that is the product.

## Patient data

Never in a ticket, never in Slack, never in a commit message. Reference the
booking id. If a customer sends us a spreadsheet of patients because they are
migrating, it goes in the shared Drive folder for that customer and is deleted
when the migration is done.

How long we keep records after a clinic leaves is issue #16, and it is open.
The honest position today is that we have not deleted anything.

## Reporting something

Tell Ravi or Priya. There is no form and there is no blame for reporting.
`,
  },
  {
    path: "handbook/on-call.md",
    date: "2026-01-12T09:30:00Z",
    message: "On-call: rota, hours, and what counts as a page",
    content: `# On-call

One engineer at a time, one week at a time, across both sites.

## Hours

07:00–22:00 clinic-local across our customer base, which in practice means
06:00–21:00 UTC. Nothing pages overnight; the reminder batch is the only thing
that runs then, and a failed batch is a morning problem.

## What pages

- Booking or availability returning 5xx above 1% for five minutes
- Reminders not sent for fifteen minutes inside the window
- Any payment webhook failure that is not a duplicate
- A customer-reported outage confirmed by support

## What does not

Single-clinic issues, anything a customer can work around for an hour, and
anything found by reading logs at midnight for fun.

## The rota

Generated a quarter ahead and kept in Drive (On-call Rota Q3). Swaps are between
the two people involved; tell the channel so the rota stays true.

The rota currently falls unevenly across the two sites, and issue #13 is the
open complaint about it. Nothing here should be read as that having been
settled.
`,
  },
  {
    path: "handbook/expenses.md",
    date: "2026-01-12T09:40:00Z",
    message: "Expenses",
    content: `# Expenses

Spend what you would spend if it were yours, and tell us about it within 30 days.

- **Travel** — book economy, book early. Rail over air where the journey is
  under five hours.
- **Equipment** — a laptop, a monitor, a chair, a keyboard. Ask Ravi; there is
  stock in both offices.
- **Meals while travelling** — reasonable, itemised, no per diem.
- **Conferences** — one a year, ask your lead. If you speak, we pay regardless.

Claims go in the HR system with a photo of the receipt. No receipt, no claim;
this is a tax rule rather than a trust position.

Anything above EUR 500 needs your lead's approval first, not after.
`,
  },

  // ------------------------------------------------------------- playbooks
  {
    path: "playbooks/incident-response.md",
    date: "2026-01-14T13:00:00Z",
    message: "Incident response",
    content: `# Incident response

## Severity

**SEV1** — customers cannot book, or money is wrong. Page immediately.
**SEV2** — degraded for some customers, or a feature is down. Working hours.
**SEV3** — cosmetic, or one clinic. Ticket.

Money being wrong is always SEV1 even if it is one patient. It is the only
thing we do that a clinic cannot undo themselves.

## During

1. One incident lead. They do not fix; they decide and communicate.
2. Post in #incidents at the start, then every 30 minutes even when there is
   nothing to say. Silence is read as "it is worse than they are admitting".
3. Support tells customers something within 30 minutes of a SEV1. What we tell
   them is in \`playbooks/support-escalation.md\`.
4. Stop the bleeding before you find the cause. Rolling back is not defeat.

## After

A written review within five working days, blameless, with a timeline and the
actions. It goes to the team; a customer-facing version goes to any customer who
asked, and that version is written by Support with Engineering's sign-off — see
the 17 March 2026 review for what that looks like in practice.

The customer-facing version says less. It must not say anything untrue, and the
line between those two is the whole job.
`,
  },
  {
    path: "playbooks/releases.md",
    date: "2026-01-14T13:20:00Z",
    message: "Release process for api and mobile",
    content: `# Releases

## api

Continuous. Merged to \`main\`, tests pass, it deploys. Roll forward; the rollback
is a revert commit.

Do not deploy on a Friday after 15:00 UTC, and do not deploy during the evening
reminder batch (17:30–19:00 clinic-local for the bulk of customers).

## mobile

Every six to eight weeks, both stores at once.

1. Cut from \`main\`, bump \`app.json\`, tag \`mobile-vX.Y\`.
2. Internal build to the team for two days.
3. Staged rollout on Play: 10%, 50%, 100% over four days.
4. App Store Connect submission at the same time as the Play upload.

**Store review is not the long pole and should not be described as one.** Our
median review time over 2025–26 is under two days on Play and four on App Store
Connect. If a release is late, the reason is almost always upstream of
submission — see issue #8, which exists because a release note said otherwise.

## Release notes

Written by Product, reviewed by Support, and they go out to customers. Say what
changed and what it means for a clinic. Do not use them to explain schedule
decisions to an audience that did not know the schedule.
`,
  },
  {
    path: "playbooks/support-escalation.md",
    date: "2026-01-14T13:40:00Z",
    message: "Support escalation paths and what we may promise",
    content: `# Support escalation

## Who to reach

| Area | First | Then |
|---|---|---|
| Booking, availability, diary | Platform (Dev) | Priya |
| Reminders, SMS | Platform (Wei) | Priya |
| Payments, deposits, refunds | Payments (Ana) | Priya |
| Mobile app | Mobile (Tomas) | Priya |
| Access, accounts, logins | Ravi | Priya |

Escalate with the clinic name, the booking id, what the customer saw, and when.
Not a screenshot of a screenshot.

## What support may promise

- A refund of a deposit, immediately, no approval needed.
- A named engineer looking at it today, if it is SEV1 or SEV2.
- A written update by a stated time, which we then meet.

## What support may not promise

- A date for a fix. Ever. Say "I will tell you on Thursday what we know."
- Account credit. That is Elena or Sam, and the Refund Policy in Drive is the
  boundary — outages are not refundable under it.
- A feature. The Feature Request Log is where these go.

That third one has been broken at least once, in writing, and the customer
quoted it back. If you are about to offer credit to keep an account, ask first.
`,
  },
];
