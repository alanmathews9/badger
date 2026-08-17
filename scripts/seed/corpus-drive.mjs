// The Google Drive half of the Arkind corpus.
//
// Drive holds what a company writes down for itself and for its clients: the
// onboarding pack, the team pages, the HR policies, the roadmaps, and the
// client-facing version of events. GitHub holds the argument. Gmail holds what
// was actually said to whom. No single one of the three answers
// "why did Halden slip?" the same way, which is the demo.
//
// Two deliberate seams, both of which exist in every real company:
//
//   1. `Halden Logistics — Engagement Retro` is the client-facing document.
//      It says the engagement slipped because scope changed. GitHub issue #2
//      says roughly four of the six weeks were self-inflicted. Both are filed;
//      neither mentions the other.
//
//   2. `HR — Leave Policy 2026` supersedes `handbook/leave.md` in the GitHub
//      repo and gives a different carry-over number. Documents drift, the old
//      copy stays reachable, and a search engine that returns only one of them
//      is lying by omission.
//
// Comments carry the disagreement, the same way GitHub issue comments do.
// GOOGLEDRIVE_LIST_COMMENTS is in the agent's read allowlist for exactly this.

export const ROOT = "Arkind";

/** Folder tree, parents first — the runner relies on this order. */
export const FOLDERS = [
  "Onboarding",
  "Teams",
  "Clients",
  "Clients/Halden Logistics",
  "Clients/Verity",
  "Roadmaps",
  "People and HR",
  "Access and Security",
];

