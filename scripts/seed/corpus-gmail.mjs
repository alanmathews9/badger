// The Gmail half of the Arkind corpus — 15 threads, 52 messages, Jan–Jul 2026.
//
// Mail is the third version of events, and the one that catches the other two
// out. Drive holds what was written down and sent to customers; GitHub holds
// the argument the team had with itself; these threads hold **what was actually
// said to whom, and when**. Two of the demo's five cross-source questions are
// answerable from here and nowhere else:
//
//   "Did we tell Brightsmile it would be ready in March?"
//       Yes — `${FACTS.brightsmilePromise.wording}`, in writing, on 4 February,
//       eleven days before the team restarted the sync layer. Thread
//       `brightsmile-when`. Neither Drive nor GitHub records that this happened.
//
//   "What is our refund policy?"
//       Drive says outages are not refundable. Thread `clearview-refund` shows
//       Marta giving Clearview a month's credit for one anyway, with Priya's
//       agreement. The policy is not what the company does.
//
// ---------------------------------------------------------------------------
// Five of the fifteen are customer support threads, and they are here on
// purpose rather than as filler. They do three jobs at once: they put a
// customer's own words next to the engineering issue that shares no vocabulary
// with them (`northgate-same-slot` is issue #2 described by someone who has
// never heard the phrase "race condition"), they show what support promises as
// opposed to what policy allows, and they supply the ordinary traffic that
// retrieval has to discriminate against. `northgate-export` is deliberately
// mundane — one boring question with one correct answer.
// ---------------------------------------------------------------------------
//
// Threading is by RFC 2822 headers, not by subject: every message after the
// first carries In-Reply-To and a References chain, so a thread survives being
// imported out of order.
//
// The mailbox belongs to Priya Raghunathan, VP Engineering — see the note in
// `company.mjs` for why that choice is what makes a single mailbox coherent.
// Support mail reaches her because she is on `support@arkind.example`.

import { P, C, SUPPORT_ALIAS, FACTS } from "./company.mjs";

// ------------------------------------------------------------------- dates

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `2026-03-03T08:41+11:00` -> `Tue, 3 Mar 2026 08:41:00 +1100`.
 *
 * Written as a helper rather than as 52 hand-typed RFC 2822 strings because the
 * weekday has to agree with the date and a human typing "Mon, 3 Mar 2026" gets
 * it wrong roughly six times in seven. The offsets are real too: Bengaluru is
 * +0530 year round, Lisbon and the UK move to +0100 on 29 March 2026, and
 * Melbourne leaves +1100 for +1000 on 5 April. Nothing depends on that being
 * right — it is simply what the headers would say.
 *
 * `internal_date_source: "dateHeader"` in the seeder makes these the dates
 * Gmail sorts, searches and filters on, so "what happened in March" works.
 */
function rfc(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})([+-]\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error(`corpus-gmail: bad date "${local}"`);
  const [, y, mo, d, hh, mm, oh, om] = m;
  // Build from the wall-clock fields as if they were UTC, so getUTCDay() is the
  // weekday a reader in that timezone would name.
  const day = DAYS[new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDay()];
  return `${day}, ${+d} ${MONTHS[+mo - 1]} ${y} ${hh}:${mm}:00 ${oh}${om}`;
}

const IN = "+0530"; // Bengaluru
const PT_W = "+0000"; // Lisbon and the UK, winter
const PT_S = "+0100"; // Lisbon and the UK, summer
const AU_S = "+1100"; // Melbourne, daylight saving
const AU_W = "+1000"; // Melbourne, standard

const at = (stamp, zone) => rfc(`${stamp}${zone.slice(0, 3)}:${zone.slice(3)}`);

// ----------------------------------------------------------------- threads

/**
 * Threads, oldest first.
 *
 * Each message is `{ from, to, cc, date, body }`. `from`, `to` and `cc` are the
 * person objects from `company.mjs` — never a literal address, so a name or a
 * domain is changed in exactly one place.
 */
