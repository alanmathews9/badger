// The Google Drive half of the Arkind corpus.
//
// Drive holds what a company writes down: the onboarding pack, the team pages,
// the HR policies, the roadmap, and the version of events that goes to
// customers. That last category is why Drive is the source most often *wrong* —
// not through anyone lying, but because a document is written once, sent
// outwards, and then stops being updated while the thing it describes moves on.
//
// GitHub holds the argument. Gmail holds what was actually said to whom. Drive
// holds the official version. The demo is the gap between them.
//
// Four deliberate seams, each authored and each recorded in `company.mjs`:
//
//   1. `Android 4.2 — Release Notes` says the release was delayed by App Store
//      review. Issue #8 does the arithmetic: review took 4 of the 35 days. The
//      release notes are the version that gets forwarded.
//
//   2. `Leave Policy 2026` gives ten days' carry-over with a 31 March deadline.
//      `handbook/leave.md` in the repository still says five days and no
//      deadline. Both are reachable, and returning only one of them is lying by
//      omission.
//
//   3. `Clearview Dental — Churn Review` records the reason as price. Their
//      notice email says the March outage and how it was handled. Issue #14 has
//      the team split. The health sheet shows the score falling before either.
//
//   4. `Refund Policy` says outages are not refundable. Support gave Clearview
//      a month's credit anyway, in writing, in April.
//
// Comments carry the disagreement, exactly as GitHub issue comments do.
// `GOOGLEDRIVE_LIST_COMMENTS` is in the agent's read allowlist for that reason:
// a Google Doc comment thread is the same shape as a code review, and the
// margin is where a document stops being official.
//
// Drive attributes every comment to the authenticated account, so the speaker
// is named in the text — the same convention the GitHub corpus uses.

import { P, C, CUSTOMERS, DEPARTMENTS, FACTS, STAFF } from "./company.mjs";

const { release42: R, marchOutage: O } = FACTS;

export const ROOT = "Arkind";

/** Folders, parents before children — the seeder relies on that order. */
export const FOLDERS = [
  "Onboarding",
  "Teams",
  "Customers",
  "Customers/Brightsmile",
  "Customers/Clearview",
  "Product",
  "People and HR",
  "Support",
  "Security and Access",
];

// ------------------------------------------------------------------- docs

