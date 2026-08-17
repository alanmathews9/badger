// The Gmail half of the Arkind corpus.
//
// Mail is where the third version of events lives. Drive holds the document
// Halden were sent; GitHub holds the argument Arkind had with itself; these
// threads hold what was actually said to whom, and when.
//
// The load-bearing thread is `halden-recon`. It is the only place in any of
// the three sources that records what Halden were told about the reconciliation
// module — which makes "did we ever actually tell Halden about the
// reconciliation module?" answerable only by crossing mail with the repository.
// Neither source answers it alone, and that is the demo.
//
// Threading is by RFC 2822 headers rather than by subject: each message after
// the first carries In-Reply-To and a References chain. Gmail groups on those,
// so the thread survives being imported out of order.
//
// The mailbox belongs to Priya Raghunathan. Messages she sends are labelled
// SENT; everything else lands in INBOX.

import { P, addr } from "./people.mjs";

/**
 * Threads, oldest first.
 *
 * Each message: { from, to, cc, date, body }. `date` is an RFC 2822 date
 * string and is authoritative — GMAIL_IMPORT_MESSAGE is called with
 * internal_date_source: "dateHeader", so these are the dates Gmail sorts and
 * filters on. Getting them right is what makes "what happened in March" work.
 */
export const THREADS = [
  {
    id: "halden-oracle",
    subject: "Oracle read replica — access for the Arkind team",
    messages: [
      {
        from: P.tomas,
        to: [P.elke],
        cc: [P.joris, P.priya],
        date: "Mon, 19 Jan 2026 09:12:00 +0100",
        body: `Elke,

Kicking off today. The read replica is the first item on the critical path —
nothing in the schema mapping can start without it, and it is the dependency
with today's date against it in the SOW.

Could you confirm the credentials are ready? Dev and I are both free from this
afternoon.

Tomas`,
      },
      {
        from: P.elke,
        to: [P.tomas],
        cc: [P.joris, P.priya],
        date: "Tue, 20 Jan 2026 16:41:00 +0100",
        body: `Tomas,

Apologies — the replica exists but our security team want to review the access
before it goes to a third party. I have raised it. I am told "this week".

Elke`,
      },
      {
        from: P.tomas,
        to: [P.elke],
        cc: [P.joris, P.priya],
        date: "Mon, 26 Jan 2026 08:55:00 +0100",
        body: `Elke,

Following up. We are a week in and the team is doing preparatory work that we
had not planned to spend a week on.

Joris — flagging to you as well. This is on the critical path and every day of
delay moves the end date, since there is nothing to parallelise against.

Tomas`,
      },
      {
        from: P.joris,
        to: [P.tomas],
        cc: [P.elke, P.priya],
        date: "Wed, 28 Jan 2026 11:20:00 +0100",
        body: `Tomas,

Sorted this morning, credentials with Dev. Sorry for the delay — the review was
not something I had accounted for.

I would rather not have the end date move for this. Can you absorb it?

Joris`,
      },
      {
        from: P.tomas,
        to: [P.joris],
        cc: [P.priya],
        date: "Wed, 28 Jan 2026 14:02:00 +0100",
        body: `Joris,

We will do what we can. I would rather not commit to absorbing nine days this
early, so let us see where we are at the week 4 checkpoint.

Tomas`,
      },
    ],
  },

  {
    id: "halden-recon",
    subject: "The reconciliation piece",
    messages: [
      {
        from: P.joris,
        to: [P.tomas],
        cc: [P.priya],
        date: "Mon, 23 Feb 2026 10:08:00 +0100",
        body: `Tomas,

Coming back to something I mentioned at kickoff — the reconciliation piece
between the freight bookings and the finance ledger.

Our finance team have been asking. I had assumed it was part of the migration
work since it is the same data. Can you pick it up?

Joris`,
      },
      {
        from: P.tomas,
        to: [P.joris],
        cc: [P.priya, P.dev],
        date: "Mon, 23 Feb 2026 15:30:00 +0100",
        body: `Joris,

It is not in the SOW — I flagged that at kickoff and we left it as you
confirming by the end of week 1. That confirmation never came, so we scoped
without it.

That said, it is closely related to work we are doing anyway and I do not want
to be difficult about something your finance team need. Let me size it this
week and come back to you.

Tomas`,
      },
      {
        from: P.joris,
        to: [P.tomas],
        cc: [P.priya],
        date: "Tue, 24 Feb 2026 09:15:00 +0100",
        body: `Appreciated. I will tell finance it is in hand.

Joris`,
      },
      {
        from: P.tomas,
        to: [P.priya, P.dev],
        date: "Tue, 24 Feb 2026 18:44:00 +0100",
        body: `Priya, Dev —

Reconciliation is bigger than it sounded. Two weeks, possibly three, and it
touches the ledger side which we have never looked at.

I have told Joris we would size it. Strictly this is a change request.

My instinct is to absorb it. We are already behind on their access delay and I
do not want the first commercial conversation of the engagement to be us
invoicing for something they think they asked for at kickoff.

Tomas`,
      },
      {
        from: P.priya,
        to: [P.tomas],
        cc: [P.dev],
        date: "Wed, 25 Feb 2026 09:02:00 +0100",
        body: `Tomas,

I understand the instinct and I think it is wrong, but it is your engagement.

If we absorb three weeks silently, then at the end of this we will have an
overrun we cannot explain to Sam without explaining that we chose it. Raise it
as a CR at zero cost if you must — the point is the paper, not the money.

Priya`,
      },
      {
        from: P.tomas,
        to: [P.priya],
        cc: [P.dev],
        date: "Wed, 25 Feb 2026 09:41:00 +0100",
        body: `Noted. I will put it in the week 6 status and see how they react.

Tomas`,
      },
    ],
  },

  {
    id: "halden-retro-internal",
    subject: "Halden retro — what goes in the client version",
    messages: [
      {
        from: P.tomas,
        to: [P.priya, P.sam],
        date: "Wed, 3 Jun 2026 17:20:00 +0100",
        body: `Closing Halden on Friday. Draft of the client-facing retro attached in
Drive under Clients / Halden Logistics.

I have written the causes as "scope changed mid-engagement", which is what the
week 6 status supports. Wanted you both to see it before it goes to Joris.

Tomas`,
      },
      {
        from: P.priya,
        to: [P.tomas, P.sam],
        date: "Wed, 3 Jun 2026 19:05:00 +0100",
        body: `I have commented on the doc, but to say it here as well.

"Scope changed mid-engagement" is true and it is not the cause. The causes, in
order of cost, are: discovery compressed to two weeks against a playbook that
says three; three weeks of reconciliation work absorbed without a CR; and their
dependencies landing late with no escalation trigger.

Two of those three are ours. Roughly four of the six weeks are self-inflicted.

I am not proposing we send Joris that paragraph. I am proposing we do not write
a document that will teach us the wrong lesson when we read it back before
phase 2.

Priya`,
      },
      {
        from: P.sam,
        to: [P.priya, P.tomas],
        date: "Thu, 4 Jun 2026 08:30:00 +0100",
        body: `The client version stays as it is. We are not handing a client we intend to
sell phase 2 to a document that says we mismanaged their engagement.

The internal issue is the record and it is unsparing enough — I have added the
part about compressing discovery, which was my decision and is the root of it.

Priya, your actual concern is that in a year somebody reads only the Drive
document. Fix that by making the internal issue easy to find, not by rewriting
the client one.

Sam`,
      },
      {
        from: P.priya,
        to: [P.sam, P.tomas],
        date: "Thu, 4 Jun 2026 09:12:00 +0100",
        body: `Accepted, with one thing on the record: "easy to find" is doing a lot of work
in that sentence. The document and the issue live in different systems and
neither mentions the other. Anyone searching for "why did Halden slip" finds
whichever one their tool happens to index.

That is a real gap and it is not solved by us intending to remember.

Priya`,
      },
    ],
  },

  {
    id: "halden-retro-sent",
    subject: "Halden — engagement retro and close",
    messages: [
      {
        from: P.tomas,
        to: [P.joris],
        cc: [P.priya, P.sam],
        date: "Mon, 8 Jun 2026 10:00:00 +0100",
        body: `Joris,

Formally closing the engagement. The retro is in the shared Drive folder.

Headline: delivered in full, twenty weeks against a planned fourteen. The
actions we are taking are in the document, and the one I would draw your
attention to is that client dependencies will carry an escalation trigger in
future, not just a date.

For phase 2 we would like to talk about commercial structure before scope. I
will send times.

Tomas`,
      },
      {
        from: P.joris,
        to: [P.tomas],
        cc: [P.priya],
        date: "Tue, 9 Jun 2026 12:35:00 +0100",
        body: `Tomas,

Read it. Fair, and I recognise our part in it — the replica delay was ours and
the sign-off turnaround was worse than we agreed.

On "scope changed mid-engagement": I would push back slightly. The
reconciliation piece was something I raised at kickoff. I accept it was not in
the SOW, but I did not think I was asking for something new in February.

Not worth reopening for the retro. Worth saying before we scope phase 2.

Joris`,
      },
      {
        from: P.priya,
        to: [P.tomas],
        date: "Tue, 9 Jun 2026 13:10:00 +0100",
        body: `Tomas — Joris is right and this is exactly what I was worried about.

He raised it at kickoff, it is in our own kickoff notes as "Joris to confirm by
end of week 1", and nobody chased it. We then described it to him as a scope
change.

Please make sure this lands in the internal issue. If the only record of it is
this mail thread it will not be found again.

Priya`,
      },
    ],
  },

  {
    id: "halden-phase2",
    subject: "Halden phase 2 — fixed price or T&M",
    messages: [
      {
        from: P.sam,
        to: [P.priya, P.tomas],
        date: "Mon, 15 Jun 2026 11:00:00 +0100",
        body: `Phase 2 is decommissioning, the customs module and pre-2019 history. All three
were explicitly excluded from phase 1, and we have never seen the customs
module.

My position: T&M with a cap, three weeks of paid discovery first, cap set after
discovery. If Halden will not take that, we do not bid.

We fixed-priced phase 1 because a competitor did. That cost us €118,000 against
an €82,400 contingency and a year of profit share.

Sam`,
      },
      {
        from: P.tomas,
        to: [P.sam, P.priya],
        date: "Mon, 15 Jun 2026 14:22:00 +0100",
        body: `Agreed on structure. The risk is real though — Joris chose us partly on price
certainty and he has said as much twice.

Tomas`,
      },
      {
        from: P.priya,
        to: [P.sam, P.tomas],
        date: "Tue, 16 Jun 2026 09:40:00 +0100",
        body: `The commercial argument is easy. The awkward part is the story.

We told Joris the overrun was scope change. If we now say the terms must change
because scope is unknowable, he will reasonably ask why that was not a problem
in January.

The honest version — that we compressed discovery and absorbed a change without
pricing it — is a better argument for T&M than the one we can currently make.
We just cannot make it without contradicting the retro we sent him.

I do not have a clean answer. Flagging it before we are in the room.

Priya`,
      },
    ],
  },

  {
    id: "onboarding-nadia",
    subject: "Welcome to Arkind, Nadia",
    messages: [
      {
        from: P.meera,
        to: [P.nadia],
        cc: [P.luca, P.priya, P.ravi],
        date: "Mon, 1 Jun 2026 09:00:00 +0100",
        body: `Nadia — welcome, and congratulations again.

Everything for your first week is in Drive under Onboarding: "New Joiner —
First Week Checklist". Work through it in order and do not worry about
finishing it on time; half of it depends on someone else pressing a button.

Two things that genuinely matter on day one:

1. Enrol in 2FA. IT disables accounts that have gone seven days without it and
   that is not a threat, it is a cron job.
2. Request your access today, through the Access Register in Drive, not in
   Slack. Client systems are slow — Verity production took eleven days for Ana.

Luca is your practice lead. Your buddy is Sofia.

Meera`,
      },
      {
        from: P.nadia,
        to: [P.meera],
        cc: [P.luca, P.ravi],
        date: "Mon, 1 Jun 2026 14:30:00 +0100",
        body: `Thank you — laptop arrived, 2FA done, checklist about half through.

Two questions:

- The checklist says read the engagement lifecycle playbook in "the internal
  repo". Do I have access to that yet? GitHub is not in my accounts.
- Leave: the handbook says 5 days carry-over, but the HR doc in Drive says 10
  and expiring in March. Which is right?

Nadia`,
      },
      {
        from: P.meera,
        to: [P.nadia],
        cc: [P.luca, P.ravi],
        date: "Mon, 1 Jun 2026 16:05:00 +0100",
        body: `Both good catches.

GitHub — Ravi will add you today, that should have been same-day.

Leave — the Drive document is correct: **10 days, must be used by 31 March**.
The handbook copy in the repository is the 2024 rule and has not been updated.
You are the second person to hit this. I will get it fixed properly rather than
answering it one person at a time.

Meera`,
      },
    ],
  },

  {
    id: "access-verity",
    subject: "Access request — Verity production",
    messages: [
      {
        from: P.nadia,
        to: [P.ravi],
        cc: [P.luca],
        date: "Wed, 10 Jun 2026 10:15:00 +0100",
        body: `Ravi,

Access request per the register.

System: Verity — production
Reason: joining the notification extraction engagement, phase 0 harness work
Engagement: Verity extraction
Arkind approver: Luca Bianchi (copied)

Nadia`,
      },
      {
        from: P.luca,
        to: [P.ravi],
        cc: [P.nadia],
        date: "Wed, 10 Jun 2026 10:40:00 +0100",
        body: `Approved from our side.

Ravi — note for the register: Verity only grant production to named
individuals and it took eleven days for Ana in June. Please raise it with their
IT today rather than at the end of the week, otherwise Nadia is blocked into
July.

Luca`,
      },
      {
        from: P.ravi,
        to: [P.nadia],
        cc: [P.luca],
        date: "Wed, 10 Jun 2026 11:30:00 +0100",
        body: `Raised with Verity IT this morning. Staging access you have already — that is
two days typically and it is enough for the harness work in the meantime.

Nadia, one thing worth knowing since you are new: the register's observed-wait
column is history, not a service level. Nobody at Verity has promised eleven
days. It is simply what happened last time.

Ravi`,
      },
    ],
  },

  {
    id: "q3-capacity",
    subject: "September capacity — this is not resolving itself",
    messages: [
      {
        from: P.priya,
        to: [P.tomas, P.luca, P.sam],
        date: "Mon, 6 Jul 2026 09:30:00 +0100",
        body: `September is oversubscribed and has been flagged since May as issue #3.

Halden phase 2 delivery and Verity warehouse foundations both want Dev and
Marta. Both are Q3. Neither has moved.

The options are: hire, subcontract, or tell Halden Q4. We have been treating
this as a scheduling problem for two months and it is a decision.

Priya`,
      },
      {
        from: P.tomas,
        to: [P.priya, P.luca, P.sam],
        date: "Mon, 6 Jul 2026 11:15:00 +0100",
        body: `Halden phase 2 depends on the commercial conversation landing, which has not
happened. If it goes to T&M with discovery first, then discovery is three weeks
and delivery genuinely cannot start before Q4 anyway.

So one of the two conflicts may resolve itself — but not for a good reason, and
not on a date I can promise.

Tomas`,
      },
      {
        from: P.sam,
        to: [P.priya, P.tomas, P.luca],
        date: "Tue, 7 Jul 2026 08:45:00 +0100",
        body: `We do not staff an engagement we cannot staff properly. That resolves the
argument and it does not resolve September.

Priya — start a hire for Data & Platform now, band 2, Bengaluru. If Halden
slips to Q4 we will still want the capacity, and if it does not we would have
needed it in September.

Subcontracting is not on the table for migration work. We have tried it twice
and both times the handover cost more than the capacity bought us.

Sam`,
      },
    ],
  },
];