export const THREADS = [
  // ======================================================== Jan–Feb: the promise
  {
    id: "brightsmile-when",
    subject: "When can we tell our practices the new app is coming?",
    messages: [
      {
        from: C.joris,
        to: [P.tomas],
        cc: [P.priya, P.elena],
        date: at("2026-01-28T09:40", PT_W),
        body: `Tomas,

Our practice managers keep asking me when the new Android app lands. I have
been telling them "soon" since before Christmas and it is starting to sound
like I am avoiding the question.

I do not need a promise. I need something I can put in the January operations
note that will not embarrass me in February. Is there a month?

Joris van Dijk
Operations Director, Brightsmile Dental Group`,
      },
      {
        from: P.tomas,
        to: [P.priya],
        date: at("2026-02-02T11:05", IN),
        body: `Priya — Joris is asking again, and he is being reasonable about it,
which somehow makes it worse.

Where are we honestly? The offline sync branch is not converging. I have spent
three weeks on it and the queue design does not survive a real flaky
connection; I think we abandon it and start again rather than keep patching.

If we restart I cannot see how the app is out before April. What do I tell him?`,
      },
      {
        from: P.priya,
        to: [P.tomas],
        date: at("2026-02-03T18:22", IN),
        body: `Then abandon it. Three weeks is enough to know, and a fourth week
will not tell us anything the first three did not.

On Joris: do not give him a date you are deriving from a plan you have just
told me you do not believe. Give him a month with room in it, or give him
nothing and tell him why. He has been a customer since 2021 and he can hear
"we are rebuilding a piece of it and I would rather be late than wrong".

Your call — you own the relationship day to day. But be aware you are the only
one of us who will be quoted on it.`,
      },
      {
        from: P.tomas,
        to: [C.joris],
        cc: [P.priya, P.elena],
        date: at("2026-02-04T10:15", IN),
        body: `Joris,

Thanks for being patient about this.

We are targeting ${FACTS.brightsmilePromise.wording} for the Android release.
That is the version with offline booking, which is the piece your managers have
been asking for by name.

I would put it in the operations note as "expected ${FACTS.brightsmilePromise.wording}"
rather than a fixed day — there is a rebuild in there that I want room around.

Tomas Lindqvist
Lead, Mobile`,
      },
    ],
  },

  // ======================================================== Feb: the same slot
  {
    id: "northgate-same-slot",
    subject: "Two of us confirmed the same 9:40 slot",
    messages: [
      {
        from: C.owen,
        to: [SUPPORT_ALIAS],
        date: at("2026-02-10T08:52", PT_W),
        body: `Morning,

Something odd happened yesterday and it has happened once before. Two of us
were on the booking screen at the same time — me at the desk and Sarah on the
iPad in the back room — and we both took a 9:40 with Tom on Thursday. Both
screens said confirmed. Both patients got the text.

We only found out when they both turned up.

Is there a way to stop it doing that? We are only two rooms so we are often
both in the diary at once.

Owen Pritchard
Northgate Physio`,
      },
      {
        from: P.rahul,
        to: [C.owen],
        date: at("2026-02-10T14:30", IN),
        body: `Hi Owen,

Thank you for writing this up so clearly — "both screens said confirmed" is
exactly the detail we needed.

I have reproduced it here. If two people open the same slot before either of
them confirms, the second confirmation does not notice the first. It is not
about your setup or the iPad; it would happen on two desktops just the same.
Smaller clinics hit it more often precisely because you are both in the diary
at once.

Engineering have it logged and the fix holds the slot for the person who opened
it first, so the second screen will say it has gone rather than confirming on
top. It is in the next release.

Until then: if two of you are booking at once, a shout across the room is
unfortunately still the most reliable lock we have.

Rahul Desai
Arkind Support`,
      },
      {
        from: C.owen,
        to: [P.rahul],
        date: at("2026-02-11T09:05", PT_W),
        body: `That is a relief, I thought we were doing something wrong.

For what it is worth it has happened twice, not once — I checked with Sarah and
there was a Friday in January she had to ring someone back about. So it is not
as rare as I made it sound.

Owen`,
      },
    ],
  },

  // ======================================================== Feb: the wording
  {
    id: "internal-what-do-we-tell",
    subject: "Android 4.2 — what do we tell Brightsmile",
    messages: [
      {
        from: P.tomas,
        to: [P.priya, P.luca],
        date: at("2026-02-20T16:48", IN),
        body: `The sync rewrite is properly under way now and it is going better than
the first attempt, but it is not going to be finished in two weeks.

Realistically we are looking at the back half of March to be code complete, and
then store review on top. I do not think ${FACTS.brightsmilePromise.wording}
survives contact with that.

Raising it now rather than in three weeks.`,
      },
      {
        from: P.priya,
        to: [P.tomas, P.luca],
        date: at("2026-02-20T17:30", IN),
        body: `Noted, and thank you for raising it now.

The thing we have to hold onto: we told Joris ${FACTS.brightsmilePromise.wording}
in writing on 4 February. Not "around then", not verbally. It is in his inbox
and it will be in his operations note, which goes to forty practice managers.

So this is not a question of whether to tell him. It is a question of when, and
the answer to that is as soon as we believe the new date rather than as soon as
we have a nice way of saying it.`,
      },
      {
        from: P.luca,
        to: [P.priya, P.tomas],
        date: at("2026-02-23T10:12", PT_W),
        body: `Agreed on telling him early. Less sure about how much of the why he
gets.

"We are rebuilding the offline layer for the second time" is true and it is
also an invitation to ask what we were doing for the first three weeks of the
year. Could we frame it as a phased rollout — the release moves, but we give
Brightsmile early access to the build as soon as it is stable? Then the story
is something they receive rather than something they lose.

I am aware of how that sounds. I would still rather propose it and have it
argued down.`,
      },
      {
        from: P.sam,
        to: [P.priya, P.tomas, P.luca],
        date: at("2026-02-24T09:05", PT_W),
        body: `Argued down, gently.

We do not invent a reason. If Joris asks why, he is told there was rework in
the offline layer — he runs an operations team, he will not faint.

What we also do not do is volunteer a post-mortem to a customer. There is a
difference between not lying and narrating our internal problems into an
account we want to keep, and the line is: answer what is asked, accurately.

Tomas tells him, this week, with the real month in it.

Sam`,
      },
    ],
  },

  // ======================================================== Mar: 3am reminders
  {
    id: "meadow-3am",
    subject: "Our reminders are going out at 3am",
    messages: [
      {
        from: C.bec,
        to: [SUPPORT_ALIAS],
        date: at(`${FACTS.timezoneBug.reported}T07:15`, AU_S),
        body: `Hello,

We have had four complaints this week from clients getting their appointment
reminder in the middle of the night. One woman rang the emergency line at 3am
because she thought a text from the vet at that hour meant something had
happened to her dog.

It is every reminder, not some of them. They all seem to arrive between about
2am and 4am our time.

We are in Melbourne. I do not know if that is relevant but it feels like it
might be.

Bec Tran
Practice Manager, Meadow Veterinary`,
      },
      {
        from: P.rahul,
        to: [C.bec],
        cc: [P.wei, P.marta],
        date: at(`${FACTS.timezoneBug.reported}T11:40`, IN),
        body: `Bec,

I am sorry — that is a horrible way to find out about a bug, and the emergency
call is the part I would be most annoyed about in your position.

It is relevant that you are in Melbourne. I have reproduced it on a test clinic
set to your timezone: the evening reminder is being scheduled at 18:00 UTC and
sent at 18:00 UTC, which is 5am the next morning where you are. Every clinic we
have had until recently has been in the UK or Portugal, where that error is an
hour or two and invisible.

Wei is copied and picking this up now. I will come back to you with a date
rather than leaving you to chase.

Rahul`,
      },
      {
        from: P.wei,
        to: [P.rahul, P.marta],
        cc: [P.priya],
        date: at("2026-03-04T15:20", IN),
        body: `Confirmed, and it is worse than the reminders.

We have no per-clinic timezone at all. The whole service assumes UTC and then
formats times for display without converting, so opening hours comparisons are
wrong for Meadow too — they just have not noticed yet because their hours
happen to overlap.

Fixing it properly means storing an IANA timezone per clinic and routing every
human-facing conversion through one place. That is a bigger change than a
reminder patch and I would rather do it than special-case Australia.

Two to three weeks. Tracking as issue #${FACTS.timezoneBug.issue}.`,
      },
      {
        from: P.marta,
        to: [C.bec],
        cc: [P.rahul],
        date: at("2026-03-05T09:30", PT_W),
        body: `Bec,

Following up as promised, with the honest version.

The cause is that we never stored a timezone for your clinics — everything runs
on UTC, which is fine for our UK customers and eleven hours wrong for you. So
this is not a setting we can flip for you today; it is a change to how the
product handles time, and we are making it.

Wei's estimate is two to three weeks. In the meantime we have moved your
evening reminder to 07:00 UTC, which lands at 6pm your time. It is a bodge and
I would rather tell you it is a bodge than let you find out.

Marta Nowak
Lead, Customer Success & Support`,
      },
      {
        from: P.marta,
        to: [C.bec],
        cc: [P.wei, P.rahul],
        date: at(`${FACTS.timezoneBug.shipped}T16:05`, PT_W),
        body: `Bec — this shipped today.

Your three clinics are set to Australia/Melbourne. Reminders now go at 6pm your
local time and the two-hour reminder is two hours before the appointment rather
than nine hours after it. Opening hours are compared in your local time too,
which was the other half of the bug and the one you had not hit yet.

The temporary 07:00 UTC bodge is removed, so there is nothing left to unpick
later.

Thank you for the emergency-call detail. It is the reason this went from a
ticket to a fix in three weeks rather than sitting in a backlog.

Marta`,
      },
    ],
  },

  // ======================================================== Mar: the outage
  {
    id: "brightsmile-incident",
    subject: "17 March — what happened",
    messages: [
      {
        from: C.joris,
        to: [P.priya],
        cc: [P.elena, SUPPORT_ALIAS],
        date: at(`${FACTS.marchOutage.date}T14:40`, PT_W),
        body: `Priya,

Forty of our practices could not take a booking this morning between about 9am
and midday. Reception desks fell back to paper and we are still typing
yesterday into the system.

I have had two practice owners ask me directly whether we should be looking at
alternatives. I am not saying that to threaten you, I am saying it because you
would want to know it was said.

I need to understand what happened, in writing, and I need to be able to
forward it.

Joris`,
      },
      {
        from: P.priya,
        to: [C.joris],
        cc: [P.elena, P.marta],
        date: at(`${FACTS.marchOutage.date}T21:10`, IN),
        body: `Joris,

Acknowledged, and I am not going to give you a half answer tonight.

What I can confirm now: the outage began at ${FACTS.marchOutage.start} and ran
for ${FACTS.marchOutage.durationMinutes} minutes. It affected
${FACTS.marchOutage.clinicsAffected} clinics, which is nearly everyone, not
only you. Bookings attempted during the window were not recorded, so anything
typed in on paper does need re-entering — I know that is the answer you did not
want.

You will have a written incident review from me within three working days, in a
form you can forward without editing.

Priya Raghunathan
VP Engineering`,
      },
      {
        from: P.priya,
        to: [C.joris],
        cc: [P.elena, P.marta, P.ana],
        date: at("2026-03-20T14:25", PT_W),
        body: `Joris — the incident review is written and shared with you; it is in
the Brightsmile folder as "Incident Review — 17 March 2026".

The short version, so you are not reading a document to find the point: our
payments provider timed out, our webhook handler retried without checking
whether it had already processed each event, and the retries took the booking
service down with them. ${FACTS.marchOutage.doubleCharges} cards were charged
twice as part of the same fault.

The double charges are being refunded without anyone having to ask. The
handler has been made idempotent, which is the fix that stops the whole class
of this rather than this instance of it.

Priya`,
      },
      {
        from: C.joris,
        to: [P.priya],
        cc: [P.marta],
        date: at("2026-03-23T09:15", PT_W),
        body: `Thank you, that is a proper document and I have forwarded it.

One thing it does not cover. Two of my practices have patients waiting on
deposit refunds from before the outage — one of them is on day eight. Your
policy page says five working days. Which is right?

Not a complaint about the outage, just something I keep getting asked.

Joris`,
      },
    ],
  },

  // ======================================================== Mar: double charge
  {
    id: "clearview-double-charge",
    subject: "A patient was charged twice",
    messages: [
      {
        from: C.harriet,
        to: [SUPPORT_ALIAS],
        date: at("2026-03-18T08:20", PT_W),
        body: `One of our patients has been charged her deposit twice for the same
appointment on Tuesday. She has sent me the two lines from her banking app,
both the same amount, four minutes apart.

She is not cross with us yet but she will be if I cannot tell her when she gets
it back. Can you refund it today?

Harriet Cole
Clearview Dental`,
      },
      {
        from: P.marta,
        to: [C.harriet],
        cc: [P.ana],
        date: at("2026-03-18T10:05", PT_W),
        body: `Harriet — refunded, this morning, you do not need to do anything.

She will see it back within a few working days depending on her bank; the
refund itself has left us.

This was part of yesterday's incident rather than something specific to her or
to you — our payment handler retried after a provider timeout and processed the
same charge twice. You are one of ${FACTS.marchOutage.doubleCharges} affected
across all customers, and we are refunding every one of them without waiting to
be asked, so if another patient tells you the same thing it is already in hand.

Ana in Payments is copied and can say more about the cause.

Marta`,
      },
      {
        from: P.marta,
        to: [P.ana],
        date: at("2026-03-18T10:12", PT_W),
        body: `Ana — off the customer thread for a second. How did we charge the same
card twice? I have to write this up for the incident review and "it retried" is
not going to satisfy Joris, who will read it.`,
      },
      {
        from: P.ana,
        to: [P.marta],
        cc: [P.priya],
        date: at("2026-03-18T12:44", PT_W),
        body: `Fairly, it should not satisfy him.

The provider sends us a webhook when a payment succeeds and retries it if we do
not answer quickly enough. Yesterday we were slow, so it retried, and our
handler had no memory of having seen that event before — it took the second
delivery as a second payment and charged again. Nothing in the code was wrong
in isolation; we simply assumed the network would deliver each event once,
which is the assumption you are not allowed to make.

The fix is to record every event id the first time we see it and make the
second delivery a no-op, inside the same transaction as the effect. That is
issue #3 and I have the change open now.

The uncomfortable part for the write-up: this was reported to us once in
January by a single clinic, and we could not reproduce it, so it sat. It took
${FACTS.marchOutage.doubleCharges} charges in one morning to make it obvious.

Ana`,
      },
    ],
  },

  // ======================================================== Mar–Apr: goodwill
  {
    id: "clearview-refund",
    subject: "Refund for the March outage",
    messages: [
      {
        from: C.harriet,
        to: [SUPPORT_ALIAS],
        cc: [P.elena],
        date: at("2026-03-30T17:30", PT_W),
        body: `I would like to ask about compensation for the 17th.

We lost most of a morning across all six practices. Two patients did not come
back to rebook, and I spent the afternoon on the phone rather than in the
surgery. The double charge on top of it did not help the impression.

I have read your terms and I can see outages are excluded. I am asking anyway.

Harriet`,
      },
      {
        from: P.marta,
        to: [P.priya],
        date: at("2026-03-31T09:15", PT_S),
        body: `Priya — Clearview have asked for compensation for the 17th and the
Refund Policy says no. Outages are explicitly not refundable and I would be
within my rights to send them that sentence.

I do not want to. They are ${FACTS.clearview.arrEur} euro a year, they have
been with us since 2023, and Harriet has been reasonable at every step of a
month in which we charged her patients twice. Sending her a policy clause is
the correct answer and the wrong one.

I want to give her a month's credit. That is not a decision I can take on my
own, and I would rather ask than do it and mention it later.`,
      },
      {
        from: P.priya,
        to: [P.marta],
        cc: [P.sam],
        date: at("2026-03-31T14:02", IN),
        body: `Do it.

Two conditions. Say plainly that it is outside the policy and that we are doing
it anyway — a goodwill credit dressed up as an entitlement teaches her to
expect it next time, and teaches us nothing. And log it, because if we are
making exceptions often enough to have a habit, the policy is wrong and should
be changed rather than quietly ignored.

Sam copied so this is not a surprise later.`,
      },
      {
        from: P.marta,
        to: [C.harriet],
        cc: [P.elena],
        date: at(`${FACTS.refunds.goodwillDate}T11:20`, PT_S),
        body: `Harriet,

We are giving you ${FACTS.refunds.clearviewGoodwill} on all six practices,
applied to your next invoice.

I want to be straight with you about what that is: our terms do exclude
outages, so this is not something you were entitled to. We are doing it because
you lost a working morning to a fault that was entirely ours, and because you
have been decent about a month in which we also charged your patients twice.

If it happens again I would rather you asked again than assumed.

Marta`,
      },
    ],
  },

  // ======================================================== Apr: login failures
  {
    id: "brightsmile-login",
    subject: "Can't log in since the app updated",
    messages: [
      {
        from: C.elke,
        to: [SUPPORT_ALIAS],
        date: at("2026-04-13T08:05", PT_S),
        body: `Since the app updated at the weekend, three of my reception staff
cannot log in on their phones. It accepts the password and then throws them
straight back to the login screen, over and over.

Uninstalling and reinstalling works, but I cannot ring forty practices and talk
each of them through that.

Elke Sanders
Practice Manager, Brightsmile Dental Group`,
      },
      {
        from: P.rahul,
        to: [C.elke],
        date: at("2026-04-13T13:50", IN),
        body: `Elke — you are not the only one, and reinstalling is unfortunately the
right workaround for now.

Can you confirm the version under Settings → About? I expect 4.2, and I expect
the affected phones are the ones that were on 4.1 rather than fresh installs.

How many staff are we talking about across the group? I want the real number in
front of engineering rather than "several".

Rahul`,
      },
      {
        from: C.elke,
        to: [P.rahul],
        date: at("2026-04-14T09:12", PT_S),
        body: `4.2, and yes — every one of them updated from 4.1. The two people who
had lost their phone recently and installed fresh are fine.

I have gone round the practices and it is eleven people. Nine of them managed
the reinstall themselves once I sent instructions; two are still stuck and one
of those is a practice manager who is now doing her diary on paper.

Elke`,
      },
      {
        from: P.marta,
        to: [C.elke],
        cc: [P.tomas, P.priya],
        date: at("2026-04-15T15:40", PT_S),
        body: `Elke,

Eleven is a useful number and it has changed how seriously this is being taken
internally — thank you for going round and counting.

The cause: 4.2 rebuilt how the app stores data offline, and on upgrade it does
not read the sign-in token the old version left behind. So the app has your
credentials and cannot find its own proof that you already used them. A fresh
install has nothing to migrate, which is why those phones are fine.

A 4.2.1 with the migration is being worked on now. Until it is out, reinstall
remains the fix and I am sorry that it is.

We should have caught this — upgrading from the previous version is the one
path every single customer takes, and it is the one we tested least.

Marta`,
      },
    ],
  },

  // ======================================================== Apr: release notes
  {
    id: "release-notes-wording",
    subject: "4.2 release notes — wording",
    messages: [
      {
        from: P.luca,
        to: [P.priya, P.tomas, P.elena],
        date: at("2026-04-08T10:30", PT_S),
        body: `Draft release notes for 4.2 attached in the doc — Product folder,
"Android 4.2 — Release Notes".

The only line I am unsure about is how we explain the date. We said
${FACTS.brightsmilePromise.wording}, it is going out on
${FACTS.release42.actual}, and forty practice managers have the first date in
an operations note.

Can we just say App Store review? It is true, it is the last thing that
happened before release, and it is the kind of sentence nobody follows up on.`,
      },
      {
        from: P.tomas,
        to: [P.luca, P.priya, P.elena],
        date: at("2026-04-08T16:15", IN),
        body: `It is true in the sense that review did happen. It is not true in the
sense that anybody reading it would take.

We submitted on ${FACTS.release42.appStoreSubmitted} and were approved on
${FACTS.release42.appStoreApproved}. That is ${FACTS.release42.appStoreReviewDays}
days out of ${FACTS.release42.slipDays}. The other thirty-one are ours: three
weeks on a sync design we threw away, and then the rebuild.

I am not arguing for putting "we wrote it twice" in a customer-facing document.
I am saying that if we name a cause at all, and the cause we name is the one
thing that was not our fault, we should not be surprised when someone eventually
does the arithmetic.

My preference is to state the date and not explain it. "4.2 is available from
${FACTS.release42.actual}." Nobody is owed a reason in release notes.`,
      },
      {
        from: P.priya,
        to: [P.luca, P.tomas, P.elena],
        date: at("2026-04-09T09:50", IN),
        body: `I am going to overrule you on this one, Tomas, and I want to write down
why so that it is on the record and can be held against me.

The notes go out with the App Store line. Not because it is the whole story —
you are right that it is four days of thirty-five — but because release notes
that say nothing invite the question louder than release notes that say
something ordinary, and I am not putting a rewrite into a document Joris will
forward to forty practices two months after we told him early March.

What I am not willing to do is have that be the only account that exists. Open
an issue with the real arithmetic in it, ours to read, and put the numbers you
just wrote in the body. If anyone inside this company ever asks why 4.2 was
late, I want the answer to be one search away and I want it to be the true one.

That is the trade I am making: an accurate internal record and a bland external
one. If we ever find ourselves without the first, the second becomes a lie.`,
      },
    ],
  },

  // ======================================================== May: the dull one
  {
    id: "northgate-export",
    subject: "How do I export our patient list?",
    messages: [
      {
        from: C.owen,
        to: [SUPPORT_ALIAS],
        date: at("2026-05-12T13:25", PT_S),
        body: `Our accountant wants a list of active patients with their last
appointment date. Is there a way to get that out as a spreadsheet, or do I need
to copy it off the screen?

Owen`,
      },
      {
        from: P.rahul,
        to: [C.owen],
        date: at("2026-05-12T18:10", IN),
        body: `Hi Owen,

No copying needed. Reports → Patients → Export, and choose CSV. There is a date
filter on that screen — set "last appointment" to the range your accountant
wants and the export follows the filter, so you are not handing over more than
you need to.

Opens straight in Excel or Numbers.

There is a longer walkthrough with screenshots in the help documents if anyone
else at Northgate needs it; ask and I will send the link.

Rahul`,
      },
    ],
  },

  // ======================================================== Jun: Clearview goes
  {
    id: "clearview-notice",
    subject: "Clearview: notice to cancel",
    messages: [
      {
        from: C.harriet,
        to: [P.elena],
        cc: [SUPPORT_ALIAS],
        date: at(`${FACTS.clearview.noticeGiven}T16:45`, PT_S),
        body: `Elena,

This is formal notice that we will not be renewing. Our contract runs to
${FACTS.clearview.effective}, and we will be moving across during August.

I want to be clear about the reason, because I would rather you heard it from
me than guessed.

It is not the price. We looked at two alternatives and one of them is more
expensive than you are.

It is March. Not the outage itself — every system goes down and I have run a
practice long enough to know that. It is that we found out from our own
patients rather than from you, that the double charges were something I had to
report rather than something you told me about, and that when I asked about
compensation the first answer I got was a policy clause. Marta made it right in
the end and she was good about it, but by then I had spent two weeks feeling
like I was arguing with a company rather than working with one.

I hope that is useful rather than just unpleasant to read.

Harriet Cole
Clearview Dental`,
      },
      {
        from: P.elena,
        to: [P.sam, P.priya, P.marta],
        date: at("2026-06-12T09:20", PT_S),
        body: `Forwarding below. Clearview have given notice, effective
${FACTS.clearview.effective}. That is ${FACTS.clearview.arrEur} euro of ARR and
our first named logo out of the door.

Read her second and third paragraphs before anyone writes this up. She has
explicitly ruled out price and named
"${FACTS.clearview.customerReason}" instead.

I am putting it in front of you now because the churn review will be written
next week and I would like it to say what she said.`,
      },
      {
        from: P.marta,
        to: [P.elena, P.sam, P.priya],
        date: at("2026-06-12T11:35", PT_S),
        body: `The churn review already says price. I have seen the draft.

I understand where that came from — they asked about our tiers in February and
somebody logged it as a pricing objection — but it is not what she is telling
us, and we have it from her in writing.

The uncomfortable version, which I would rather we wrote down than agreed
verbally and forgot: the health score for Clearview was already falling in
January, before the outage and before the pricing conversation. So her account
is right about March and still not the whole story, and "price" is not even in
the running.

If the review says price we will fix a problem we do not have.

Marta`,
      },
    ],
  },

  // ======================================================== Jun: a new joiner
  {
    id: "welcome-nadia",
    subject: "Welcome to Arkind, Nadia",
    messages: [
      {
        from: P.meera,
        to: [P.nadia],
        cc: [P.tomas, P.priya],
        date: at(`${P.nadia.joined}T09:00`, IN),
        body: `Nadia — welcome, and congratulations again.

Everything you need for the first week is in Drive under Onboarding: the First
Week Checklist, Engineering Setup, How We Ship, and a Glossary that exists
because we say "practice", "clinic" and "site" to mean three different things
and nobody warned the last two joiners.

Tomas is your lead and has your first fortnight sketched out. Ravi will sort
your accounts today — laptop, mail, repository. Production access is separate
and deliberately not automatic; ask when you need it and it will be a
conversation rather than a form.

Meera Iyer
Head of People`,
      },
      {
        from: P.nadia,
        to: [P.meera],
        date: at("2026-06-18T17:20", IN),
        body: `Thank you — the checklist is genuinely good, I have used it every day.

One thing I cannot resolve. I was reading through the repository to get my
bearings and the handbook in there says leave carry-over is
${FACTS.leave.repoCarryOverDays} days with no deadline. The Leave Policy
document in Drive says ${FACTS.leave.driveCarryOverDays} days and that they
have to be used by ${FACTS.leave.driveDeadline}.

Those cannot both be true and I would rather ask than guess. Which one is the
policy?

Nadia`,
      },
      {
        from: P.meera,
        to: [P.nadia],
        cc: [P.priya],
        date: at("2026-06-19T10:15", IN),
        body: `Drive is right: ${FACTS.leave.driveCarryOverDays} days, used by
${FACTS.leave.driveDeadline}. That document was updated on
${FACTS.leave.driveUpdated} and it is the one payroll works from.

The file in the repository is stale. It was last touched in
${FACTS.leave.repoLastTouched} and predates the change; it should have been
deleted at the time and was not. You are the third person to find it, which is
three more than the number of people who have found the correct document
without being sent it.

Well spotted, and thank you for asking rather than quietly taking the worse
number — the last person to find it assumed the repository was authoritative
because it was in version control.

Meera`,
      },
    ],
  },

  // ======================================================== Jun: prod access
  {
    id: "access-request-prod",
    subject: "Access request — production",
    messages: [
      {
        from: P.nadia,
        to: [P.ravi],
        cc: [P.tomas],
        date: at("2026-06-22T11:30", IN),
        body: `Ravi — could I get read access to the production database?

I am picking up the login failures from 4.2 and I keep having to ask Wei to run
queries for me, which is slow for both of us. Read-only is fine; I do not need
to change anything.

Nadia`,
      },
      {
        from: P.ravi,
        to: [P.nadia],
        cc: [P.tomas, P.priya],
        date: at("2026-06-22T14:05", IN),
        body: `Happy to, but not on my say-so — production carries patient data, so
the Access Register requires a named approver at VP level and I am not it.
Priya is copied.

For the record so the register is accurate, this would be: read-only, ninety
days, reviewed at expiry rather than renewed automatically. And you will be on
the quarterly access review from now on, which is the part people forget about
when they ask.

One thing worth knowing before you have it: read access to production is read
access to real patients' names and appointment histories. Query what you need
for the bug and nothing else, and do not take extracts onto your laptop.

Ravi Menon
IT and Access`,
      },
      {
        from: P.priya,
        to: [P.ravi],
        cc: [P.nadia, P.tomas],
        date: at("2026-06-23T09:40", IN),
        body: `Approved — read-only, ninety days, expiring rather than renewing.

Nadia, Ravi's last paragraph is the important one and it is not a formality.
The login bug is worth debugging properly and it is not worth a single patient
record leaving the environment.

Priya`,
      },
    ],
  },

  // ======================================================== Jul: the free tier
  {
    id: "free-tier",
    subject: "Free tier — do we?",
    messages: [
      {
        from: P.elena,
        to: [P.sam, P.luca, P.priya],
        date: at("2026-07-07T10:00", PT_S),
        body: `Proposal, and I know it is contentious.

A free tier: one clinic, fifty bookings a month, email reminders only, no
deposits. Everything above that is Starter at
${FACTS.pricing.tiers[0].eurPerClinicMonth} euro.

The argument is that single-room physios and mobile vets will not fill in a
form to talk to me, and there are a great many of them. We would be buying
reach we currently do not have at any price, and the ones who grow become
Starter without ever being sold to.

I would like a decision this quarter rather than another discussion.

Elena`,
      },
      {
        from: P.luca,
        to: [P.elena, P.sam, P.priya],
        date: at("2026-07-07T15:30", PT_S),
        body: `Against, and not on principle — on arithmetic.

A free clinic is not free to us. It opens tickets, and a single-room practice
with no account manager opens proportionally more of them than Brightsmile
does, because there is nobody in-house to answer the easy questions. Support is
eight people and was underwater for most of April with the customers we already
have.

The version I could support is a free tier with support explicitly excluded —
documentation only, no ticket queue. But I want somebody from support to say
out loud that they believe the boundary would hold, because in my experience it
does not, and the person who ends up answering those tickets is Marta at 9pm.`,
      },
      {
        from: P.sam,
        to: [P.elena, P.luca, P.priya],
        date: at("2026-07-09T08:45", PT_S),
        body: `Not deciding this quarter, and I want to be honest that this is a
deferral rather than a considered no.

Two reasons. We have just lost a customer over how we handled an incident, and
adding a large number of unpaid accounts to a support team that is the reason
we lost them is the wrong order to do things in. And Luca's question is the
right one and nobody has answered it — I am not signing off a boundary on the
assumption that it holds.

Revisit in Q4, with a number from Marta for what a free account actually costs
us in support hours. If that number is small, I will be easy to persuade.

Sam`,
      },
    ],
  },

  // ======================================================== Jul: ordinary noise
  {
    id: "brightsmile-qbr",
    subject: "Brightsmile QBR follow-ups",
    messages: [
      {
        from: P.elena,
        to: [C.joris],
        cc: [P.marta, P.luca],
        date: at("2026-07-02T14:00", PT_S),
        body: `Joris — thanks for Tuesday. Notes are in the Brightsmile folder as
"Brightsmile — QBR Notes, June 2026". Actions as I have them:

1. Per-clinic branding — with product, no commitment on timing yet.
2. Reporting export for your finance team — Marta to send the walkthrough.
3. Two practices still on 4.1 — Marta chasing the upgrade.
4. Renewal conversation to start in September rather than November.

Shout if I have misrecorded any of it.

Elena`,
      },
      {
        from: C.joris,
        to: [P.elena],
        cc: [P.marta, P.luca],
        date: at("2026-07-03T09:30", PT_S),
        body: `Two additions.

We also talked about the reminder timing change and whether it is behind the
no-shows creeping up at the Croydon and Reading practices. You said you would
check whether that is us or a general trend.

And I asked whether branding meant logo only or colours as well, because my
managers will ask me and "branding" will not survive the question.

Otherwise accurate.

Joris`,
      },
      {
        from: P.elena,
        to: [C.joris],
        cc: [P.marta, P.luca],
        date: at("2026-07-03T11:15", PT_S),
        body: `Both added, thank you.

On branding: logo and accent colour, not a full theme. That is the shape of the
work in progress and I would rather set that expectation now than let
"branding" grow between here and delivery.

On no-shows, I do not have an answer yet and I am not going to invent one — it
is being looked at, and I will come back to you with whatever the data says
even if it says it is us.

Elena`,
      },
    ],
  },
];
