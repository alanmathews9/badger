---
name: triage-pr-feedback
description: >
  Turn the review feedback on a pull request into a prioritised, actionable
  checklist with file and line references, separating what blocks a merge from
  what does not. Use for "what's left on PR", "what's blocking", "what do I
  need to fix", "summarise the review", "is this ready to merge", "what did
  reviewers ask for". Use whenever someone names a PR number and wants to know
  what to do next.
license: MIT
allowed-tools: github_pr github_issue github_file github_search drive_search drive_file memory
metadata:
  author: alan-mathews
  version: "1.0.0"
  category: retrieval
---

# Triage pull request feedback

## When to Use

Someone has a pull request and wants to know what is left to do on it. Also
when a lead asks why something has not merged.

## Why this needs a procedure

Review feedback on a busy PR is genuinely hard to read: it arrives in two
separate streams, out of order, mixing blocking objections with taste, and
often includes replies that already resolved the point. People miss things.

The two streams matter:

- **Inline review comments** are anchored to a file and a line. This is where
  actionable feedback lives — "this needs the null case".
- **Conversation comments** are the thread. This is where approval, scope
  arguments and "let's do that in a follow-up" live.

`github_pr` returns both. `github_issue` only returns the second, which is why
it is the wrong tool here.

## Procedure

### 1. Read the whole PR

`github_pr` with the number. One call gets state, description, changed files,
inline review comments and conversation.

### 2. Drop what is already handled

A comment followed by a reply agreeing to it, or by a later comment saying it
was done, is not outstanding. A comment on a file that no longer appears in the
changed-files list is stale. Say how many you dropped rather than silently
discarding them.

### 3. Classify what remains

| Level | Test it must clear |
|---|---|
| **Blocking** | A reviewer asked for a change and did not withdraw it, or raised correctness, security or a broken contract. If it merged as-is, something would be wrong. |
| **Should fix** | A real improvement the reviewer expects, but they did not condition approval on it. |
| **Optional** | Taste, naming, "consider", follow-up suggestions. |
| **Answered** | A question needing a reply, not a code change. |

If you cannot say what would go wrong when a point is ignored, it is not
blocking. Do not inflate — a checklist where everything is blocking is one
nobody uses.

### 4. Check whether it can merge

State is decisive and `github_pr` reports it. A merged PR has no outstanding
work; say so and summarise what the review concluded instead.

## Output

````markdown
**PR #{n} {title}** — {state}. {One sentence: ready to merge, or what stands in
the way.}

**Blocking ({count})**
- `{file}:{line}` — {what to change}. *(@{reviewer})*

**Should fix ({count})**
- `{file}:{line}` — {what to change}. *(@{reviewer})*

**Optional ({count})**
- `{file}:{line}` — {what}. *(@{reviewer})*

**Needs a reply ({count})**
- {question} *(@{reviewer})*

{If any were dropped: "{n} comments already addressed in replies."}

**Sources**
- [PR #{n} {title}]({url}) — {state}, {n} review comments, {n} conversation
  comments.
````

If there is no outstanding feedback, say that in one line and stop. Do not
manufacture a checklist.

## Pitfalls

- **Using `github_issue` on a PR.** It works, and it silently omits every
  inline review comment — the actionable ones. Use `github_pr`.
- **Treating every comment as a task.** Replies, approvals and "nice" are not
  work items.
- **Missing the resolution.** Read replies before listing a point as
  outstanding.
- **Inflating severity.** Blocking means something breaks or a reviewer
  explicitly withheld approval.
- **An open PR with no review comments** is not "ready to merge" — it is
  unreviewed. Say which it is.
