---
name: answer-question
description: >
  Answer a question about the company's own work by searching connected sources
  live and citing every claim. Use this for any question whose answer lives in
  internal material rather than in general knowledge — what was decided and why,
  who owns something, what a client was told, where a document is, what changed
  and when. Use it proactively whenever a question refers to "we", "our", a
  client name, a project, a policy, or a past decision, even if the user does
  not mention searching.
license: MIT
allowed-tools: github_search github_issue github_file github_commits memory
metadata:
  author: alan-mathews
  version: "1.0.0"
  category: retrieval
---

# Answer a question from internal sources

## When to Use

Any question whose answer is in the company's own material. If the answer would
be the same for every company on earth, this skill does not apply — answer from
knowledge and say so.

## Step 0 — read your tool list, not your description

Before answering anything about what you can search, look at the tools you
actually hold. A source is available if and only if you can see its tools:
`github_*` for GitHub. Sources whose servers failed to start are dropped
silently before you are invoked, so this file, `SOUL.md`, and the README can all
promise sources you cannot call.

If you hold no source tools, say that no sources are connected and stop. Never
infer availability from documentation. Claiming a source you cannot reach turns
"I could not check" into "there is nothing there", and the user cannot tell the
difference.

## The one thing to understand about this corpus

**Files hold the official answer. Threads hold the real one.**

A handbook page says what the policy is. The issue where the team argued about
it says what they actually concluded, what they tried first, and what they are
still unsure about. A retro document says the engagement slipped because scope
changed; the retro *thread* says four of the six weeks were self-inflicted.

So: a file alone is rarely a complete answer to a "why" or "what did we decide"
question. When a file and a thread disagree, that disagreement **is** the
answer — report both, say which is more recent, and do not silently pick one.

## A proposal is not a decision

This is the easiest mistake to make here and the most damaging, because the
answer reads as authoritative either way.

Before writing "we decided", check:

- **Is the issue open or closed?** An **open** issue is, by default, an
  unresolved question. Closed suggests it was settled — but say what settled it.
- **Who spoke last, and in what mood?** "Proposing: X" is a proposal.
  "Agreed, doing X" is a decision. One person proposing while two others
  discussed adjacent points is *not* consensus.
- **Did anyone confirm?** If the last word is a suggestion nobody answered, the
  honest report is "the current proposal is X, not yet confirmed".

Write it the way it actually stands:

- decided → "The team decided X."
- proposed, unanswered → "X has been proposed by {who} and not yet confirmed;
  the issue is still open."
- still contested → "{A} argues X, {B} argues Y. Unresolved as of {date}."

Losing a decision the team did make is a small error. Reporting a decision they
did not make is a large one — someone acts on it.

## Choosing a tool (hard requirement)

| The question is… | Call | Not |
|---|---|---|
| anything, as the first move | `github_search` | — |
| "what did we decide / why / who disagreed" | `github_search`, then `github_issue` on each hit | stopping at the search snippet |
| about a named document or policy | `github_file` — list the directory first if the path is unknown | searching for file contents; it does not work here |
| "who owns / who knows about X" | `github_commits` with a `path`, plus `github_search` for discussion | guessing from names |
| "when did this change" | `github_commits` | issue dates |
| a follow-up about an issue already surfaced | `github_issue` with its number | searching again |

**Never answer a "why" or "what did we decide" question from search snippets
alone.** The snippet is the first 240 characters of the issue body. The
conclusion is almost always further down, or in the comments. Open the thread.

## Workflow

### 1. Plan the search, and say so in one line

State what you are about to look for before you look — one sentence, e.g.
"Checking issues and PRs for the Halden phase 2 pricing decision." Then search.

Budget: **no more than 6 searches per question.** The GitHub search API allows
30 requests per minute and returns an error, not an empty list, when exceeded.
If six searches have not found it, say what you tried and stop.

### 2. Search broad, then narrow

Start with two or three distinctive words. Not a sentence — long queries get
worse, not better.

If a plain query returns little, add a qualifier to force keyword matching
across comment text:

    in:title,body,comments

Other qualifiers that work: `state:closed`, `author:<login>`, `label:<name>`,
`is:pr`, `is:issue`.

**Never retry a failed query verbatim. Change the wording.**

### 3. Open the threads that matter

Call `github_issue` on every result that plausibly bears on the question —
typically two to four. Read the comments, not just the body. Note who said what:
attribution matters when people disagree.

### 4. Check the official version too

If the question touches a policy, a rate, a process or a client commitment,
also read the relevant file. Use `github_file` with `path: ""` to list the root
and navigate down. Comparing the file against the thread is usually where the
real answer appears.

### 5. Answer

Lead with the finding. Then the evidence. Then what you could not establish.

## Output format

Use this shape exactly.

````markdown
{One or two sentences that answer the question directly. No preamble, no
restating the question. If the honest answer is "the team has not decided",
say that in the first sentence.}

{Optional: two to five sentences of the reasoning, the disagreement, or the
sequence of events — only what bears on the answer.}

**Sources**
- [#{number} {title}]({url}) — {issue or PR}, {state}, updated {date}. {What
  this one contributes, in a clause.}
- [{path}]({url}) — file. {What it says.}

**Coverage**
- GitHub ({repo}): {n} results across {m} searches, {k} threads read.
- {Any source that failed, was skipped, or was rate limited — say so here.}
{Omit this block only when a single lookup answered a factual question.}
````

### Citation rules

- **Every claim traces to something you retrieved.** If you cannot point at an
  issue number, a file path, or a commit, the claim does not go in the answer.
  This is a drop rule, not an aspiration.
- **Never invent** a number, title, author, date or URL. Use only values that
  appeared in a tool result.
- **Attribute contested points to the person who made them** — "Priya argued
  for three-week discovery" beats "it was suggested".
- **Say when you did not find it.** "Nothing in the repository mentions this" is
  a good answer. Inventing a plausible one is the worst thing you can do.

## Common pitfalls

Keyed by what you will actually see.

- **`ERROR: rate limited` (403)** — this is **not** an empty result. The search
  API caps at 30 requests/minute. Wait, then retry with a narrower query. Never
  report it as "nothing found".
- **Search returns 0 results** — a real "nothing found" for that phrasing, not
  an error. Try fewer and more distinctive words, or add
  `in:title,body,comments`. Do not conclude the information is absent until you
  have tried at least two different phrasings.
- **A search snippet seems to answer the question** — it usually does not. It
  is the opening of the body. Open the thread.
- **Code search finds nothing, ever** — file *contents* are not searchable on a
  private repository; the API returns zero hits regardless of the query. This
  is a platform limit, not a miss. Reach files by path with `github_file`.
- **`github_file` says a path does not exist** — list its parent directory
  instead of guessing again.
- **A thread ends without a conclusion** — that is a finding. Report the
  positions and say it is unresolved. Do not manufacture a decision.

## Before you answer

- Every claim has a source, and every source came from a tool result.
- Numbers, dates, names and URLs are copied, never recalled.
- Threads were opened, not just searched, for any "why" or "decided" question.
- Disagreement between a file and a thread is reported, not resolved silently.
- The coverage line is honest about what failed or was not searched.

Then answer, and stop. Do not offer to search further unless something was
genuinely left unchecked — and if so, name it.
