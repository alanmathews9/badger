// The eval set: questions whose correct answer is known, and known from where.
//
// **Why this exists.** Every change to retrieval or prompting up to now has
// been judged by asking a question and reading the answer, which is exactly as
// reliable as it sounds. On 2026-08-18 one hand-asked question uncovered a
// defect that had been live through a "verified" corpus seeding: no agent
// search tool ranked its results. Nobody knew what the other fourteen questions
// did, because there were no other fourteen questions.
//
// ---------------------------------------------------------------------------
// **How these are graded, and why not with a model.**
//
// The obvious design is to ask a model whether the answer is right. It is also
// the one that cannot be trusted here: the grader would be the same Flash model
// being graded, on the same corpus, and a grader that hallucinates agreement is
// indistinguishable from a system that works. So grading is deterministic:
//
//   mustCite     identifiers that must ALL appear in what was actually
//                retrieved. Reserved for questions only one source can answer,
//                where retrieving something else means the answer is guesswork
//                however plausible it reads.
//   mustCiteAny  at least one of these. Most questions are answerable from more
//                than one source, and demanding a particular one tests the
//                route rather than the result. The first version of this file
//                used mustCite everywhere and failed a correct answer about 3am
//                reminders because it came from mail instead of issue #1 —
//                that is the eval being wrong, not the agent.
//   mustSay      regexes the answer text must match. Facts, not phrasing —
//                a number, a date, a name. Written as alternations so that
//                "five weeks" and "35 days" both pass, because both are right.
//   mustNotSay   the known wrong answer. This is the half that catches
//                regressions the other two cannot: an answer can cite issue #8
//                and still tell you App Store review caused the delay.
//
// A question fails loudly rather than partially. Partial credit on an eval set
// is a way of not noticing that something broke.
//
// ---------------------------------------------------------------------------
// **What this set deliberately does not cover.** Tone, structure, and whether
// the answer is pleasant to read. Those are real, and they are not measurable
// this way; judging them by regex would produce a number that goes up while the
// product gets worse.
//
// Every expectation below is derived from `scripts/seed/company.mjs` — the same
// file the corpus was generated from — so a corpus change that invalidates a
// question shows up here as a failure rather than as a quietly wrong test.
import { FACTS } from "../scripts/seed/company.mjs";

