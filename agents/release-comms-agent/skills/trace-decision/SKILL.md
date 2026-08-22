---
name: trace-decision
description: |
  Reconstruct what the organisation decided about something, why, who disagreed, and whether it is actually settled. Use whenever a question contains "why did we", "what did we decide", "have we decided", "did we decide", "how did we end up with", "who agreed to", "what's our position on", "are we still", "are we still doing" — or asks about the reasoning behind any policy, price, process or technical choice. Use it proactively when the user asks about a past choice even if they do not use the word decision.
license: MIT
allowed-tools: github_search github_issue github_pr github_file github_commits gmail_search gmail_thread drive_search drive_file drive_comments memory
metadata:
  author: alan-mathews
  version: 1.0.0
  category: retrieval
confidence: 1
usage_count: 6
success_count: 6
failure_count: 0
negative_examples: []
copied_from: badger
---

# Trace a decision

## When to Use

The question is about a choice the organisation made, or about the reasoning
behind something. "Why did a release slip?" "Did we decide to rebuild that
component again?" "What is our refund policy for an outage?"
"Have we decided to do this a second time?" "Why is a customer leaving us?"
"Are we still going ahead with the free tier?" "Who agreed to this deadline?"
"What is our position on discounting?" "Why do we do it this way?"

Not for locating a document (that is a plain lookup) and not for who-knows-what
(use **find-expert**).

## Why this needs a procedure

**Each source holds a different version of the same decision, and no source
knows about the others.**

| Source | What it holds |
|---|---|
| **Drive** | The written-down version. Policies, retros sent to clients, roadmaps. Tidy, official, and often the version that is least true. |
| **GitHub** | The argument. Issues and PR threads where the team worked out what they actually thought. |
| **Gmail** | What was said to whom, and when. What a client was actually told, and what was said internally about telling them. |

The shape to expect, on any question of this kind: a tidy document names one
cause, a GitHub thread does the arithmetic and finds a different one, a mail
thread shows the wording being chosen deliberately over an objection, and an
earlier mail shows the customer being told something no document records at
all. Four sources, four versions, and the disagreement between them is the
finding.

**This section deliberately contains no specific facts, and that is a rule
rather than an oversight.** A skill that names an issue number or states an
outcome hands the model an answer it can recite without searching for it —
which is exactly what happened here once, producing a fluent answer with no
tool calls behind it and citations the verifier correctly refused to confirm.
A skill teaches the procedure. The corpus holds the answers.

When sources disagree, **that gap is the answer.** Report all of them, named.
Never silently pick one, and never average them into a summary that flattens
the disagreement away.

## Procedure

### 1. Search at least two sources before concluding anything

Two or three distinctive words. Start with the source most likely to hold the
argument — usually `github_search` — but **do not stop there**. A decision that
touched a client was almost certainly also discussed in mail, and a decision
that became policy is in Drive.

Say in one line what you are looking for before you look.

If a GitHub search is thin, force keyword matching across comment text:

    in:title,body,comments

### 2. Open every plausible thread

Call `github_issue` (or `github_pr`) on each GitHub candidate, `gmail_thread`
on each mail candidate, `drive_file` on each document — usually two to four in
total. **The search snippet is never enough.** Read the comments and note who
said what.

### 2a. Check the margin of every document you rely on

`drive_comments` on any Drive document that answers a contested question. The
pattern is reliable: a customer-facing document is where a cause gets softened,
and the objection to that softening is left in the margin rather than in the
text. A document read without its comments will produce a confidently wrong
answer. Which documents those are is for the search to tell you, not for this
file to say.

### 3. Establish whether it is settled

This is the step that matters most, and the one most easily skipped.

| What you see | What it means |
|---|---|
| Issue **open**, last comment proposes something | **Not decided.** Report as a proposal, name the proposer. |
| Issue **open**, people still disagreeing | **Contested.** Give both positions with names. |
| Issue **closed**, or a PR **merged** implementing it | Decided. Say what settled it and when. |
| A file states it as policy | Official — but check the thread for a later contradiction. |
| A document says it, a mail thread contradicts it | **Contested.** The mail is usually closer to what happened. |

`github_issue` and `github_pr` tell you the state in words. Believe them.

### 4. Find the official version

If the decision touches a policy, rate, process or client commitment, read the
written-down version too — `drive_search` for a document, `github_file` for a
repository file. A decision that made it into the handbook is settled in a way
a thread alone is not.

Beware that there may be **two** official versions of the same policy — one in
Drive and one committed to the repository — and that they may give different
numbers, because one of them stopped being updated. If you find one, look for
the other before quoting a figure, and if they disagree, report both.

### 5. Check whether anything superseded it

`github_commits` with the file's path shows whether a repository policy changed
after the discussion, and a Drive document's modified date does the same job.
A newer artefact beats an older thread — but only if it is genuinely about the
same question.

### 6. Check what the other party was told

If the decision involved a client, search mail before you finish. A decision
recorded internally and a decision communicated externally are different
facts, and the difference between them is often the point of the question.

## Output

Lead with the status, not the content.

````markdown
{One sentence: what was decided, or that it is not decided. If unresolved,
say so first and give the date.}

{Two to five sentences: the reasoning, and the disagreement if there was one.
Attribute positions by name.}

{If two sources disagree, a sentence naming the gap explicitly and saying
which source says which.}

**Sources**
- [#{n} {title}]({url}) — {issue|PR}, {open|closed|merged}, {date}. {contribution}
- [{path}]({url}) — file. {what it states}
- {subject} — mail, {sender}, {date}. {contribution}
- {document name} — {doc|sheet}, {date}. {what it states}
- {document name}, comment by {speaker} — {what it adds or contradicts}

**Coverage**
- GitHub ({repo}): {n} results across {m} searches, {k} threads read.
- Gmail: {n} results across {m} searches, {k} threads read.
- Drive: {n} files across {m} searches, {k} read, {c} checked for comments.
````

Name every source that was searched, including ones that returned nothing.
"Nothing in Drive mentions this" is a finding; silence about Drive is a gap the
user cannot see.

## Pitfalls

- **A snippet that looks like the answer.** It is the opening of the body. The
  conclusion is below it. Open the thread.
- **One person proposing reads as consensus.** "Proposing: X" with no reply is
  not a decision, even if it is the last comment and sounds authoritative.
- **`ERROR: rate limited`** — not an empty result. Wait, narrow, retry.
- **Search returns 0** — real, but only for that phrasing. Try different words
  before concluding anything.
- **A thread that just stops.** That is a finding: report the positions and say
  it was never resolved.
- **Answering from one source because it looked complete.** A client-facing
  retro reads as finished and authoritative precisely because the awkward cause
  was taken out of it. Completeness of tone is not evidence of completeness.
- **A document read without its comments.** See step 2a. This is the single
  most likely way to produce a confident wrong answer on this corpus.
- **Treating a client mail as the internal position.** What one person writes
  to a customer and what the same person writes to a colleague on the same day
  are different, deliberately. Quote whichever the question asked for, and say
  which it was.