export const DOCS = [
  // =========================================================== Onboarding
  {
    folder: "Onboarding",
    title: "First Week Checklist",
    md: `# First week at Arkind

Your buddy owns this list with you. If anything here is still unticked on
Friday, that is a process failure and not yours — tell Meera.

## Day one

- [ ] Laptop, and full-disk encryption confirmed (Ravi)
- [ ] Google account, calendar, and the two channels that matter: #general and
      #incidents
- [ ] GitHub organisation invite accepted
- [ ] Read \`handbook/security.md\` in the repository. It is short and it is the
      one thing we ask everybody to read on day one.
- [ ] Coffee with your lead, twenty minutes, no agenda

## Week one

- [ ] Engineering Setup, if you are in Engineering — the api running locally
      with the seeded clinics
- [ ] Sit with Support for an hour. Everybody does this, including Sales.
      It is the fastest way to learn what the product actually is.
- [ ] Read the last two incident reviews
- [ ] Leave policy and expenses: Leave Policy 2026 and \`handbook/expenses.md\`

## Things nobody tells you

Reminders are the product. Booking is the thing customers *say* they buy;
reminders are the thing that stops them leaving.

Two sites, five and a half hours apart. Anything decided in a call at 16:00
Lisbon was decided without Bengaluru, so it goes in writing afterwards.
`,
  },
  {
    folder: "Onboarding",
    title: "Engineering Setup",
    md: `# Engineering setup

    git clone git@github.com:arkind/arkind.git
    cd arkind && npm install
    npm run dev            # api on :4000, seeded with two clinics
    npm test

Postgres 15 locally. The seed script creates one dental practice in London and
one veterinary practice in Melbourne — the second one is deliberate, and it is
there so that a timezone bug is visible on your machine rather than in
production. See issue #1 for what it cost us to learn that.

## Mobile

    cd mobile && npm install
    npm run android        # or: npm run ios

You need a device or an emulator with the Play services image. Before you touch
anything under \`src/sync/\`, read \`mobile/app/src/sync/README.md\`. It is the
most important file in the repository and it exists because that layer has been
written twice.

## Access you will need, and who grants it

| What | Who |
|---|---|
| GitHub organisation | Ravi |
| AWS sandbox | Ravi |
| Staging database | Your lead |
| Production database | Two approvers, time-boxed to 24 hours. See the Access Register. |

Production access is not a default. Nobody has standing production access,
including the VP of Engineering.
`,
  },
  {
    folder: "Onboarding",
    title: "How We Ship",
    md: `# How we ship

## api

Continuous. Merged to \`main\`, tests green, it deploys itself. There is no
release train and no cutoff.

Not on a Friday after 15:00 UTC. Not during the evening reminder batch.

## Mobile

Every six to eight weeks. Both stores at once. The full process is
\`playbooks/releases.md\` in the repository; the part people get wrong is that
**store review is not the long pole** — our median is under two days on Play
and four on App Store Connect.

## What "done" means

- Tests, and a test that would have caught the bug you are fixing
- The runbook updated if it changes what happens at 3am
- The customer-facing note written by Product and read by Support before it
  goes anywhere

## Reviews

One approval. Two if it touches payments or the sync layer. A review comment
that says "why?" is a real question and deserves an answer in the thread rather
than a force-push.
`,
  },
  {
    folder: "Onboarding",
    title: "Glossary",
    md: `# Glossary

**Clinic** — one physical practice. A customer may have forty of them.

**Practice** — what our customers call a clinic. We use both, interchangeably,
which is mildly confusing and too late to fix.

**Slot** — a bookable interval on a clinic's diary. Length is per service.

**Hold** — a 90-second exclusive claim on a slot while somebody fills in the
booking form. Added after two receptionists confirmed the same 9:40 slot.

**Deposit** — money taken at booking to reduce no-shows. 10% of the appointment
value, minimum EUR 5. Whether that is the right model is still argued about.

**No-show** — a patient who neither attends nor cancels. The number the whole
product exists to move.

**Evening reminder** — sent at 18:00 clinic-local the day before. Note
*clinic-local*: it was 18:00 UTC until March 2026 and that was a bug with a
name.

**Intent** — in the mobile sync layer, a thing the user asked for, queued
offline and applied on reconnect. As opposed to *state*, which is what the
first version of that layer synchronised and why it was thrown away.

**SEV1** — customers cannot book, or money is wrong. Money is always SEV1.
`,
  },

  // ================================================================ Teams
  {
    folder: "Teams",
    title: "Team — Mobile",
    md: `# Mobile

**${P.tomas.name}** — ${P.tomas.role}, ${P.tomas.site}
**${P.nadia.name}** — ${P.nadia.role}, ${P.nadia.site}, joined June 2026

Three further engineers, one designer shared with Product. Five people on the
org sheet.

## What we own

The React Native app, iOS and Android, one codebase. Clinic staff use it;
patients book on the web.

The offline sync layer is ours and it is the part with history. It has been
built twice — see \`mobile/app/src/sync/README.md\` and issue #8. A third
rewrite is proposed in issue #9 and has not been agreed.

## Release cadence

Six to eight weeks. 4.2 was the exception, at five weeks late, and the
accounting for that is issue #8 rather than the release notes.

## How to get our attention

Anything customer-affecting goes through Support with a clinic name and a
booking id. Anything else, ask Tomas.
`,
  },
  {
    folder: "Teams",
    title: "Team — Platform and Payments",
    md: `# Platform and Payments

## Platform — ${DEPARTMENTS.find((d) => d.name === "Engineering — Platform").size} people, Bengaluru

**${P.dev.name}** — ${P.dev.role}
**${P.wei.name}** — ${P.wei.role}
**${P.karan.name}** — ${P.karan.role}

Booking, availability, reminders, patients, and the reporting work. Every
incident lands here first, which is a load nobody has properly costed.

## Payments — ${DEPARTMENTS.find((d) => d.name === "Engineering — Payments").size} people, Lisbon

**${P.ana.name}** — ${P.ana.role}

Deposits, refunds, the provider integration, and the webhook. If you are asking
"who knows about payments", the answer is Ana, and the evidence is that she
owns every commit under \`api/src/payments/\`.

Payments is three people and the smallest team that carries a SEV1 category of
its own. Money being wrong is always SEV1.

## Ask Platform, not Payments, about

Reminder timing, opening hours, the diary, and anything to do with why a
booking exists or does not.
`,
  },
  {
    folder: "Teams",
    title: "Team — Support",
    md: `# Customer Success and Support

**${P.marta.name}** — ${P.marta.role}, ${P.marta.site}
**${P.rahul.name}** — ${P.rahul.role}, ${P.rahul.site}

Eight people including both sites. Coverage is 07:00–19:00 UK, which is not the
same as the on-call window and is a source of confusion at both ends of the day.

## What we do

First response inside two hours in hours. Reproduce before escalating, always
with a clinic name, a booking id and a timestamp.

## What we may promise

- A deposit refund, immediately, no approval
- A named engineer today, for SEV1 and SEV2
- A written update by a stated time, which we then meet

## What we may not promise

- A date for a fix
- Account credit — that is Elena or Sam, and the Refund Policy is the boundary
- A feature

The middle one has been broken, in writing, and the customer quoted it back.
`,
  },
  {
    folder: "Teams",
    title: "On-call and Escalation",
    md: `# On-call and escalation

One engineer, one week, 06:00–21:00 UTC. Nothing pages overnight.

The rota is On-call Rota Q3. Swaps are between the two people involved; tell the
channel so the rota stays true.

## Escalation by area

| Area | First | Then |
|---|---|---|
| Booking, availability, diary | ${P.dev.name} | ${P.priya.name} |
| Reminders, SMS | ${P.wei.name} | ${P.priya.name} |
| Payments, deposits, refunds | ${P.ana.name} | ${P.priya.name} |
| Mobile app | ${P.tomas.name} | ${P.priya.name} |
| Access, accounts, logins | ${P.ravi.name} | ${P.priya.name} |

## Known unfairness

The window is 11:30–02:30 in Bengaluru and 06:00–21:00 in Lisbon, and most
engineers are in Bengaluru. Issue #13 is the open complaint. Nothing here should
be read as that having been resolved — it has not been.
`,
  },

  // ================================================ Customers / Brightsmile
  {
    folder: "Customers/Brightsmile",
    title: "Brightsmile Dental Group — Account Plan",
    md: `# ${CUSTOMERS.brightsmile.name}

${CUSTOMERS.brightsmile.clinics} clinics, ${CUSTOMERS.brightsmile.plan} plan,
customer since ${CUSTOMERS.brightsmile.since}. Our largest account by a
distance.

**${C.joris.name}** — ${C.joris.role}. Decision maker, and the person who asks
about dates.
**${C.elke.name}** — ${C.elke.role}. Day to day, and the one who tells us when
something is broken before their staff do.

## What they care about, in their order

1. Reminders arriving, reliably. They measure their own no-show rate weekly.
2. Per-clinic branding. Four local brand names across forty practices, and the
   booking page shows ours. Raised at the June QBR and twice since.
3. Being told things before their patients tell them.

Point 3 is not a preference. It is what March cost us with them.

## Risks

- Branding has been "on the roadmap" for three quarters. Issue #10 is open and
  the draft PR is unmerged.
- They were told the new app would arrive in early March and it arrived in
  April. That conversation is in mail, not in any document here.

## Commercials

Renewal in April. No competitive threat we know of, which is not the same as
none.
`,
  },
  {
    folder: "Customers/Brightsmile",
    title: "Incident Review — 17 March 2026",
    md: `# Incident review — ${O.date}

**Prepared for ${CUSTOMERS.brightsmile.name}. Customer-facing.**

## What happened

On 17 March 2026, beginning at ${O.start}, our payment provider stopped
responding to our booking service. Booking and deposit handling were degraded
for ${Math.floor(O.durationMinutes / 60)} hours and ${O.durationMinutes % 60}
minutes.

During the incident a number of patients were charged twice for the same
appointment deposit. Across all customers, ${O.doubleCharges} duplicate charges
occurred. All were refunded the same day.

## What caused it

Our provider timed out on the endpoint that receives payment confirmations, then
re-sent the confirmations it had queued. Our service treated each re-sent
confirmation as a new payment.

## What we have changed

- Every payment confirmation is now recorded before it is acted on, so a
  re-sent confirmation has no effect. Deployed 19 March.
- An alert now fires if any appointment is charged more than once within a day.
  Against the 17 March timeline it would have fired four minutes in.

## What we did not do well

We learned about the duplicate charges from a practice, who learned about them
from a patient. That is the wrong order and it is the change we care most about.

Prepared by ${P.marta.name}, with ${P.ana.name}.
`,
    comments: [
      {
        author: P.sam.name,
        content: `The last section stays exactly as written. I know it is uncomfortable and it is the only part of this document they will believe.`,
        replies: [
          `${P.marta.name}: Agreed. Joris said as much when I sent it — that the admission was why he read the rest.`,
        ],
      },
      {
        author: P.ana.name,
        content: `Should this say 61 across all customers, or the number that affected Brightsmile specifically? They had 14.`,
        replies: [
          `${P.marta.name}: All customers. If we give them only their own number they will ask for the total, and it looks worse to have had it withheld than to have said it.`,
        ],
      },
    ],
  },
  {
    folder: "Customers/Brightsmile",
    title: "Brightsmile — QBR Notes, June 2026",
    md: `# Brightsmile QBR — June 2026

Present: ${C.joris.name}, ${C.elke.name}, ${P.elena.name}, ${P.marta.name},
${P.luca.name}.

## Their numbers

No-show rate 5.9%, up from 4.8% in December. They raised this and we did not
have a good answer — see issue #11, which is open and confounded.

Booking volume up 11% quarter on quarter. They opened two practices.

## What they asked for

1. **Per-clinic branding.** Third quarter running. Joris asked, in the same
   sentence, whether they could set a brand once and apply it to a group of
   practices. That detail matters and is recorded in issue #10.
2. Export of their own patient list without asking us. Currently a support
   ticket.
3. An earlier warning when a release is coming, "so we can tell our practices".

## What we said

Branding is being worked on and we did not give a date. Export is on the list.
On releases we agreed to tell them two weeks ahead, which we have not yet done
for any release.

## Tone

Warm. Joris raised the app timing twice, both times lightly, both times as a
joke. He has not forgotten that it was promised in March.
`,
  },

  // ================================================== Customers / Clearview
  {
    folder: "Customers/Clearview",
    title: "Clearview Dental — Churn Review",
    md: `# Churn review — ${CUSTOMERS.clearview.name}

${CUSTOMERS.clearview.clinics} clinics, ${CUSTOMERS.clearview.plan} plan,
customer since ${CUSTOMERS.clearview.since}.
EUR ${FACTS.clearview.arrEur} annual.

Notice given ${FACTS.clearview.noticeGiven}, effective
${FACTS.clearview.effective}.

**Reason recorded: ${FACTS.clearview.driveReason}.**

## Detail

${C.harriet.name} declined the Group tier in April and said the Practice tier
was already at the top of what six clinics could justify. When notice came in
June, price was the reason we recorded.

## Health signals we had

The account's health score fell from 78 in January to 41 in May. The largest
single drop is March.

## What we would do differently

Offer the annual discount earlier. A six-clinic practice paying monthly is
paying about 12% more than they need to and nobody had told them.

## Actions

- [ ] Elena to review pricing for accounts under ten clinics
- [ ] Offboarding and data export by 31 August
`,
    comments: [
      {
        author: P.marta.name,
        content: `This says price. Their notice email says the March outage and the way it was handled, and spends two of three paragraphs on it. I do not think we can file this as price.`,
        replies: [
          `${P.elena.name}: Price is what Harriet told me in April, and it is what I recorded. I am not going to write down a reason I was not given.`,
          `${P.marta.name}: Then the document should say both, and say which of us heard which. Recording only the earlier one makes the later one disappear.`,
          `${P.sam.name}: Both, with attribution. And note the health score was falling from January, which is before either explanation.`,
        ],
      },
      {
        author: P.rahul.name,
        content: `For the record: Harriet also names the refund taking nine days. That is issue #7 and we changed the policy afterwards, but she did not know that.`,
      },
    ],
  },

  // ============================================================== Product
  {
    folder: "Product",
    title: "Android 4.2 — Release Notes",
    md: `# Arkind ${R.version} — Android

Released ${R.actual}.

## What's new

**Offline booking.** The app now works without a connection. Bookings taken in
a treatment room with no signal are saved on the device and applied
automatically when you are back online. If a slot was taken while you were
offline, the app tells you rather than guessing.

**Patient search by phone number.** Type a number the way the caller display
shows it and the patient comes up.

**Faster diary.** The day view loads about twice as quickly on older devices.

## Fixed

- The app no longer closes if the connection drops while you are booking.
- Reminders now use each clinic's local time.
- Two members of staff can no longer confirm the same appointment slot.

## A note on timing

This release arrived later than we indicated. **The delay was caused by App
Store review.** We are sorry for the wait, and we are looking at how we give
practices more warning of release dates in future.

---

Questions to your account manager or support@arkind.example.
`,
    comments: [
      {
        author: P.luca.name,
        content: `Wording on the timing note — I have gone with "App Store review". Four hundred practices do not know there was a March date and "we rewrote our sync layer twice" is not information to them, it is anxiety.`,
        replies: [
          `${P.tomas.name}: Review took four days of thirty-five. I am not going to argue about how much detail customers need, but that sentence is not true.`,
          `${P.luca.name}: Fair. "Took longer than we planned" would have cost nothing and I should have written that.`,
          `${P.priya.name}: Leaving it as it went out, since it went out. The accounting is in issue #8 and that is where anyone internal should be reading it.`,
        ],
      },
      {
        author: P.marta.name,
        content: `Support view: expect login tickets. The upgrade drops the stored session on Android and staff will think their password changed. We should say so here rather than answer it four hundred times.`,
        replies: [
          `${P.luca.name}: Missed this before publishing. It is exactly what happened — see issue #17.`,
        ],
      },
    ],
  },
  {
    folder: "Product",
    title: "Roadmap H2 2026",
    md: `# Roadmap — H2 2026

Not a commitment. Three engineering teams, one of which is two people.

## Agreed

**Reporting replica.** The primary's slow log is filling with reporting
queries. Platform, Q3. Postgres version is issue #21 and is not interesting.

**Patient export, self-service.** Currently a support ticket. Brightsmile and
Northgate have both asked. Product + Platform, Q3.

**Upgrade testing from the previous store build.** Cheap, and it would have
caught the 4.2 login problem. Mobile, Q3.

## Competing for the same two people

- Per-clinic branding (#10) — largest customer, asked three quarters running
- Reminders onto a queue (#12) — two credible positions, unresolved
- Third sync rewrite (#9) — proposed, not funded

These three cannot all happen. H2 planning decides.

## Unowned

**Accessibility audit before the NHS pilot.** WCAG 2.2 AA on everything
patient-facing, evidenced externally. September date, EUR 6–9k, four to six
weeks of calendar time. **No name against it.** Issue #20.

## Not doing

Apple Wallet passes (#22). Free tier (#18) — argued, unresolved, and not on
this list until it is.
`,
    comments: [
      {
        author: P.elena.name,
        content: `The accessibility line has been unowned since April. It is a gate on the pilot, not a nice-to-have — a gate does not move because we were busy.`,
        replies: [
          `${P.luca.name}: Agreed, and I am not the owner: Design can do the internal pass and cannot commission or pass an external audit.`,
          `${P.sam.name}: Then it is mine until H2 planning. Putting my name on it here so it stops being nobody's.`,
        ],
      },
    ],
  },
  {
    folder: "Product",
    title: "Pricing and Plans",
    md: `# Pricing and plans

Per clinic, per month, billed monthly. Annual is 12% less and is not advertised
well enough.

| Plan | EUR / clinic / month | Includes |
|---|---|---|
${FACTS.pricing.tiers.map((t) => `| ${t.name} | ${t.eurPerClinicMonth} | ${t.includes} |`).join("\n")}

## Deposits

${FACTS.pricing.depositModel}. Available on Practice and Group.

Whether a percentage is the right model at all is issue #15: a EUR 900 implant
takes a EUR 90 deposit and that is the one patients ring the practice about.
Open, unresolved, and dentists and physios want different answers.

## What we do not have

No free tier. Argued regularly, most recently issue #18, and the argument
always ends at the same place: nobody can produce a conversion number because
we have never had one.

No per-seat pricing. Clinics have unpredictable staff counts and charging per
receptionist would punish the practices that share cover.

## Discounts

Annual, 12%. Anything else is Sam.
`,
  },
  {
    folder: "Product",
    title: "Feature Request Log",
    md: `# Feature request log

Counted by number of distinct customers asking, not by how loudly.

| Request | Clinics | Status |
|---|---|---|
| Search patients by phone number | 31 | **Shipped**, May 2026 (#6) |
| Per-clinic branding | 12 | Open (#10), draft PR unmerged |
| Self-service patient export | 9 | Roadmap H2 |
| Two-way calendar sync | 8 | Declined — see \`docs/integrations.md\` |
| Waiting list / auto-fill cancellations | 7 | Not started |
| Recurring appointments | 6 | Not started |
| Deposit as a flat fee | 5 | Argued in #15, unresolved |
| SMS in Portuguese | 4 | Not started |
| Wallet passes | 0 | Proposed internally (#22). Nobody has asked. |

## How this list is used

Badly, historically. It informs H2 planning and nothing else, and there is no
route from "twelve clinics asked" to "an engineer is working on it" that does
not go through a quarterly conversation.

The waiting-list request is the one worth reading twice: seven clinics, all
independently describing the same thing, and it addresses the no-show rate that
Brightsmile raise every quarter.
`,
  },

  // ======================================================== People and HR
  {
    folder: "People and HR",
    title: "Leave Policy 2026",
    md: `# Leave policy 2026

**Updated ${FACTS.leave.driveUpdated}. This supersedes the leave section in the
engineering handbook.**

25 days a year plus public holidays for your site, pro rata in your first year.

Book it in the HR system and tell your team lead. There is no approval queue.

## Carry-over

**Up to ${FACTS.leave.driveCarryOverDays} days may be carried into the next
year, and carried days must be used by ${FACTS.leave.driveDeadline}.**

This changed in January 2026. It was previously five days with no deadline. The
deadline is the part people miss.

Anything above ${FACTS.leave.driveCarryOverDays} days is lost at the end of
December.

## Sick leave

Tell your lead, and do not work. No cap, not counted.

## Parental leave

Six months at full pay for the primary carer, twelve weeks for the secondary,
both sites. Tell People three months ahead where you can.

## On-call

There is no time off in lieu for on-call, and there is no on-call pay. Both have
been raised (issue #13) and neither has been decided.
`,
    comments: [
      {
        author: P.nadia.name,
        content: `The handbook in the repository says five days and no deadline. Which one is right? I have been reading that one since I joined.`,
        replies: [
          `${P.meera.name}: This one. The handbook page is from 2024 and I did not know it was still there.`,
          `${P.ravi.name}: It is still there, and it is the first hit if you search the repository for "carry over". Somebody should delete it.`,
          `${P.meera.name}: Adding it to my list. Nothing has been deleted yet, which is a running theme.`,
        ],
      },
    ],
  },
  {
    folder: "People and HR",
    title: "Compensation Bands 2026",
    md: `# Compensation bands 2026

Bands are global, adjusted by site factor. Reviewed annually in January.

| Band | Role | EUR base (Lisbon) | Site factor, Bengaluru |
|---|---|---|---|
| 1 | Engineer | 42,000 – 55,000 | 0.55 |
| 2 | Engineer, senior | 55,000 – 72,000 | 0.55 |
| 3 | Lead | 70,000 – 88,000 | 0.60 |
| 4 | Head of / VP | 88,000 – 115,000 | 0.65 |

## Principles

- The band is set by the role, not by what someone earned before.
- Nobody is hired below the band minimum, including in their first job.
- The site factor is a market adjustment and it is uncomfortable. It is written
  here rather than left implicit, because an unwritten factor is worse.

## Review

January. Out-of-cycle changes need Sam and are for role changes only, not for
counter-offers.

## What is not in a band

On-call pay, because there isn't any. Equity, which is separate and individual.
`,
  },
  {
    folder: "People and HR",
    title: "Employee Directory",
    md: `# Directory

${DEPARTMENTS.map(
  (d) => `## ${d.name} — ${d.size} ${d.size === 1 ? "person" : "people"}\n\n${
    STAFF.filter((p) => p.dept === d.name)
      .map((p) => `- **${p.name}** — ${p.role}, ${p.site}`)
      .join("\n") || "_No named contacts in this document._"
  }`,
).join("\n\n")}

---

Total headcount ${DEPARTMENTS.reduce((n, d) => n + d.size, 0)} across Bengaluru
and Lisbon. Full detail, including start dates and reporting lines, is in
Headcount & Org 2026.

Contact anyone at firstname.lastname@arkind.example. Support requests go to
support@arkind.example rather than to an individual — a named person on holiday
is how a clinic waits three days.
`,
  },

  // ============================================================== Support
  {
    folder: "Support",
    title: "Refund Policy",
    md: `# Refund policy

**Customer-facing. This is the document Support quotes.**

## Deposits

A patient who cancels more than 24 hours before their appointment is refunded
automatically. Inside 24 hours it is the clinic's decision, and the clinic can
refund from the diary with one tap.

**Refunds arrive within ten working days.** This was previously five. It was
changed in April 2026 because five was not a promise we met — our payment
provider pays out on a T+3 to T+5 schedule and the patient's bank adds its own
time. Ten is slower and true.

## Subscription fees

Charged monthly in advance. No pro-rata refund for a partial month on
cancellation; notice takes effect at the end of the paid period.

## Outages

**Service interruptions are not refundable.** Our agreement does not carry a
service credit clause and we do not offer one.

Where an incident has caused a practice direct loss, that is a conversation with
their account manager rather than a refund, and it is Sam's decision.

## Who can authorise what

| | Who |
|---|---|
| Deposit refund | Any support agent, immediately |
| Subscription credit | Elena or Sam |
| Anything described as compensation | Sam |
`,
    comments: [
      {
        author: P.rahul.name,
        content: `We gave Clearview a full month's credit after March. That is not in this document and it is the kind of thing a practice tells another practice.`,
        replies: [
          `${P.marta.name}: I authorised it and I would do it again — they had a patient charged twice and heard about it from the patient. But Rahul is right that the document and the behaviour do not match.`,
          `${P.sam.name}: The document is the boundary and I approved the exception. What we should not do is make the exception quietly and leave the next agent guessing. If we would do it again, it belongs in here.`,
          `${P.marta.name}: Then it needs a "goodwill" section with who can authorise it. Not written yet.`,
        ],
      },
    ],
  },
  {
    folder: "Support",
    title: "Escalation Playbook",
    md: `# Escalation playbook

## Before escalating

Reproduce it, or establish that you cannot. Collect the clinic name, the booking
id, what the customer saw, and when — to the minute if it involves a reminder or
a payment.

A screenshot of a screenshot is not a report.

## Severity, from the customer's side

**SEV1** — they cannot take bookings, or money is wrong. Page on-call. Tell the
customer something within 30 minutes.
**SEV2** — degraded, or a feature is down for them. Working hours, named
engineer today.
**SEV3** — one clinic, cosmetic, or has a workaround. Ticket.

Money is always SEV1 even for one patient. It is the only thing we do that a
practice cannot undo themselves.

## Who

| Area | First |
|---|---|
| Booking, availability, diary | ${P.dev.name} |
| Reminders, SMS | ${P.wei.name} |
| Payments, deposits, refunds | ${P.ana.name} |
| Mobile app | ${P.tomas.name} |
| Access, logins | ${P.ravi.name} |

Then ${P.priya.name} in every case.

## During an incident

Support owns the customer, the incident lead owns the fix. Updates every 30
minutes even when there is nothing to say, because silence reads as "it is worse
than they are admitting".

## After

If the customer asks for a written review, Support writes it and Engineering
signs it off. The customer-facing version says less than the internal one and
must not say anything untrue. That line is the whole job — see the March review.
`,
  },

  // ==================================================== Security and Access
  {
    folder: "Security and Access",
    title: "Access Register",
    md: `# Access register

Maintained by ${P.ravi.name}. This is the record; if a grant is not here, it did
not happen.

| System | Owner | Approvers | Standing access |
|---|---|---|---|
| Production database | ${P.sofia.name} | Two, one must be a lead | **None.** Time-boxed, 24 hours. |
| Production servers | ${P.sofia.name} | ${P.priya.name} | Infrastructure only |
| Payment provider dashboard | ${P.ana.name} | ${P.sam.name} | Payments team |
| SMS provider | ${P.wei.name} | ${P.priya.name} | Platform team |
| GitHub organisation | ${P.ravi.name} | Team lead | All engineers |
| AWS sandbox | ${P.ravi.name} | Team lead | All engineers |
| HR system | ${P.meera.name} | ${P.meera.name} | People team |
| Customer accounts (admin view) | ${P.marta.name} | ${P.marta.name} | Support team |

## Rules

Named individuals only. No shared accounts, no service account handed to a
person, and no standing production access for anyone including leadership.

A production grant is 24 hours and expires by itself. If you need it again, ask
again — that is deliberate friction.

## Requests

To Ravi, in writing, with the reason. "I need to check something" is not a
reason. "I am debugging INC-2026-03-17 and need to read payment_events" is.

## Reviews

Quarterly. The last one found four grants outstanding for a customer who left in
February, which is the reason the retention question (#16) got asked at all.
`,
  },
  {
    folder: "Security and Access",
    title: "Offboarding Checklist",
    md: `# Offboarding

Owned jointly by People and IT. Day one means the last working day, not later.

## Day one

- [ ] Google account suspended, not deleted (mail is retained for six months)
- [ ] GitHub organisation removed
- [ ] AWS, staging and any production grant revoked
- [ ] Payment provider and SMS provider, if they had access
- [ ] Customer admin view removed
- [ ] Laptop returned or wiped remotely
- [ ] On-call rota updated — this one gets missed

## Within a week

- [ ] Access Register updated
- [ ] Anything they were the only approver for reassigned
- [ ] Handover doc linked from their team page

## Customer offboarding is a different document

When a *customer* leaves, their data is a separate question and we do not
currently have a good answer to it. See issue #16: no deletion job exists and
nothing has ever been deleted. Do not quote a retention period to a customer,
because we do not have one.
`,
  },
];

