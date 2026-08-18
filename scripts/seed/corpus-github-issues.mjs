// Issues 1–22.
//
// Issues are where the corpus keeps everything that has to be *found* rather
// than fetched, because private-repo issue search reaches body text and comment
// text while private code search reaches nothing at all (NOTES.md §4e–§4i).
// That is not a workaround dressed up as a design: it is also true of a real
// company, where the tidy document says one thing and the thread underneath it
// says what actually happened.
//
// Two properties this file is built to guarantee, both of which the agent is
// judged on:
//
//   Closed issues are settled facts. #1–#7. The agent may state them plainly.
//   Open issues are arguments. #8–#22. Several have two named positions and no
//   conclusion, and reporting any of them as a decision is a wrong answer. #9
//   ("do we rewrite the sync layer a third time?") exists for exactly that test.
//
// Numbering is load-bearing. GitHub draws issues and pull requests from one
// sequence, so all 22 issues must be created before the first pull request, and
// PRs then take 23–30. The seeder enforces the order; do not reorder this array
// without reading `scripts/seed-github.mjs`.
//
// Authorship is carried in the text. Every issue and comment is created by the
// single account holding the token, so the speaker is named — `**Dev:** ...` —
// the same way the Drive corpus names comment authors, and for the same reason.

import { P, C, CUSTOMERS, FACTS, says } from "./company.mjs";

const { release42: R, marchOutage: O } = FACTS;

/**
 * Issues, in number order. `number` is documentation: the seeder relies on
 * array order and asserts the number GitHub actually assigned matches.
 *
 * `state: "closed"` is applied after the comments are written, so the thread
 * reads in order and the closing comment is the last thing in it.
 */
