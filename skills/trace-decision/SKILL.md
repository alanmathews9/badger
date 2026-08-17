---
name: trace-decision
description: >
  Reconstruct what the organisation decided about something, why, who disagreed,
  and whether it is actually settled. Use whenever a question contains "why",
  "what did we decide", "how did we end up with", "who agreed to", "what's our
  position on", "are we still doing" — or asks about the reasoning behind any
  policy, price, process or technical choice. Use it proactively when the user
  asks about a past choice even if they do not use the word decision.
license: MIT
allowed-tools: github_search github_issue github_pr github_file github_commits memory
metadata:
  author: alan-mathews
  version: "1.0.0"
  category: retrieval
---

# Trace a decision

## When to Use

The question is about a choice the organisation made, or about the reasoning
behind something. "Why do migrations get three weeks of discovery?" "What did
we decide about Halden phase 2 pricing?" "Are we still refusing EU-region
commitments for new clients?"

Not for locating a document (that is a plain lookup) and not for who-knows-what
(use **find-expert**).

## Why this needs a procedure

**Files hold the official answer. Threads hold the real one.**

A handbook page states the policy. The issue where the team argued states what
they actually concluded, what they tried first, and what nobody has settled.
`clients/halden/retro.md` says the engagement slipped because scope changed;
the retro *thread* has the team concluding four of the six weeks were
self-inflicted.

When a file and a thread disagree, **that gap is the answer.** Report both.
Never silently pick one.

## Procedure

### 1. Search for the argument, not the artefact

Two or three distinctive words. Decisions live in issues and PRs, so search
those first. Say in one line what you are looking for before you look.

If the first search is thin, force keyword matching across comment text:

    in:title,body,comments

### 2. Open every plausible thread

Call `github_issue` (or `github_pr` for a pull request) on each candidate —
usually two to four. **The search snippet is never enough.** Read the comments
and note who said what.

### 3. Establish whether it is settled

This is the step that matters most, and the one most easily skipped.

| What you see | What it means |
|---|---|
| Issue **open**, last comment proposes something | **Not decided.** Report as a proposal, name the proposer. |
| Issue **open**, people still disagreeing | **Contested.** Give both positions with names. |
| Issue **closed**, or a PR **merged** implementing it | Decided. Say what settled it and when. |
| A file states it as policy | Official — but check the thread for a later contradiction. |

`github_issue` and `github_pr` tell you the state in words. Believe them.

### 4. Find the official version

If the decision touches a policy, rate, process or client commitment, read the
file too — `github_file`, listing directories to find the path. A decision that
made it into the handbook is settled in a way a thread alone is not.

### 5. Check whether anything superseded it

`github_commits` with the file's path shows whether the policy changed after
the discussion. A newer commit beats an older thread.

## Output

Lead with the status, not the content.

````markdown
{One sentence: what was decided, or that it is not decided. If unresolved,
say so first and give the date.}

{Two to five sentences: the reasoning, and the disagreement if there was one.
Attribute positions by name.}

{If a file and a thread disagree, a sentence naming the gap explicitly.}

**Sources**
- [#{n} {title}]({url}) — {issue|PR}, {open|closed|merged}, {date}. {contribution}
- [{path}]({url}) — file. {what it states}

**Coverage**
- GitHub ({repo}): {n} results across {m} searches, {k} threads read.
````

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