// ----------------------------------------------------------------- sheets
//
// Spreadsheets, created through the Drive connection and nothing else.
//
// Passing `application/vnd.google-apps.spreadsheet` as the mime type to
// GOOGLEDRIVE_CREATE_FILE_FROM_TEXT makes Drive convert the CSV on the way in,
// so these are real Sheets: Drive's full-text index reaches the cells, and
// GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE reads them back as CSV. Measured
// 2026-08-17 — declaring `text/csv` instead stores a plain file that export
// then refuses.
//
// There is therefore no `googlesheets` toolkit, no fourth auth config and no
// fourth connection.
//
// Sheets earn their place by answering what prose cannot: numbers compared
// across rows. "Did tickets spike after 4.2" is a spreadsheet question, and its
// answer quantifies what issue #17 only asserts.

export const SHEETS = [
  {
    folder: "Product",
    title: "Release History 2026",
    csv: `Release,Platform,Planned,Actual,Days late,Store submitted,Store approved,Store review days,Note
4.0,Android + iOS,2026-01-16,2026-01-16,0,2026-01-13,2026-01-15,2,
4.0.1,Android + iOS,2026-01-23,2026-01-23,0,2026-01-21,2026-01-22,1,Hotfix — diary crash on tablets
4.1,Android + iOS,2026-02-27,2026-03-02,3,2026-02-26,2026-02-28,2,Slipped over a weekend
${R.version},Android,${R.planned},${R.actual},${R.slipDays},${R.appStoreSubmitted},${R.appStoreApproved},${R.appStoreReviewDays},Offline sync — see issue #8
4.2,iOS,2026-03-06,2026-04-14,39,2026-04-06,2026-04-13,7,Same codebase; iOS review took longer
4.3,Android + iOS,2026-05-15,2026-05-19,4,2026-05-14,2026-05-16,2,Phone number search
4.4,Android + iOS,2026-07-10,2026-07-10,0,2026-07-08,2026-07-09,1,
Median,,,,0,,,2,Store review median across 2026: 2 days
Note,,,,,,,,4.2 Android was ${R.slipDays} days late of which ${R.appStoreReviewDays} were store review`,
  },
  {
    folder: "Customers",
    title: "Customer Health and Churn Risk",
    csv: `Customer,Clinics,Plan,Since,ARR EUR,Jan,Feb,Mar,Apr,May,Jun,Jul,Risk,Note
${CUSTOMERS.brightsmile.name},${CUSTOMERS.brightsmile.clinics},${CUSTOMERS.brightsmile.plan},${CUSTOMERS.brightsmile.since},42720,84,83,71,68,74,79,81,Medium,Branding asked 3 quarters running
${CUSTOMERS.clearview.name},${CUSTOMERS.clearview.clinics},${CUSTOMERS.clearview.plan},${CUSTOMERS.clearview.since},${FACTS.clearview.arrEur},78,74,52,44,41,38,,CHURNED,Notice ${FACTS.clearview.noticeGiven} effective ${FACTS.clearview.effective}
${CUSTOMERS.northgate.name},${CUSTOMERS.northgate.clinics},${CUSTOMERS.northgate.plan},${CUSTOMERS.northgate.since},936,88,86,84,87,89,91,90,Low,
${CUSTOMERS.meadow.name},${CUSTOMERS.meadow.clinics},${CUSTOMERS.meadow.plan},${CUSTOMERS.meadow.since},3204,81,80,49,66,78,84,86,Low,Dropped in March on the reminder timing bug then recovered
Riverside Dental,4,Practice,2022-06,4272,79,80,77,75,78,80,79,Low,
Oakfield Veterinary,2,Starter,2025-08,936,72,74,70,71,73,75,77,Low,
Note,,,,,,,,,,,,,Health score falls before a customer says anything. Clearview was below 60 in March and nobody acted.`,
  },
  {
    folder: "Support",
    title: "Support Tickets by Month",
    csv: `Month,Total,Booking,Reminders,Payments,Login and access,Other,Median first response hours,Note
2026-01,${FACTS.support.monthlyTickets["2026-01"]},31,22,14,19,32,1.7,
2026-02,${FACTS.support.monthlyTickets["2026-02"]},34,26,15,17,32,1.8,
2026-03,${FACTS.support.monthlyTickets["2026-03"]},48,71,66,21,55,3.4,17 March incident — payments and reminders both
2026-04,${FACTS.support.monthlyTickets["2026-04"]},52,38,29,198,85,4.9,4.2 shipped 10 April — login dominates
2026-05,${FACTS.support.monthlyTickets["2026-05"]},44,31,22,79,57,2.6,Login tail continues
2026-06,${FACTS.support.monthlyTickets["2026-06"]},39,28,18,34,57,2.0,
2026-07,${FACTS.support.monthlyTickets["2026-07"]},37,27,16,25,56,1.9,
Baseline,121,32,24,15,18,32,1.75,Jan-Feb average
Note,,,,,,,,,April login tickets were 198 against a baseline of 18. Brightsmile alone opened 11.`,
  },
  {
    folder: "People and HR",
    title: "Headcount and Org 2026",
    csv: `Department,Site,Headcount,Open roles,Note
${DEPARTMENTS.map((d) => {
  const open =
    d.name === "Engineering — Mobile" ? 1 : d.name === "Customer Success & Support" ? 1 : 0;
  const note =
    d.name === "Engineering — Mobile"
      ? "Two engineers carrying the app — see issue #19"
      : d.name === "Engineering — Payments"
        ? "Three people, one SEV1 category"
        : d.name === "Customer Success & Support"
          ? "April cost two people most of a month"
          : "";
  return `${d.name},${d.site},${d.size},${open},${note}`;
}).join("\n")}
Total,,${DEPARTMENTS.reduce((n, d) => n + d.size, 0)},2,Bengaluru ${DEPARTMENTS.filter((d) => d.site === "Bengaluru").reduce((n, d) => n + d.size, 0)} / Lisbon ${DEPARTMENTS.filter((d) => d.site === "Lisbon").reduce((n, d) => n + d.size, 0)} / split ${DEPARTMENTS.filter((d) => d.site === "both").reduce((n, d) => n + d.size, 0)}`,
  },
  {
    folder: "Product",
    title: "Pricing Tiers",
    csv: `Plan,EUR per clinic per month,Annual EUR per clinic,Online booking,SMS reminders,Deposits,Reporting,Multi-site,API,Support
${FACTS.pricing.tiers
  .map(
    (t) =>
      `${t.name},${t.eurPerClinicMonth},${Math.round(t.eurPerClinicMonth * 12 * 0.88)},Yes,${
        t.name === "Starter" ? "Email only" : "Yes"
      },${t.name === "Starter" ? "No" : "Yes"},${t.name === "Starter" ? "No" : "Yes"},${
        t.name === "Group" ? "Yes" : "No"
      },${t.name === "Group" ? "Yes" : "No"},${t.name === "Group" ? "Priority" : "Standard"}`,
  )
  .join("\n")}
Free,0,0,-,-,-,-,-,-,-
Note,,,,,,,,,No free tier exists. The row above is the proposal argued in issue #18 and not agreed.
Deposit model,,,,,,,,,${FACTS.pricing.depositModel} — issue #15 asks whether a percentage is right at all`,
  },
  {
    folder: "People and HR",
    title: "On-call Rota Q3 2026",
    csv: `Week starting,Engineer,Site,Local hours,Pages received,Note
2026-07-06,${P.dev.name},Bengaluru,11:30-02:30,3,
2026-07-13,${P.sofia.name},Lisbon,06:00-21:00,1,
2026-07-20,${P.wei.name},Bengaluru,11:30-02:30,4,Two after midnight local
2026-07-27,${P.karan.name},Bengaluru,11:30-02:30,2,
2026-08-03,${P.tomas.name},Bengaluru,11:30-02:30,0,
2026-08-10,${P.ana.name},Lisbon,06:00-21:00,2,
2026-08-17,${P.dev.name},Bengaluru,11:30-02:30,,Current
2026-08-24,${P.ravi.name},Bengaluru,11:30-02:30,,
2026-08-31,${P.sofia.name},Lisbon,06:00-21:00,,
2026-09-07,${P.wei.name},Bengaluru,11:30-02:30,,
2026-09-14,${P.karan.name},Bengaluru,11:30-02:30,,
2026-09-21,${P.tomas.name},Bengaluru,11:30-02:30,,
2026-09-28,${P.ana.name},Lisbon,06:00-21:00,,
Summary,,,,,8 of 13 weeks fall to Bengaluru engineers whose window ends at 02:30 local. Issue #13.`,
  },
];