export const QUESTIONS = [
  // ===================================================== cross-source seams
  {
    id: "why-late",
    question: "Why was the Android 4.2 app five weeks late?",
    why: "The headline cross-source question. Drive blames App Store review; the repository does the arithmetic and finds it was four days of thirty-five.",
    mustCite: ["issues/8", "30"],
    mustSay: [/five weeks|35 days|thirty-five days/i, /sync/i, /twice|two attempts|second attempt|rewritten|rebuil/i],
    // The failure mode this question exists to catch: repeating the
    // customer-facing explanation as though it were the cause.
    mustNotSay: [/(caused|due to|because of|blamed on|delayed by)\s+(the\s+)?app\s*store\s+review/i],
  },
  {
    id: "march-promise",
    question: "Did we tell Brightsmile the app would be ready in March?",
    why: "Answerable from mail alone. Neither Drive nor GitHub records that this happened, so it fails the moment mail retrieval regresses.",
    mustCite: ["When can we tell our practices"],
    mustSay: [/yes|we did|told them/i, new RegExp(FACTS.brightsmilePromise.wording, "i"), /4 February|February 4|2026-02-04|4th of February/i],
  },
  {
    id: "refund-policy",
    question: "What is our refund policy for an outage?",
    why: "Drive states the policy; mail shows the company doing something else. An answer that gives only the policy is incomplete, not wrong.",
    mustCiteAny: ["Refund Policy", "Refund for the March outage"],
    // Matched loosely on purpose. FACTS records the goodwill as "one month's
    // credit" and a correct answer said "a month's credit" — the article is not
    // the fact under test, and a regex that fails on it is testing transcription
    // rather than retrieval.
    mustSay: [/not refundable|excluded|does not cover|no refund/i, /(a|one)\s+month'?s?\s+credit/i],
  },
  {
    id: "clearview-why",
    question: "Why is Clearview leaving?",
    why: "Three sources, three reasons, on purpose. The Drive churn review says price and the customer explicitly says it was not price.",
    mustCiteAny: ["Clearview"],
    mustSay: [/outage|17 March|March incident/i, /not (the )?price|rather than price|ruled out price/i],
    mustNotSay: [/^(?!.*(not|rather than|denied|disputed|contrary)).*\bleaving (because|over|due to) (the )?price/is],
  },
  {
    id: "leave-carryover",
    question: "How many days of leave can I carry over?",
    why: "Drive is current and the repository handbook is stale and still reachable. Returning only one of them is lying by omission.",
    mustCite: ["Leave Policy"],
    mustSay: [new RegExp(`${FACTS.leave.driveCarryOverDays}\\s*days`, "i"), /31 March|March 31|31st of March/i],
  },

  // ============================================================ single-source
  {
    id: "3am-reminders",
    question: "Why were Meadow Veterinary's reminders arriving at 3am?",
    why: "The most legible bug in the corpus. A reader with no context can judge this answer in one second.",
    mustCiteAny: ["issues/1", "reminders are going out at 3am"],
    mustSay: [/timezone|time zone|UTC/i, /Melbourne|Australia/i],
  },
  {
    id: "who-payments",
    question: "Who knows about payments?",
    why: "Expertise routing. The answer is evidenced by authored commits and a merged PR, not by anyone claiming it.",
    mustSay: [/Ana Ferreira|Ana\b/],
  },
  {
    id: "double-charge",
    question: "Why were some patients charged twice in March?",
    why: "Ties the customer's words to the engineering cause. Tests whether support mail and the repository are joined up.",
    mustCiteAny: ["issues/3", "charged twice"],
    mustSay: [/retr(y|ies|ied)|webhook/i, /idempoten|duplicate|already (seen|processed)/i],
  },
  {
    id: "support-spike",
    question: "Did support tickets spike after 4.2, and why?",
    why: "Needs the spreadsheet for the number and the mail or issue for the cause. An assertion without the figure is a weak answer.",
    mustSay: [new RegExp(String(FACTS.support.monthlyTickets["2026-04"])), /login|log in|sign in|4\.2|sync/i],
  },

  // =========================================== the ones that must stay honest
  {
    id: "sync-third-rewrite",
    question: "Have we decided to rewrite the sync layer a third time?",
    why: "Issue #9 is open and contested. Reporting a proposal as a decision is the single worst failure this product can have.",
    mustCiteAny: ["issues/9", "sync layer a third time"],
    // Broadened after a correct answer — "proposed ... but it has not been
    // agreed upon or funded" — was failed by a narrower pattern. The fact under
    // test is that no decision exists, not the words used to say so.
    mustSay: [/not decided|no decision|undecided|still open|unresolved|not (yet )?(been )?(agreed|decided|funded)|being debated|contested|proposed but|remains open/i],
    mustNotSay: [/^(?!.*(not|no|un|yet)).*\bwe (have )?decided to rewrite/is],
  },
  {
    id: "free-tier",
    question: "Are we launching a free tier?",
    why: "Deferred, not rejected, and the difference matters. Also checks whether the agent reads the last word in a thread rather than the loudest.",
    mustSay: [/not (yet )?decid|deferred|no decision|revisit|Q4|not this quarter/i],
    mustNotSay: [/^(?!.*(not|no|deferred|undecided)).*\b(yes|we are|we will) (be )?launch/is],
  },
  {
    id: "nhs-accessibility",
    question: "Who owns the accessibility audit for the NHS pilot?",
    why: "Issue #20 is a deadline nobody owns. The correct answer is that nobody owns it, which a model is strongly inclined not to say.",
    mustCiteAny: ["issues/20", "accessibility"],
    mustSay: [/nobody|no one|unowned|not assigned|no owner|unassigned/i],
  },

  // ================================================= retrieval discrimination
  {
    id: "export-patients",
    question: "How do I export our patient list?",
    why: "Deliberately mundane, with one boring correct answer. Ordinary traffic the interesting questions have to be discriminated from.",
    mustSay: [/CSV|export/i],
  },
  {
    id: "postgres-version",
    question: "Are we using Postgres 15 or 16 for the reporting replica?",
    why: "Ordinary technical noise. Tests that a specific, low-drama question is not answered with the loudest thread in the corpus.",
    mustCiteAny: ["issues/21", "Postgres"],
    mustNotSay: [/android|4\.2|sync layer/i],
  },
  {
    id: "offboarding-typo",
    question: "What is our ofboarding process?",
    why: "The typo is deliberate. Search has no spelling tolerance by design (federation holds no vocabulary to compare against); the agent path should still cope, and this records which is true.",
    mustCiteAny: ["Offboarding", "offboarding"],
    mustSay: [/Google account|GitHub|access/i],
  },
];