export const ISSUES = [
  // =========================================================== closed: facts
  {
    number: 1,
    title: "Reminder texts sent at 3am to Australian clinics",
    labels: ["bug", "reminders"],
    state: "closed",
    body: `Reported by ${C.bec.name} at ${CUSTOMERS.meadow.name} on 3 March.

Their patients are getting the evening-before reminder at around 03:00 local.
Meadow are in Melbourne. We are sending at 18:00 **UTC**, which is 05:00 the
next morning in AEDT — and the two-hour reminder is worse, because it fires
against a UTC-derived appointment time that is eleven hours out.

Root cause: \`api/src/reminders/schedule.js\` does its arithmetic in UTC and
there is no clinic timezone anywhere in the schema. This was invisible for
three years because every customer was in the UK or Portugal.

This is not a rounding error to a clinic. Their patients think the practice
texted them in the middle of the night.`,
    comments: [
      says(P.wei, `Confirmed on staging with a clinic row forced to Australia/Melbourne. Both reminder kinds are wrong, and the two-hour one can fire *after* the appointment. Nothing about this degrades gracefully.`),
      says(P.marta, `Meadow have paused reminders on their account for now. That is not a fix — they picked us partly for the reminders — but it stops the 3am texts today. Bec has been very good about it, which is more than we deserve here.`),
      says(P.dev, `The fix is a \`timezone\` column on clinics and a rule that we never format a time without one. Backfilling is easy: everyone except Meadow is Europe/London or Europe/Lisbon and Meadow is the reason we noticed.`),
      says(P.priya, `Do the column and the rule together. If we add the column and leave three call sites doing UTC arithmetic we will be back here with a different customer.`),
      says(P.wei, `PR #23 merged and shipped 24 March. \`api/src/clinics/timezone.js\` now owns every conversion and \`schedule.js\` goes through it. Meadow turned reminders back on the same day and confirmed the evening batch arrived at 18:00 their time. Closing.`),
    ],
  },
  {
    number: 2,
    title: "Two receptionists can confirm the same slot",
    labels: ["bug", "booking"],
    state: "closed",
    body: `Northgate Physio reported it and we have now reproduced it: two members of
staff, two devices, the same 9:40 slot, both told the booking was confirmed.

Availability is read in one transaction and the booking written in another, with
a human pause in between while somebody takes a patient's details. There is
nothing stopping the second write. \`api/src/booking/availability.js\` is honest
about being a read, but nothing downstream acts on that.

Two patients arriving for the same appointment is the kind of failure a practice
remembers.`,
    comments: [
      says(P.dev, `A unique index on (clinic_id, starts_at) fixes the data. It does not fix the experience — the loser of the race gets a 500 while typing a patient's phone number in.`),
      says(P.karan, `So hold the slot at the start of the booking flow and release it if they abandon. 90 seconds is enough for the form and short enough that a fat-fingered close does not block the slot for the afternoon.`),
      says(P.dev, `Agreed, but the index is what makes it correct. The hold is what makes it pleasant. Doing only the hold would be the same bug with a smaller window.`),
      says(P.priya, `Both, then. Index first so the data cannot be wrong, hold second so nobody notices.`),
      says(P.dev, `PR #24 merged. \`api/src/booking/slot-lock.js\` plus the unique index, and the second confirm now gets "slot just taken" instead of a 500. Northgate reproduced their original sequence and got the polite version. Closing.`),
    ],
  },
  {
    number: 3,
    title: "Card charged twice when the payment webhook retries",
    labels: ["bug", "payments", "sev1"],
    state: "closed",
    body: `From the ${O.date} incident (INC-2026-03-17). The provider timed out on our
webhook endpoint for about three minutes and then retried everything it had
queued. We processed each retry as a new event.

**${O.doubleCharges} patients were charged twice.**

\`api/src/payments/webhook.js\` had no record of which events it had already
seen. Every handler was written as though delivery were exactly-once, which no
webhook has ever been.

Refunds went out the same day. The engineering question is why this was possible
at all.`,
    comments: [
      says(P.ana, `Owning this. The provider documents at-least-once delivery on the first page and we built against at-most-once. That is on us and not on them.`),
      says(P.marta, `Support view: we found out from Clearview, not from monitoring. A patient rang their practice about the second charge and the practice rang us. We should not be learning about duplicate charges from the customer's customer.`),
      says(P.ana, `Fair, and I have added an alert on more than one charge per deposit id in a 24-hour window. It would have fired at 09:19 on the 17th, about four minutes in.`),
      says(P.sam, `${O.doubleCharges} people had money taken twice by a company they have never heard of. Whatever we write for customers about this incident, it does not get to be vague about that part.`),
      says(P.ana, `PR #25 merged: \`payment_events\` with a unique index on \`provider_event_id\`, recorded in the same transaction as the effect. Replayed the 17 March event log against it in staging — 61 duplicates, all correctly ignored. Closing.`),
    ],
  },
  {
    number: 4,
    title: "App crashes when it loses signal mid-booking",
    labels: ["bug", "mobile"],
    state: "closed",
    body: `Treatment rooms have bad signal. If the connection drops between opening the
booking form and confirming, the app does not show an error — it closes.

The confirm handler awaits a fetch with no timeout, the promise never settles,
and the unhandled rejection takes the screen down. Staff then reopen the app and
have no idea whether the booking exists.

This is the first thing that made us look properly at the sync layer, and it is
worth reading alongside #8: the crash is a symptom of the app treating offline
as an exception rather than as a normal state a clinic is in several times a
day.`,
    comments: [
      says(P.tomas, `Reproduced in the lift in the Bengaluru office, which is now an official test environment.`),
      says(P.nadia, `(reading this later as background) — is the fix the timeout, or the queue?`),
      says(P.tomas, `Both, in that order. \`mobile/app/src/net/connectivity.js\` landed in February and stopped the crash: every network call has an 8s timeout and connectivity is a subscribed state rather than a thrown error. The queue is the bigger answer and it is PR #26, months later. Closing this one on the crash.`),
    ],
  },
  {
    number: 5,
    title: "Patients can book outside opening hours",
    labels: ["bug", "booking"],
    state: "closed",
    body: `A patient booked a 19:30 appointment at a practice that closes at 18:00.

Opening hours were checked in the web UI and nowhere else, so anything hitting
the API directly — including our own mobile app — skipped the check. Bank
holiday exceptions were not checked at all.`,
    comments: [
      says(P.karan, `Moved into \`api/src/clinics/opening-hours.js\` and called from \`createBooking\`, with exceptions taking priority over the weekly pattern. Also caught three clinics with a Thursday half-day nobody had encoded.`),
      says(P.marta, `Practices have been asking for the half-day thing for a year. Nice accidental fix.`),
    ],
  },
  {
    number: 6,
    title: "Staff cannot find a patient by phone number",
    labels: ["enhancement", "booking"],
    state: "closed",
    body: `Top of the Feature Request Log for two quarters. A patient rings, the
receptionist has a number on the display and a name they cannot spell, and
search only does names.

Should be exact match on a normalised column: strip non-digits, drop the leading
zero or country code, so 07700 900123 and +44 7700 900123 are the same patient.`,
    comments: [
      says(P.luca, `31 clinics have asked for this by name. It is the single most requested thing that is also small.`),
      says(P.karan, `PR #27, \`api/src/patients/search.js\`. Phone first when the term is mostly digits, name search otherwise. Shipped in the May release.`),
      says(P.marta, `Two practices emailed to say thank you, unprompted, which has happened maybe four times ever.`),
    ],
  },
  {
    number: 7,
    title: "Deposit refunds take nine days, not five",
    labels: ["payments", "support"],
    state: "closed",
    body: `Our Refund Policy says deposits are returned within **${FACTS.refunds.policyWorkingDays} working days**.
Measured across Q1: median **${FACTS.refunds.measuredDays} working days**, worst case fourteen.

The refund call succeeds immediately. What takes the time is the provider's
payout schedule, T+3 to T+5, and then the patient's bank. None of that is in our
code and all of it is in our promise.`,
    comments: [
      says(P.ana, `Nothing to fix in \`api/src/payments/deposits.js\` — the refund is created within seconds. The number in the policy was written by someone reading our code rather than the provider's payout terms.`),
      says(P.marta, `Then the policy is wrong and we should change the policy, not keep explaining it one angry practice at a time. "Up to ten working days" is true and boring.`),
      says(P.sam, `Change it. A promise we meet 40% of the time is worse than a slower promise we always meet.`),
      says(P.marta, `Refund Policy in Drive updated to ten working days. Closing — the engineering side of this was never broken, which is worth recording somewhere findable.`),
    ],
  },

  // ========================================================= open: arguments
  {
    number: 8,
    title: "Android 4.2 shipped five weeks late — what actually happened",
    labels: ["retro", "mobile"],
    state: "open",
    body: `Planned **${R.planned}**. Shipped **${R.actual}**. That is ${R.slipDays} days,
${R.slipWeeks} weeks, on a release we had told at least one customer was coming
in early March.

I want the accounting written down here before anyone's memory improves.

**Where the ${R.slipDays} days went**

| | days |
|---|---|
| First sync rewrite, abandoned (PR #30, ${R.syncAttemptOne.opened} → ${R.syncAttemptOne.closedUnmerged}) | 21 |
| Second sync rewrite (PR #26) beyond its estimate | 7 |
| Internal build + staged rollout | 3 |
| **App Store review** (submitted ${R.appStoreSubmitted}, approved ${R.appStoreApproved}) | **${R.appStoreReviewDays}** |

So: **${R.appStoreReviewDays} of ${R.slipDays} days were store review.** The rest
was us writing the offline sync layer twice. PR #30 is still there, closed and
unmerged, which is the clearest evidence of it that exists.

The release notes say the delay was App Store review. That is not what happened.
I am not proposing we rewrite the customer-facing note; I am proposing we stop
believing it internally.`,
    comments: [
      says(P.tomas, `The first attempt was my call and I would make the same call again with the information I had. Mirroring server state locally is the obvious design and it is what every tutorial shows. It fails on two devices in one practice, and we did not have two devices in one practice in the test setup until week three.`),
      says(P.priya, `Nobody is looking for a culprit. The thing I want out of this is that we stopped after three weeks rather than after eight, and that decision is not written down anywhere except in a closed PR. That is the reusable part.`),
      says(P.nadia, `Reading this as the newest person on the team: the sync README (\`mobile/app/src/sync/README.md\`) was the single most useful file in the repo for me, and it exists because of this. Worth saying.`),
      says(P.luca, `I wrote the release note wording and I will defend part of it: the note goes to four hundred practices who never knew there was a March date. "We rewrote our sync layer twice" is not information to them, it is anxiety. But "delayed by App Store review" was the wrong way to say less, because it is not true. "Took longer than we planned" would have cost nothing.`),
      says(P.sam, `Leaving this open deliberately. It is the most useful thing in the repository for anyone trying to understand how we actually work, and closing it would file it away.`),
    ],
  },
  {
    number: 9,
    title: "Do we rewrite the sync layer a third time?",
    labels: ["mobile", "discussion"],
    state: "open",
    body: `The intent queue (PR #26) works. It is also the second design and it has known
edges:

- Conflicts surface to staff, and staff mostly do not know what to do with them.
  We have 40-odd conflict rows a week across the base and no idea how many are
  resolved correctly.
- The queue drains strictly in order, so one wedged intent blocks everything
  behind it until someone force-clears it.
- There is no server-side view of what a device has queued, so support cannot
  answer "is my booking going to appear?"

A third version would be CRDT-ish: server-authoritative merge, no user-visible
conflicts, and a queue the server can inspect.

**Nothing has been decided. Do not read this issue as a plan.**`,
    comments: [
      says(P.tomas, `In favour, with a caveat: I am the person who has been wrong about this twice, so weight my opinion accordingly. The ordering constraint is the bit that actually hurts.`),
      says(P.dev, `Against, for now. The current design's failures are visible and manual. The proposed design's failures would be invisible and automatic. I would rather have 40 conflict rows a week that a human looks at than a silent merge that quietly books the wrong slot.`),
      says(P.nadia, `A middle option nobody has costed: keep the queue, make it out-of-order for independent intents, and add a server endpoint that lists a device's pending items. That is two weeks, not two months, and it removes the two complaints support actually receives.`),
      says(P.priya, `Nadia's version is the one I would fund if I had to choose today. I am not choosing today — 4.2 cost us five weeks and I am not opening a third sync project in the same year without a quarter to put it in.`),
      says(P.tomas, `Noted. Leaving open, unresolved, so nobody two quarters from now thinks we agreed to any of this.`),
    ],
  },
  {
    number: 10,
    title: "Brightsmile want per-clinic branding",
    labels: ["product", "customer"],
    state: "open",
    body: `${C.joris.name} raised it at the June QBR and has raised it twice since.
Brightsmile run ${CUSTOMERS.brightsmile.clinics} practices under four local brand names, and the booking
page shows "Arkind" and one logo for all of them.

Their ask: per-clinic logo, colours, and the practice's own name in the SMS
sender and the booking page title.

They are our largest account by some distance. That is a fact about the
decision, not an argument for it.`,
    comments: [
      says(P.elena, `They have not threatened anything and I do not want to imply they have. But this is the third quarter it has come up and "it's on the roadmap" is wearing out.`),
      says(P.luca, `The logo and colours are two days. The SMS sender name is not: it is per-country registration with the SMS provider, alphanumeric sender IDs are not permitted in every market we are in, and getting it wrong means messages silently not delivering. That part is weeks, and it is the part they actually care about.`),
      says(P.dev, `PR #28 has the logo/colours half working behind a flag. It is a draft and it has an unresolved review argument about where branding lives — clinic row or a new table — which matters more than it sounds because Brightsmile will want group-level defaults about ten minutes after we ship per-clinic.`),
      says(P.sam, `Not deciding this in the issue. It goes in the H2 planning conversation with the free tier and the queue work, because they are all competing for the same two people.`),
    ],
  },
  {
    number: 11,
    title: "No-show rate climbing since we changed reminder timing",
    labels: ["product", "reminders"],
    state: "open",
    body: `We moved the evening reminder from "24 hours before" to "18:00 clinic-local the
day before" in January, as part of the timezone work.

No-show rate across the base, from the monthly reporting:

    Dec  4.1%
    Jan  4.4%
    Feb  5.2%
    Mar  5.6%
    Apr  6.1%
    May  5.8%

That is a real move. What I cannot tell you is whether it is the reminder change,
the March outage, the 4.2 login problems, or the fact that we added 60 clinics in
the same window and new clinics always have a worse rate.`,
    comments: [
      says(P.luca, `The confound is severe enough that I would not act on this. Cohort it: clinics live before December only, and split by whether their appointments are mostly morning or afternoon. A 7am appointment reminded at 18:00 the previous evening is a 37-hour gap.`),
      says(P.wei, `The 37-hour thing is real and I had not thought about it. Morning appointments are the worst case of the new rule and the best case of the old one.`),
      says(P.marta, `Anecdotally, two practices have asked us to "put the reminders back how they were". Two out of four hundred is not data, but they both do early starts.`),
      says(P.luca, `Then that is the hypothesis and it is testable. No change until it is tested.`),
    ],
  },
  {
    number: 12,
    title: "Reminders should move onto a queue",
    labels: ["platform", "discussion"],
    state: "open",
    body: `\`api/src/reminders/send.js\` runs on a 60-second cron inside the api process and
claims rows with \`FOR UPDATE SKIP LOCKED\`. It is single-writer because we run
one instance, which is a fact about our deployment and not a property of the
design.

The evening batch is now ~900 messages inside one minute. The moment we run two
instances for any reason — a deploy overlap counts — the behaviour is untested.

Proposal: a real queue, one worker, retries and a dead-letter.`,
    comments: [
      says(P.dev, `In favour. My concern is not throughput, it is that "we are safe because there is one instance" is a sentence that stops being true during every deploy and nobody has checked what happens in that window.`),
      says(P.sofia, `Against, or at least against the version that adds a broker. That is a new piece of infrastructure to run, monitor and page on, for a workload of 900 messages a day. \`SKIP LOCKED\` **is** a queue; Postgres is already the thing we run. If the worry is two instances, take a session-level advisory lock and the worry is gone this afternoon.`),
      says(P.dev, `The advisory lock is a good short answer and I would take it today. It does not give us retries with backoff or a dead-letter, and those are the things that would have made the March SMS provider wobble a non-event rather than 40 minutes of manual replay.`),
      says(P.sofia, `Retries and a dead-letter are two columns and a WHERE clause. I am not disagreeing that we need them. I am disagreeing that we need RabbitMQ to have them.`),
      says(P.priya, `Two credible positions, no decision. PR #29 is a draft of the broker version and should not be merged while this is unresolved.`),
    ],
  },
  {
    number: 13,
    title: "On-call rota is unfair to Bengaluru",
    labels: ["people", "on-call"],
    state: "open",
    body: `On-call hours are 06:00–21:00 UTC, which is 11:30–02:30 in Bengaluru and
06:00–21:00 in Lisbon.

Everyone on the rota carries the same number of weeks. The Bengaluru half of the
rota carries them across the middle of their night.

Q3 rota: 8 of 13 weeks fall to Bengaluru engineers, because that is where most
of the engineers are.`,
    comments: [
      says(P.dev, `To be precise about what is being asked: not fewer weeks. A window that does not end at half past two in the morning.`),
      says(P.sofia, `The window exists because our customers are in Europe and Australia. Shortening it at the European end means nobody is on call when Brightsmile open at 07:00 London, which is our busiest hour of the day.`),
      says(P.ravi, `Follow-the-sun is the textbook answer and we do not have the headcount for it. Three infrastructure people cannot cover a European morning shift on their own.`),
      says(P.meera, `Two things that are not the rota and would help: on-call pay, which we do not have at all, and a written rule that a night page means you do not work the next morning. Neither needs a rota change and both need Sam.`),
      says(P.priya, `Agreed on both, and I have put them in front of Sam. The rota itself I do not have an answer for, and pretending otherwise in this thread would be worse than leaving it open.`),
    ],
  },
  {
    number: 14,
    title: "Clearview Dental gave notice — why?",
    labels: ["customer", "discussion"],
    state: "open",
    body: `${C.harriet.name} gave notice on ${FACTS.clearview.noticeGiven}, effective
${FACTS.clearview.effective}. Six clinics, EUR ${FACTS.clearview.arrEur} a year.

The Churn Review in Drive records the reason as **price**. Their notice email
says **the March outage and how it was handled**. Those are not the same thing
and I would like us to be honest about which it was, because the answer changes
what we do next.`,
    comments: [
      says(P.elena, `Price is what they said to me in April when I offered them the Group tier. It is also what practices say when they have decided to leave and would rather not have the conversation. I recorded it because it is what I was told.`),
      says(P.marta, `Their notice is three paragraphs and two of them are about March: the double charge to one of their patients, and the fact that they heard about it from the patient rather than from us. Harriet also names the refund taking nine days.`),
      says(P.sam, `So both, and the ordering matters. A practice that is happy does not leave over a price rise; a practice that has stopped trusting you goes looking at prices.`),
      says(P.elena, `I will accept that, and I will also point out that the health score in the churn sheet was falling from January — before the outage. Whatever happened started before March.`),
      says(P.marta, `Which is its own finding. If the sheet was already telling us and nobody acted on it, the process failed twice.`),
    ],
  },
  {
    number: 15,
    title: "Deposits: percentage or flat fee?",
    labels: ["product", "payments"],
    state: "open",
    body: `Today a deposit is 10% of the appointment value with a EUR 5 floor
(\`api/src/payments/deposits.js\`).

A EUR 40 physio session takes a EUR 5 deposit. A EUR 900 dental implant takes
EUR 90, and that is the one patients ring the practice about.

Options: keep it, flat fee per clinic, or a percentage with a cap.`,
    comments: [
      says(P.ana, `Any of the three is a day's work. This is entirely a product question and I would like it recorded that Payments is not the blocker.`),
      says(P.luca, `A cap is the obvious answer and it is also the one that quietly stops doing the job — the whole point of a deposit on a EUR 900 appointment is that it is large enough to make someone turn up.`),
      says(P.marta, `Practices are split cleanly by discipline. Dentists want a flat fee they can explain. Physios want the percentage because their appointments are cheap and EUR 5 already is the floor. Vets have not mentioned it.`),
      says(P.luca, `Then per-clinic choice is probably where this lands, which is also the most work to explain in the pricing page. No decision yet.`),
    ],
  },
  {
    number: 16,
    title: "How long do we keep patient records?",
    labels: ["policy", "security"],
    state: "open",
    body: `Raised by ${C.harriet.name} at Clearview during offboarding: what happens to
their patients' data now?

The honest answer today is **we have not deleted anything, ever.** Every booking,
patient name and phone number from every clinic that has ever used Arkind is
still in the primary database, including practices that left in 2022.

\`handbook/security.md\` says data goes when a migration is done. It says nothing
about what happens when a customer leaves, and nothing about a retention period.`,
    comments: [
      says(P.ravi, `Confirming the factual claim, because it is the uncomfortable part: no deletion job exists. There is no code path that removes a patient.`),
      says(P.sofia, `We are the processor and the clinic is the controller, so strictly the retention period is theirs to set and ours to honour. That does not get us anywhere, because none of them have set one and our contract does not ask.`),
      says(P.meera, `It also affects staff records and offboarding, which is a different regime again. I do not think one issue can hold both.`),
      says(P.sam, `Needs a lawyer, not a thread. Getting one — until then nobody should quote a retention period to a customer, because we do not have one.`),
    ],
  },
  {
    number: 17,
    title: "Support tickets spiked after 4.2",
    labels: ["support", "mobile"],
    state: "open",
    body: `Tickets by month:

    Jan  ${FACTS.support.monthlyTickets["2026-01"]}
    Feb  ${FACTS.support.monthlyTickets["2026-02"]}
    Mar  ${FACTS.support.monthlyTickets["2026-03"]}
    Apr  ${FACTS.support.monthlyTickets["2026-04"]}
    May  ${FACTS.support.monthlyTickets["2026-05"]}
    Jun  ${FACTS.support.monthlyTickets["2026-06"]}

March is the outage. April is 4.2, which shipped on the ${R.actual.slice(8)}th —
so most of that ${FACTS.support.monthlyTickets["2026-04"]} arrived in the last
three weeks of the month.

The dominant category is "cannot log in since the app updated". Brightsmile alone
opened eleven of them.`,
    comments: [
      says(P.rahul, `The login ones are one bug wearing a hat. The 4.2 upgrade dropped the stored session on Android when the sync migration ran, so staff were signed out with no explanation and assumed their password had changed. Half of them then reset it, which is the second ticket.`),
      says(P.tomas, `That is on the sync migration and I do not think we would have caught it in an internal build, because our test devices were all already signed in on a build that had run the migration.`),
      says(P.marta, `Two support people spent most of April on this. That has a cost we never put anywhere, and it is bigger than the engineering time the fix took.`),
      says(P.rahul, `Suggestion for the release playbook: an upgrade test from the *previous store build*, not from \`main\`. Nobody has picked that up.`),
    ],
  },
  {
    number: 18,
    title: "Should we offer a free tier?",
    labels: ["commercial", "discussion"],
    state: "open",
    body: `Single-practitioner clinics bounce off the EUR 39 Starter price. Elena has
counted 40-odd of them in the pipeline this year.

Proposal: free for one practitioner, one clinic, capped at 50 bookings a month,
email reminders only, no deposits.`,
    comments: [
      says(P.elena, `In favour. The people we lose at EUR 39 are not evaluating us against a competitor, they are evaluating us against a paper diary, and a paper diary is free.`),
      says(P.marta, `Against, on the grounds nobody costs properly: free users email support. A single-practitioner clinic with a booking problem needs exactly as much of Rahul's afternoon as Brightsmile does. Forty of them is a support hire.`),
      says(P.sam, `Both true. What would change my mind is a conversion number, and we do not have one because we have never had a free tier. Estimating it from other people's blog posts is not analysis.`),
      says(P.elena, `Then a time-boxed trial rather than a free tier? Different product decision, much easier to reverse.`),
      says(P.sam, `Maybe. Still open, still H2 planning.`),
    ],
  },
  {
    number: 19,
    title: "Second mobile engineer — hire or borrow?",
    labels: ["people", "mobile"],
    state: "open",
    body: `Mobile is Tomas, and since June, Nadia. Nadia is four weeks in.

4.2 was effectively one engineer for the load-bearing part, and #8 is what that
looked like. The options are hire a third, move someone from Platform, or accept
one release every eight weeks and stop pretending otherwise.`,
    comments: [
      says(P.priya, `Moving someone from Platform is not free — Platform is six people carrying booking, availability, reminders and the reporting work, and it is the team every incident lands on first.`),
      says(P.meera, `A React Native hire in Bengaluru is realistically eight to twelve weeks from opening the role. If the answer is hire, the answer needs to be now rather than after H2 planning.`),
      says(P.tomas, `Nadia will be independent well before a new hire would start, so the honest comparison is "third engineer in Q4" against "two engineers now, properly".`),
      says(P.sam, `Noted, not decided.`),
    ],
  },
  {
    number: 20,
    title: "Accessibility audit before the NHS pilot",
    labels: ["product", "compliance"],
    state: "open",
    body: `The NHS pilot conversation Elena is running has an accessibility requirement:
WCAG 2.2 AA on anything patient-facing, evidenced by an external audit.

That is the patient booking page, the confirmation flow, and the SMS content
rules. Not the staff app.

Nobody owns this. It has been in the roadmap doc since April with no name
against it, and the pilot conversation has a September date on it.`,
    comments: [
      says(P.luca, `Design has done the obvious internal pass — contrast, focus order, labels. An external audit is EUR 6–9k and four to six weeks of calendar time, and we have not booked one.`),
      says(P.elena, `The September date is theirs, not a hard deadline, but the audit is a gate and gates do not move because we were busy.`),
      says(P.sam, `Who owns it?`),
      says(P.luca, `That is the issue title.`),
    ],
  },
  {
    number: 21,
    title: "Postgres 15 or 16 for the reporting replica",
    labels: ["platform"],
    state: "open",
    body: `Standing up a read replica for the reporting queries, which are starting to
show up in the primary's slow log.

Primary is on 15. Options: match it at 15 and upgrade both later, or put the
replica on 16 and let it lead.`,
    comments: [
      says(P.sofia, `Match the primary. Logical replication across a major version works and is also one more thing that can be subtly wrong at 3am. Nothing in the reporting queries needs a 16 feature.`),
      says(P.karan, `No objection. I only raised it because the 16 planner is better on the group-by-heavy reports, and those are the exact queries this is for.`),
      says(P.sofia, `Measure it and I will happily be wrong. Until then, boring.`),
    ],
  },
  {
    number: 22,
    title: "Apple Wallet passes for appointments?",
    labels: ["product", "idea"],
    state: "open",
    body: `A patient books, gets a Wallet pass, and the pass updates if the appointment
moves. It is the sort of thing that makes a booking feel real.

Cost is not tiny: pass signing certificates, a push service for updates, and an
Android equivalent (Google Wallet) or an obvious gap on the platform most of our
patients use.`,
    comments: [
      says(P.luca, `I like it and I am suspicious of how much I like it. It is the kind of thing that looks good in a sales pitch and nobody has ever asked for.`),
      says(P.nadia, `Google Wallet's generic pass API is genuinely straightforward, and the update push is the same channel as the reminder. Apple's side is the certificate management, which is annoying rather than hard.`),
      says(P.tomas, `Sceptical. We have a reminder that arrives as a text message and gets read, and a Wallet pass that would sit behind two taps. Solve the no-show rate first (#11) and then ask whether this moves it.`),
    ],
  },
];
