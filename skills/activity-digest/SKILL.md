---
name: activity-digest
description: >
  Summarise what actually happened over a period — what merged, what closed,
  what is newly open, and what moved on a project or for a person. Use for
  "what shipped", "what happened last week", "what changed recently", "catch me
  up", "what's the status of", "what has {person} been working on", "standup",
  "what did we do this month". Use whenever the question is bounded by time
  rather than by topic.
license: MIT
allowed-tools: github_search github_commits github_pr github_issue github_file gmail_search gmail_thread drive_search drive_file memory
metadata:
  author: alan-mathews
  version: "1.0.0"
  category: retrieval
---

# Digest a period of activity

## When to Use

The question is bounded by **time** rather than by topic: what shipped last
week, what has moved on Halden this month, what someone worked on, catching up
after leave. Also the basis for a scheduled digest.

## Why this needs a procedure

Raw activity is not news. Twenty commits and six merged pull requests tell the
reader nothing if listed. The job is to say what *changed about the world* —
which decisions landed, which are newly open, what is stuck — and a commit list
does not show that.

Three things carry different meaning:

- **Merged PRs** — what actually shipped. The strongest signal.
- **Closed issues** — what got settled, including things settled by a decision
  rather than by code.
- **Newly opened issues** — what is now in question. Often the most important
  part of a digest and the part usually omitted.

Something stalling is also news. A PR open for three weeks belongs in the
digest.

Mail carries a fourth kind, and it is usually the one the reader most needs:

- **Client mail in the period** — what was promised, escalated or agreed
  outside the repository. A week where nothing shipped but a client was told
  the date is moving is a busy week, and a GitHub-only digest reports it as
  quiet.

Use `gmail_search` with `since_days` for this. Never write the date yourself —
the window is computed for you, and a date recalled rather than computed
silently produces a digest of the wrong period.

Drive is mostly out of scope for a digest: documents do not announce
themselves, and a modified date rarely means anything happened. The exception
is a document created in the period, which usually marks an engagement closing
or a policy changing.

## Procedure

### 1. Set the window with `since_days` — never write a date yourself

**You do not know today's date.** Asked "what shipped last week" while writing
the qualifier by hand, this agent searched from a date two years off; the search
succeeded and returned the wrong period, which is worse than failing.

So always pass `since_days` to `github_search` and let it compute the date:

| The user said | `since_days` |
|---|---|
| yesterday / standup | 1 |
| last week / this week | 7 |
| this month / last month | 30 |
| this quarter | 90 |

`github_search` echoes the real window and today's date in its output. Quote
that window in the answer; do not restate it from memory.

### 2. What shipped

    query: "is:pr is:merged", since_days: 7, date_field: "merged"

Then `github_commits` with `since` for anything that landed outside a PR.

### 3. What got settled

    query: "is:issue is:closed", since_days: 7, date_field: "closed"

Closed issues are decisions. Open the substantial ones to say what was decided,
not just that something closed.

### 4. What is newly open

    query: "is:issue is:open", since_days: 7, date_field: "created"

This is the section people skip and the one that matters most — it is the
current state of the argument.

### 5. What is stuck

Anything open and not updated within the window: search `is:open` with
`date_field: "updated"` and compare against what came back. Report it as
stalled, with how long. Drop this section first if searches are running short.

### 6. Narrow if asked

For a person, add `author:{login}` or `involves:{login}`. For a project, add its
name or restrict to its paths with `github_commits path:`. Say which filter you
used — attribution by GitHub account can differ from who did the work.

## Output

Group by meaning, never by tool.

````markdown
**{Window}** — {one sentence on the shape of it: quiet, busy, dominated by X.}

**Shipped**
- [#{n} {title}]({url}) — {what it changes in one clause.} {date}

**Settled**
- [#{n} {title}]({url}) — {what was decided.} {date}

**Newly open**
- [#{n} {title}]({url}) — {the question it raises.} {date}

**Stalled**
- [#{n} {title}]({url}) — open since {date}, no movement in {n} days.

**Coverage**
- GitHub ({repo}): {window}, {n} merged, {n} closed, {n} opened, across {m}
  searches.
````

Drop empty sections and say so — "Nothing merged in this window" is
information. Never pad a quiet week into a busy-looking digest.

## Hard limits on length

A digest is a summary, not an inventory. **This skill's failure mode is dumping
every result under a heading**, which is what a raw search already does.

- At most **5 items per section.** If more qualify, take the most consequential
  and end the section with "and {n} others".
- One clause per item saying what it changes for the reader. Not the title
  again, and not the first line of the body.
- Whole digest under 350 words. If it is longer, you are listing, not digesting.

## Pitfalls

- **Listing commits.** A digest of commit messages is not a digest. Group by
  what changed for the reader.
- **Writing a date qualifier by hand.** Use `since_days`. A wrong window returns
  confident, wrong results.
- **Leaving the window implicit.** Quote the window `github_search` reported.
- **Omitting newly-opened items** because they are not achievements. They are
  the most current information in the digest.
- **Six searches is the budget** and this skill wants five sections. Combine
  filters in one query where you can, and drop the stalled section first if you
  are running short.
- **One account authoring everything.** Where a corpus is committed by a single
  account, per-person filters will mislead. Attribute from comment text and say
  the account is not the author.
- **`ERROR: rate limited`** — this skill fires several searches in a row and is
  the most likely to hit it. Wait and resume; never report a partial digest as
  complete.
