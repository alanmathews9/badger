# Eval results

A dated record of what `npm run eval` actually returned, so the number in the
README is a measurement someone can check rather than a claim.

One run is a **sample, not a score.** The model is non-deterministic and which
question fails moves between runs, so a single figure here should be read
alongside the range in the README rather than instead of it.

---

## 2026-08-20 — 14/15, $0.0956

Run against `8b34e62`, on `google-vertex:gemini-2.5-flash`. This is the first
run after `SOUL.md` and `RULES.md` changed (commit `8d47997`), so it measures
the new prompt.

| # | Question | Result |
|---|---|---|
| 1 | `why-late` — Why was the Android 4.2 app five weeks late? | pass |
| 2 | `march-promise` — Did we tell Brightsmile the app would be ready in March? | pass |
| 3 | `refund-policy` — What is our refund policy for an outage? | pass |
| 4 | `clearview-why` — Why is Clearview leaving? | pass |
| 5 | `leave-carryover` — How many days of leave can I carry over? | pass |
| 6 | `3am-reminders` — Why were Meadow Veterinary's reminders arriving at 3am? | pass |
| 7 | **`who-payments` — Who knows about payments?** | **fail** |
| 8 | `double-charge` — Why were some patients charged twice in March? | pass |
| 9 | `support-spike` — Did support tickets spike after 4.2, and why? | pass |
| 10 | `sync-third-rewrite` — Have we decided to rewrite the sync layer a third time? | pass |
| 11 | `free-tier` — Are we launching a free tier? | pass |
| 12 | `nhs-accessibility` — Who owns the accessibility audit for the NHS pilot? | pass |
| 13 | `export-patients` — How do I export our patient list? | pass |
| 14 | `postgres-version` — Are we using Postgres 15 or 16 for the reporting replica? | pass |
| 15 | `offboarding-typo` — What is our ofboarding process? (the typo is deliberate) | pass |

### The failure, and why it is the interesting one

**`who-payments` failed with the right answer.**

The agent said Ana Ferreira, Lead of Payments, evidenced by the commits under
`api/src/payments/` — which is correct, and is what the question grades on
(`mustSay: [/Ana Ferreira|Ana\b/]`). It failed on a **citation**, not on the
answer:

```
1 unverified citation: misattributed-mail
  "Re: A patient was charged twice"
  the thread was retrieved but "Marta Nowak to Ana Ferreira" never appears in it
```

The thread is real and was really retrieved. The attribution on it was
invented. So the verifier did exactly the job it exists for: it caught a true
statement supported by a citation that does not say what the answer claims it
says. That is the failure mode this product can least afford, because a
plausible citation is what makes a wrong answer credible.

Graded as a failure deliberately. An answer whose evidence is misattributed is
not a pass with a footnote — the whole proposition of the product is that the
citation can be trusted.

### What this run does not tell you

- **It is one sample.** 14/15 is the top of the range, not a new baseline. Two
  earlier failures that this run passed (`refund-policy` giving the policy
  without Marta's exception, and `clearview-why` naming the outage without the
  customer ruling out price) are answer-completeness seams that recur.
- **It says nothing about the skill-as-tool defect**, which cost two questions
  per run before `SYSTEM_SUFFIX` and the `RULES.md` rule were written to kill
  it. Neither `sync-third-rewrite` nor `nhs-accessibility` — the two it used to
  cost — failed here.
- **Grading is deterministic, not model-judged.** `mustCite` checks a claim
  against what a tool actually returned; `mustSay` and `mustNotSay` are
  regexes. See the header comment in `questions.mjs` for why judging with a
  model was rejected.