export const DOCS = [
  // ---------------------------------------------------------------- onboarding
  {
    folder: "Onboarding",
    title: "New Joiner — First Week Checklist",
    md: `# New joiner — first week

Owner: Meera Iyer (People). Last reviewed 4 May 2026.

Everything here should be done by end of day five. If something is blocked,
say so in #joiners rather than waiting — half of this list depends on somebody
else pressing a button.

## Day one

- [ ] Laptop collected or delivered. Ravi Menon ships to Lisbon on Tuesdays.
- [ ] Google account active, 2FA enrolled. **2FA is not optional and IT will
      disable an account that has gone seven days without it.**
- [ ] Slack, and read the channel list in the glossary before joining twelve
      of them.
- [ ] Payroll form and bank details to Meera. Cut-off for the current month is
      the 18th.
- [ ] Photo and one-line bio for the site, if you want one. Genuinely optional.

## Day two and three

- [ ] Read \`playbooks/engagement-lifecycle.md\` in the internal repo. It is
      short and it is the closest thing we have to a house style.
- [ ] Read the security handbook. The laptop encryption section applies to you
      from day one, not from your first client.
- [ ] Request the access you need — see **Access Register** in
      Access and Security. Do not ask in Slack; the register exists so that
      requests are traceable.
- [ ] 30 minutes with your practice lead. Tomas for Data & Platform, Luca for
      Product Engineering.

## Day four and five

- [ ] Shadow one client call. Any client, any call. Ask your lead.
- [ ] Pick your buddy's brain about the retro habit. Every engagement ends with
      one and the uncomfortable version is the one that gets filed.
- [ ] Book your first-month check-in with Meera.

## What nobody tells you

We turn down work we cannot staff properly. If you are ever on an engagement
that feels understaffed, that is a mistake rather than a policy, and saying so
early is the entire job.

Expenses are reimbursed monthly and late claims are a recurring argument — read
\`handbook/travel-and-expenses.md\` before your first trip, not after.`,
  },
  {
    folder: "Onboarding",
    title: "Onboarding — Engineering Setup",
    md: `# Engineering setup

Owner: Dev Bhattacharya. Last reviewed 21 March 2026.

## Accounts you will need on day one

| System | Who approves | Typical wait |
|---|---|---|
| GitHub org (arkind) | Ravi Menon | same day |
| AWS — sandbox | Ravi Menon | same day |
| AWS — client accounts | practice lead, then client | 2–9 days |
| Datadog | Ravi Menon | same day |
| 1Password | Meera Iyer | same day |

Client systems are the slow ones and they are slow for reasons outside our
control. On Halden the Oracle read replica took nine days against a date of
19 January, and that delay is still visible in the engagement retro. **Ask for
client access the day you are staffed, not the day you need it.**

## Local environment

We do not have a house language. Data & Platform is Python and dbt; Product
Engineering is TypeScript. Both practices run everything through Docker so that
the version argument never happens.

- \`asdf\` for runtime versions. The \`.tool-versions\` file in each repo is
  authoritative.
- Pre-commit hooks are mandatory on client repositories. They are what stops a
  credential reaching a client's history, which has happened to us once.
- Never point a local environment at a client's production database, even
  read-only, even briefly. Use the replica.

## Repository conventions

Commit messages read like changelog entries: what changed and why. A reviewer
should be able to reconstruct a decision from \`git log\` alone without asking
anybody, because in eighteen months there will be nobody left to ask.

Every engagement repository carries a \`README\` naming the client contact, the
escalation path and the date the engagement closes. If that file is stale, the
engagement is stale.`,
  },
  {
    folder: "Onboarding",
    title: "Onboarding — Joining an Engagement Mid-Flight",
    md: `# Joining an engagement mid-flight

Draft. Owner: Ana Ferreira. Raised as issue #17 in the internal repo and still
open — this document is the working version and it is not yet policy.

Joining in week nine is different from joining at kickoff and we keep pretending
it is not. Three people have now had the same bad first fortnight.

## Before your first day on the engagement

The lead owes you, in writing:

1. The SOW, and specifically the **Not doing** section. What is out of scope is
   more useful than what is in it.
2. The kickoff notes, including anything left as "to confirm". Halden's
   reconciliation module was sitting unanswered in the kickoff notes for six
   weeks before it arrived as a surprise.
3. The current risk list, honestly stated.
4. Who the client's decision-maker is, as distinct from who attends the calls.

## Your first week

- Read every weekly status sent so far, oldest first. It takes an afternoon and
  it is the fastest way to understand why the engagement is where it is.
- Do not fix anything in week one. Ask why it is like that.
- Find out what has already been escalated and what has been quietly absorbed.
  The second list is the one that hurts.

## What we owe you

A named buddy on the engagement who is not the lead. The lead is the person
with the least time and the most reason to present things optimistically.`,
  },
  {
    folder: "Onboarding",
    title: "Arkind Glossary",
    md: `# Glossary

Owner: Meera Iyer. Last reviewed 12 February 2026.

**Practice** — one of our three delivery groups: Data & Platform, Product
Engineering, Delivery & Client Ops.

**Engagement** — a single contracted piece of client work. Has a SOW, a lead,
a close date and a retro. If it has no close date it is not an engagement, it
is a staffing arrangement, and we price those differently.

**Discovery** — the paid, time-boxed period before we commit to a price. The
pricing playbook says three weeks when a migration is in scope. It has been
compressed once, on Halden, and that decision is discussed at length in the
retro issue.

**CR / change request** — priced in writing before work starts. The Halden
reconciliation module went in without one and cost roughly three weeks
unpriced. This is the origin of the rule.

**The uncomfortable version** — the internal retro, filed as a GitHub issue
alongside the client-facing document. Company shorthand, and taken seriously.

**Contingency** — the 20% we add to fixed-price work. Halden burned €118,000
against an €82,400 contingency, which is the number people mean when they say
"we should not have fixed-priced that one".

**T&M with a cap** — time and materials, ceiling agreed up front. What Sam
argues for whenever discovery is compressed.

## Channels

\`#joiners\` questions from anyone in their first month, no matter how basic.
\`#delivery\` engagement-level noise, statuses, escalations.
\`#access\` requests go in the Access Register, not here. The channel is for
chasing, not asking.`,
  },

  // -------------------------------------------------------------------- teams
  {
    folder: "Teams",
    title: "Team — Data & Platform",
    md: `# Data & Platform

Lead: Tomas Lindqvist. Eleven people. Bengaluru and Lisbon.

Migrations, warehouses, event pipelines. The practice that carries the most
fixed-price risk, because migrations are the work where the thing you are
migrating is not what the documentation says it is.

## People

| Person | Focus | Base |
|---|---|---|
| Tomas Lindqvist | Lead, migrations | Lisbon |
| Dev Bhattacharya | Schema and tooling | Bengaluru |
| Ana Ferreira | Pipelines | Lisbon |
| Rahul Desai | dbt, modelling | Bengaluru |
| Marta Nowak | Cutover and rehearsal | Lisbon |

Three further consultants rotate in from Delivery depending on load. September
capacity is the recurring problem and is tracked as issue #3 in the internal
repo.

## What we are known for

Reversible migration tooling. On Halden we rolled back twice during rehearsal
and the client never saw an incident, and that is the single thing that keeps
being cited back to us in sales conversations.

## What we keep getting wrong

Estimating against client documentation instead of the client's actual schema.
Halden's freight schema had 340 tables where the documentation implied about
120, found in week two by Dev. Most were trivial, but the review time was not
planned for. **A table-level count is now mandatory in discovery** — the rule
is in \`playbooks/discovery.md\`.

## Who to ask

Anything commercial, Sam Whitfield. Anything about whether a migration is
realistic in the time available, Tomas — and he would rather be asked before
the proposal goes out than after.`,
  },
  {
    folder: "Teams",
    title: "Team — Product Engineering",
    md: `# Product Engineering

Lead: Luca Bianchi. Fourteen people. Mostly Bengaluru.

We build and extract product surfaces: the thing the client's customers touch,
or the service the client cannot safely pull out of their monolith on their own.

## Current engagements

- **Verity** — extracting the notification service out of a fifteen-year-old
  Rails monolith. Phased plan in Roadmaps. Discussed as issue #16 internally,
  and there is no agreement yet on strangler-fig versus a clean rewrite behind
  a facade.
- **Nomura Park** — closed. Access was found still live four months after close,
  which is why the offboarding checklist now exists and why it has a named
  owner.

## People

| Person | Focus | Base |
|---|---|---|
| Luca Bianchi | Lead | Bengaluru |
| Nadia Okonkwo | Frontend, joined June 2026 | Lisbon |
| Karan Shah | Rails, extraction | Bengaluru |
| Sofia Almeida | Platform, CI | Lisbon |
| Wei Zhang | Notifications, queues | Bengaluru |

## How we work

Trunk-based, feature-flagged, and the client's engineers are in the pairing
rotation from week one. This is not generosity. If we build something the
client's team has never seen, we have handed them a liability rather than a
system, and they will call us in eighteen months when we have moved on.`,
  },
  {
    folder: "Teams",
    title: "Team — Delivery and Client Ops",
    md: `# Delivery and Client Ops

Lead: Priya Raghunathan. Nine people across both offices.

Commercials, staffing, client relationships, and the retro habit. Delivery does
not write the code; Delivery is why the engagement has a shape.

## What Delivery owns

- The SOW, and defending the **Not doing** section when it is under pressure
- Staffing and utilisation, tracked quarterly — see issue #13
- Weekly written status to every active client, Fridays, without exception
- The retro, both versions, at the close of every engagement
- Escalation. The path is lead → Priya → Sam, and it is in every kickoff note

## The retro rule

Every engagement ends with two documents. The client-facing retro goes in the
client's folder in Drive. The internal one is filed as an issue in the internal
repository, because a GitHub thread keeps the disagreement attached to the
conclusion and a document does not.

They will not always say the same thing. That is the point, and it is also the
thing a new joiner finds most surprising.

## Standing arguments

Fixed price versus T&M when discovery has been compressed. Sam's position after
Halden is T&M with a cap or walk away. It is not yet written into the pricing
playbook and Halden phase 2 will decide it.`,
  },
  {
    folder: "Teams",
    title: "On-Call and Escalation Paths",
    md: `# On-call and escalation

Owner: Priya Raghunathan. Last reviewed 2 June 2026.

## We do not run a 24/7 rota

We are a consultancy, not an operator. Where an engagement requires out-of-hours
cover it is priced separately and named in the SOW. If a client expects it and
it is not in the SOW, that is a commercial conversation and not an engineering
one — bring it to Priya rather than solving it by being available.

## Escalation inside an engagement

    engineer  →  engagement lead  →  Priya Raghunathan  →  Sam Whitfield

Escalate on the second occurrence, not the fifth. Every engagement that has gone
badly went badly slowly, and the honest version of the timeline was always
available weeks before anyone said it out loud.

## Client-side escalation

Named in the kickoff notes for each engagement. For Halden it was
Joris van Dijk, then their CTO. Two facts worth carrying into the next kickoff:

1. A dependency with an owner and a date but **no escalation trigger** will
   simply be late. Halden's Oracle replica was nine days late and nobody
   escalated, because there was nothing that said when to.
2. The person who attends the calls is not always the person who decides.

## Security incidents

Immediately to Ravi Menon and Sam Whitfield, in that order, and by phone. Not
Slack. This includes lost hardware, a credential in a git history, and access
that should have been revoked and was not.`,
  },

  // ------------------------------------------------------------------ clients
  {
    folder: "Clients/Halden Logistics",
    title: "Halden Logistics — Engagement Retro",
    md: `# Halden Logistics — engagement retro

**Prepared for:** Joris van Dijk, Halden Logistics
**Filed:** 8 June 2026 by Tomas Lindqvist
**Planned:** 14 weeks, closing 24 April 2026
**Actual:** 20 weeks, closed 5 June 2026
**Overrun:** 6 weeks

This is the version shared with Halden.

## Summary

The engagement delivered its scope. The migration off Oracle is complete, the
event pipeline is live, and Halden's platform team has taken it over. It took
six weeks longer than planned.

## What went well

- The migration tooling was genuinely reversible, and we used that twice during
  rehearsal without any client-visible incident.
- The cutover rehearsal in week 15 caught two ordering bugs before they reached
  production.
- Handover was clean. Halden's team was running the pipeline unaided within a
  fortnight.

## What went badly

- **Scope changed mid-engagement.** The reconciliation module was added in
  week 6 following client discussion.
- Oracle read replica access arrived nine days after the agreed date of
  19 January, compressing early work.
- Schema mapping sign-off took eleven working days against an agreed five.

## Actions we are taking

1. Client dependencies will carry a named owner, a date **and an escalation
   trigger**. A date with no trigger is a wish.
2. Change requests will be priced in writing before work starts, without
   exception.
3. Discovery for migrations will include a table-level count of the source
   system rather than an estimate from documentation.

## For phase 2

We would like to discuss commercial structure before scoping. Our
recommendation is time and materials with an agreed cap.`,
    comments: [
      {
        content:
          "Tomas — this says \"scope changed mid-engagement\" and stops there. The internal retro (issue #2) has us concluding that roughly four of the six weeks were self-inflicted: compressed discovery, and then absorbing the reconciliation module without a CR. I am not arguing we send Joris the internal version. I am arguing that anyone who reads only this document will draw the wrong lesson, including us in eighteen months.",
        author: "Priya",
        replies: [
          "Tomas: Agreed, and it is my engagement so it is my omission. The compromise I would defend is that the Actions section is honest even though the causes section is not — every action listed is a fix for something we did. Someone reading only this still ends up in the right place. Barely.",
          "Sam: Leave the client version as it stands. We are not writing our own indictment for a client we intend to sell phase 2 to. The internal issue is the record. That is what it is for.",
        ],
      },
    ],
  },
  {
    folder: "Clients/Halden Logistics",
    title: "Halden — Weekly Status, Week 6",
    md: `# Halden — weekly status

**Week 6** — w/c 23 February 2026
**To:** Joris van Dijk, Elke Sanders
**From:** Tomas Lindqvist

## Progress

- Schema mapping complete for the booking and pricing domains
- Migration tooling running end to end against the replica, reversible path
  tested twice
- Event pipeline scaffolded; first booking events flowing to the staging
  pricing service

## In flight

- Reconciliation: picking this up following our conversation this week. Sizing
  it now and will confirm impact in next week's status.
- Historical load for 2019 onwards, in progress

## Risks

| Risk | Status |
|---|---|
| Schema sign-off turnaround | **Amber** — eleven working days against five agreed |
| Source table count higher than scoped | Amber — 340 tables against ~120 implied |
| Reconciliation scope | New this week |

## Asks of Halden

- Sign-off on the pricing domain mapping by Friday
- Confirmation of who owns reconciliation acceptance

---

*Note added by Priya, 9 June 2026, while assembling the retro pack: this status
is the only place the reconciliation module is described as "picking this up",
and no change request followed. The impact promised "next week" was never sent
as a separate note.*`,
    comments: [
      {
        content:
          "This is the document that answers whether Halden were told. They were told we were picking it up. They were never told what it would cost, and we never asked. Both of those are ours.",
        author: "Priya",
        replies: [
          "Tomas: Correct, and it is worse than it looks — \"will confirm impact in next week's status\" is a commitment I made and did not keep. Week 7's status does not mention reconciliation at all.",
        ],
      },
    ],
  },
  {
    folder: "Clients/Halden Logistics",
    title: "Halden Phase 2 — Proposal Draft",
    md: `# Halden phase 2 — proposal draft

**Status: DRAFT — not sent.** Owner: Tomas Lindqvist, with Sam Whitfield on
commercials. Internal discussion is issue #18.

## What Halden are asking for

Decommissioning of the Oracle instance, the customs declaration module, and
historical data before 2019 — all three explicitly excluded from phase 1.

## Why this is not phase 1 again

Phase 1 was fixed price at €412,000 across a planned fourteen weeks, and closed
six weeks late at €118,000 over against an €82,400 contingency. The causes are
in the retro. The commercial lesson is narrower than the delivery lesson: we
priced a migration off a system we could not inspect until week one.

The customs declaration module is the same shape. We have never seen it. Halden's
own documentation of it is, by their admission, out of date.

## Recommended structure

**Time and materials with a cap**, three-week paid discovery first, and the cap
set after discovery rather than before it.

## The risk of proposing this

Halden chose us on phase 1 partly on a fixed price, against a competitor who
also quoted fixed. Joris has said he prefers the certainty. There is a real
chance this loses us the work.`,
    comments: [
      {
        content:
          "Fixed price again on a module we have never seen would be the same mistake with better notes. T&M with a cap, or we walk. I would rather lose phase 2 than run another Halden.",
        author: "Sam",
        replies: [
          "Priya: Agreed on structure. But we should be honest with Joris about why the terms changed, and the honest answer involves telling him that a good part of phase 1's overrun was ours. We cannot use \"scope changed\" as the reason for the overrun and then demand T&M because the scope is unknowable.",
          "Tomas: That is the sharpest version of the problem and I do not have an answer to it. Parking until we have the phase 2 kickoff date.",
        ],
      },
    ],
  },
  {
    folder: "Clients/Verity",
    title: "Verity — Discovery Findings",
    md: `# Verity — discovery findings

**Engagement:** notification service extraction
**Discovery:** three weeks, ran to time. Owner: Luca Bianchi.

Three weeks, as the playbook requires for anything with a migration or an
extraction in it. This is the first engagement since Halden where discovery was
not compressed, and the difference is visible in how few surprises this document
contains.

## The system

Rails monolith, first commit 2011. Notifications are not a module; they are a
pattern repeated in 34 places, six of which write directly to the delivery
table without going through the mailer at all.

Counted, not estimated: **34 call sites, 6 direct writers, 11 notification
types, 2 templating systems.**

## What makes this hard

1. The six direct writers have no tests and one of them is inside a nightly job
   nobody at Verity currently owns.
2. Two templating systems, one of which is a fork of a gem abandoned in 2017.
3. Verity's own team is building a new preferences service against the same
   tables, concurrently.

## Recommendation

Strangler fig, not a rewrite behind a facade. The nightly job is the deciding
argument: we cannot safely cut over something nobody owns, so we need the
ability to run both paths in parallel and compare output for a full billing
cycle.

This is contested — see issue #16. Karan's position is that the fork makes the
strangler approach more expensive than it looks.

## Access

Verity restrict access to their production environment to named individuals
and it took eleven days to add Ana in June. Factor that into any staffing
change: adding a person is not free and it is not fast.`,
  },

  // ----------------------------------------------------------------- roadmaps
  {
    folder: "Roadmaps",
    title: "Data and Platform — H2 2026 Roadmap",
    md: `# Data & Platform — H2 2026

Owner: Tomas Lindqvist. Reviewed with Sam and Priya, 20 June 2026.

This is a capacity plan wearing a roadmap's clothes. The practice is eleven
people and two of the four items below need the same three.

## Committed

| Q | Item | Client | Confidence |
|---|---|---|---|
| Q3 | Halden phase 2 discovery | Halden | Medium — commercials unresolved |
| Q3 | Verity warehouse foundations | Verity | High |
| Q4 | Halden phase 2 delivery | Halden | Low — depends on discovery |

## Internal, unfunded

- **Migration tooling as a product.** The reversible tooling built for Halden
  is the thing clients ask about most in sales conversations and it currently
  exists as a folder in one engagement repository. Packaging it is maybe four
  weeks and has been on this roadmap in some form since 2024.
- **Discovery table-count automation.** The rule that came out of the Halden
  retro is currently a human counting tables. It should be a script. Half a
  week, and it keeps being displaced by billable work.

## The September problem

September is oversubscribed on current assumptions and has been flagged since
May as issue #3. Halden phase 2 delivery and Verity foundations both want Dev
and Marta. If Halden phase 2 lands on the dates Joris wants, something gives,
and the honest options are: hire, subcontract, or tell Halden Q4.

Sam's position is that we do not staff an engagement we cannot staff properly,
which resolves the argument but does not resolve the September.`,
  },
  {
    folder: "Roadmaps",
    title: "Internal Tooling Roadmap 2026",
    md: `# Internal tooling — 2026

Owner: Sofia Almeida. This roadmap is funded out of the 8% non-billable
allocation and slips whenever billable work needs the people, which is most
quarters. It is stated here rather than pretended away.

## Shipped this year

- **Engagement scaffold.** One command produces the repository, the README with
  client contact and escalation path, the status template and the retro stub.
  Adoption is total because the alternative is doing it by hand.
- **Pre-commit secret scanning**, mandatory on client repositories since March.
  Written after a credential reached a client's history in 2025.

## In progress

- **Access register automation.** The register in Access and Security is a
  document maintained by hand and is already wrong in at least one place — the
  Halden Oracle owner is listed as Elke, and Elke left Halden in April.
  Target: read the real state from each provider rather than restate it.

## Wanted, unscheduled

- Weekly status assembly from the engagement repository, so that a status is
  generated from what happened rather than remembered on a Friday afternoon.
- Utilisation reporting that does not live in a spreadsheet Priya maintains.
- A search tool that can answer a question across the repository, Drive and
  mail at once. Currently a person, and usually Priya.`,
  },
  {
    folder: "Roadmaps",
    title: "Verity Extraction — Phased Plan",
    md: `# Verity — notification extraction, phased plan

Owner: Luca Bianchi. Version 3, 1 July 2026. Supersedes the version circulated
in May, which assumed a clean cutover.

## Phase 0 — parallel run harness (3 weeks)

Build the comparison harness before touching anything. Both paths run, output
is compared for one full billing cycle, differences are logged rather than
alerted on. Nothing is cut over in this phase and that is deliberate.

## Phase 1 — the 28 clean call sites (5 weeks)

Route through the new service behind a flag, in batches by notification type.
Reversible per type.

## Phase 2 — the 6 direct writers (6 weeks, low confidence)

The hard part. No tests, one owned by nobody, and the nightly job is the reason
the whole plan is strangler-fig rather than a rewrite. Estimate is a guess
until the harness has run for a cycle, and it is labelled a guess on purpose.

## Phase 3 — templating consolidation (unscoped)

Two systems, one a fork of a gem abandoned in 2017. Explicitly out of scope for
this engagement. Naming it here so that it is not mistaken for something we
agreed to.

## Dependencies on Verity

| Dependency | Owner | Note |
|---|---|---|
| Production access for named individuals | Verity IT | Eleven days for Ana in June. Assume two weeks. |
| Owner for the nightly job | Verity, unresolved | **Escalation trigger: if unnamed by end of phase 0, phase 2 does not start.** |
| Preferences service interface freeze | Verity platform | Their team, same tables |

That escalation trigger is the Halden lesson written down. A dependency with a
date and no trigger is simply late.`,
  },

  // -------------------------------------------------------------- people & hr
  {
    folder: "People and HR",
    title: "HR — Leave Policy 2026",
    md: `# Leave policy 2026

Owner: Meera Iyer. Effective 1 January 2026. **Supersedes
\`handbook/leave.md\` in the internal repository, which has not been updated
and still states the 2024 carry-over rule.**

## Annual leave

30 days, plus public holidays in your base location. Leave is not accrued
monthly; the full entitlement is available from 1 January, or pro rata from
your start date.

## Carry-over

**Up to 10 days may be carried into the next year, and must be used by 31 March.**

This is the number that changed. The old handbook says 5 days with no deadline.
If you have been planning against 5, you have more than you think; if you have
been sitting on 12, you will lose 2.

## Unpaid leave and sabbatical

After two years, up to three months unpaid, subject to engagement commitments.
Discuss with your practice lead before Meera — the constraint is almost always
staffing rather than policy.

## Sick leave

Not counted and not tracked against a limit. Tell your lead, not People. We have
never had a problem with this and would rather not create a policy that assumes
we will.

## Parental leave

26 weeks at full pay for the primary carer, 8 weeks for the secondary carer,
in both locations regardless of statutory minimum. Notify Meera at least eight
weeks before the intended start where that is possible.`,
    comments: [
      {
        content:
          "The carry-over number here (10 days, expiring 31 March) contradicts handbook/leave.md in the GitHub repo, which still says 5 with no deadline. Both are reachable and neither points at the other. Two people have already planned against the wrong one.",
        author: "Meera",
        replies: [
          "Ravi: The handbook copy should be deleted rather than updated, otherwise we will be maintaining two. One of them will drift again.",
          "Priya: Deleting it silently is worse — anyone who has bookmarked it gets a 404 with no explanation. Replace the body with a pointer to this document and the date it moved.",
        ],
      },
    ],
  },
  {
    folder: "People and HR",
    title: "HR — Compensation Bands 2026",
    md: `# Compensation bands 2026

Owner: Meera Iyer, with Sam Whitfield. Reviewed annually in November, effective
1 January.

Bands are published internally because the alternative is that people find out
the shape of the ladder by accident, usually while resigning.

## Bands

| Band | Role | Lisbon (EUR) | Bengaluru (INR lakh) |
|---|---|---|---|
| 1 | Consultant | 42,000 – 55,000 | 18 – 26 |
| 2 | Senior Consultant | 55,000 – 72,000 | 26 – 38 |
| 3 | Lead / Principal Consultant | 72,000 – 95,000 | 38 – 55 |
| 4 | Practice Lead | 95,000 – 125,000 | 55 – 75 |

Location bands reflect local market and cost, not a judgement about the work.
The ratio is reviewed every year and was widened in 2025 after the Bengaluru
market moved.

## How movement works

Band changes happen at the November review, or on promotion at any time. There
is no separate negotiation cycle and no mechanism by which asking loudly moves
you faster — that is the point of publishing the bands.

## Bonus

There is no individual bonus scheme. A company-wide profit share is paid in
March when the year allows it, at the same percentage of salary for everyone.
2026 paid 4%. 2025 paid nothing, because Halden's overrun and one other
engagement consumed the margin.

## What is not in a band

Travel, which is reimbursed rather than compensated. Equipment. Conference
budget, which is €1,500 a year and is not means-tested against your band.`,
  },
  {
    folder: "People and HR",
    title: "HR — Performance Review Cycle",
    md: `# Performance and review

Owner: Meera Iyer. Last reviewed 5 May 2026.

## The cycle

One formal review a year, in November, feeding the January band effective date.
One lighter check-in in May. Everything else is the ordinary conversation with
your lead, which is where the actual feedback lives.

## What is assessed

Three things, weighted equally:

1. **The work.** Did engagements you were on go well, and were you part of why.
2. **The client.** Would they ask for you by name.
3. **The company.** Playbooks, retros, onboarding, the parts nobody bills for.

The third one is real and is the most commonly under-claimed. Writing the
discovery table-count rule into the playbook after Halden counted for more in
Dev's review than any of the migration work did.

## Who writes it

Your practice lead, with input from every engagement lead you worked under that
year. You write a self-assessment first and it is genuinely read first.

## Disagreement

Take it to Meera, and it is escalated to Sam if unresolved. This has happened
twice and the outcome changed once.

## Leaving

Exit conversations are with Meera, not your lead, and what is said is not
attributed. The offboarding checklist in Access and Security is separate and
is mandatory — Nomura Park access was still live four months after that
engagement closed, and that is what the checklist exists to prevent.`,
  },
  {
    folder: "People and HR",
    title: "Employee Directory 2026",
    md: `# Directory — 2026

Owner: Meera Iyer. Internal only. Do not share outside Arkind; it is not
published on the site and half of it is personal contact detail.

Forty-one people. Bengaluru and Lisbon. Started 2019.

## Leadership

| Name | Role | Base | Started |
|---|---|---|---|
| Sam Whitfield | Principal, commercials | Lisbon | 2019 |
| Priya Raghunathan | Delivery Principal | Bengaluru | 2020 |
| Meera Iyer | Head of People | Bengaluru | 2021 |

## Data & Platform

| Name | Role | Base | Started |
|---|---|---|---|
| Tomas Lindqvist | Practice Lead | Lisbon | 2019 |
| Dev Bhattacharya | Senior Engineer | Bengaluru | 2021 |
| Ana Ferreira | Consultant | Lisbon | 2023 |
| Rahul Desai | Senior Consultant | Bengaluru | 2022 |
| Marta Nowak | Consultant, cutover | Lisbon | 2024 |

## Product Engineering

| Name | Role | Base | Started |
|---|---|---|---|
| Luca Bianchi | Practice Lead | Bengaluru | 2020 |
| Karan Shah | Senior Engineer | Bengaluru | 2021 |
| Sofia Almeida | Platform and CI | Lisbon | 2022 |
| Wei Zhang | Engineer, queues | Bengaluru | 2023 |
| Nadia Okonkwo | Consultant | Lisbon | June 2026 |

## Operations

| Name | Role | Base | Started |
|---|---|---|---|
| Ravi Menon | IT and Systems | Bengaluru | 2020 |

## Who to ask for what

Payroll, leave, anything personal — Meera Iyer.
Access to anything, internal or client — Ravi Menon, via the Access Register.
Whether we should take a piece of work — Sam Whitfield.
Whether an engagement is in trouble — Priya Raghunathan, and earlier than feels
comfortable.`,
  },

  // ------------------------------------------------------- access and security
  {
    folder: "Access and Security",
    title: "Access Register — Systems, Owners and How to Request",
    md: `# Access register

Owner: Ravi Menon. Last reviewed 12 June 2026.

**Requests go through this register, not through Slack.** The register exists so
that there is a record of who asked, who approved and when it was granted —
which is the same record we need at offboarding. A Slack message is not a record.

## How to request

1. Find the system below and its approver.
2. Mail Ravi Menon with the system, the reason, and the engagement it is for.
   Copy the approver.
3. The approver replies to that thread. Approval in a thread is the audit trail.
4. Ravi grants and notes the date here.

Client systems additionally need the client's own approval and that is the part
that takes time. **Ask on the day you are staffed, not the day you need it.**

## Internal systems

| System | Approver | Typical wait |
|---|---|---|
| Google Workspace | Meera Iyer | same day |
| GitHub org (arkind) | Ravi Menon | same day |
| AWS sandbox | Ravi Menon | same day |
| 1Password | Meera Iyer | same day |
| Datadog | Ravi Menon | same day |
| Payroll system | Meera Iyer only | not delegated |

## Client systems

| System | Arkind approver | Client approver | Observed wait |
|---|---|---|---|
| Halden — Oracle read replica | Tomas Lindqvist | Elke Sanders | **9 days** against an agreed date |
| Halden — AWS eu-west-1 | Tomas Lindqvist | Joris van Dijk | 3 days |
| Verity — production | Luca Bianchi | Verity IT, named individuals only | **11 days** (Ana, June 2026) |
| Verity — staging | Luca Bianchi | Verity IT | 2 days |
| Nomura Park — all | closed engagement | — | revoked June 2026 |

The observed-wait column is real history rather than a service level. It is here
because engagement plans keep assuming access is instant, and the Halden retro
has a nine-day dependency slip in it that was entirely foreseeable.

## Revocation

At engagement close, the lead runs the offboarding checklist within five working
days. Nomura Park access was live four months after close and was found by
accident, not by process.`,
    comments: [
      {
        content:
          "Elke Sanders left Halden in April 2026 and is still listed as the client approver for the Oracle replica. If anyone follows this register for Halden phase 2 they will mail an address that bounces. This is exactly the failure mode the automation item on the tooling roadmap is meant to remove.",
        author: "Ravi",
        replies: [
          "Tomas: Joris is the approver for everything Halden now. I will confirm the replacement DBA name at the phase 2 kickoff rather than guess it here.",
        ],
      },
    ],
  },
  {
    folder: "Access and Security",
    title: "Offboarding Checklist",
    md: `# Offboarding checklist

Owner: Ravi Menon. Mandatory. Applies to two different events that are often
confused: **a person leaving Arkind**, and **an engagement closing**. Both leak
access, and the second one is the one we got wrong.

## When an engagement closes

Run by the engagement lead within five working days of the close date.

- [ ] Client production and staging access revoked for every Arkind person
- [ ] Client VPN and SSO accounts disabled, confirmed **by the client in
      writing** rather than assumed
- [ ] Shared credentials rotated, including any the client gave us verbally
- [ ] Arkind laptops carrying client data wiped of it, confirmed per person
- [ ] Engagement repository archived, README updated with the close date
- [ ] Retro filed — both versions
- [ ] Access Register updated to show the engagement as closed

Nomura Park closed in February 2026 and our access was still live in June. It
was found by a member of the team noticing a dashboard still loaded, which is
not a control. Issue #7 in the internal repository is the write-up.

## When a person leaves

Run by Ravi with Meera, on the last working day.

- [ ] Google Workspace suspended, not deleted, for 90 days
- [ ] GitHub org membership removed and personal access tokens revoked
- [ ] 1Password vaults removed and every shared credential they held rotated
- [ ] AWS access keys deleted, not just deactivated
- [ ] Client systems: every row in the Access Register naming that person
- [ ] Laptop returned and wiped
- [ ] Slack deactivated

## The rule underneath both

Revocation is a task with an owner and a date, exactly like a client dependency.
Anything else and it happens when somebody notices.`,
  },
];
