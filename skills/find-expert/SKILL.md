---
name: find-expert
description: >
  Identify who knows about, owns, or has actually worked on something — a
  system, a client, a file, a topic. Use for "who owns", "who knows about",
  "who should I ask", "who has done this before", "do we have anyone with
  experience in", "who's been working on". Also use when someone is preparing
  for a call or a staffing decision and needs to know where real depth is.
license: MIT
allowed-tools: github_search github_issue github_pr github_commits github_file gmail_search gmail_thread drive_search drive_file drive_comments memory
metadata:
  author: alan-mathews
  version: "1.0.0"
  category: retrieval
---

# Find who knows

## When to Use

Someone needs a person, not a document. "Who knows payments integrations?"
"Who owns the reconciliation module?" "Who should review this?" "Do we have
real depth in Oracle migrations?"

## Why this needs a procedure

Expertise has to be inferred from evidence, and the kinds of evidence mean
different things:

- **Commits** — who has actually changed the thing. Strongest signal of
  hands-on ownership, weakest signal of judgement.
- **Substantive thread participation** — who argues about it with detail and
  gets deferred to. Strongest signal of who to ask, and the only signal that
  works for non-code topics like a client relationship or a pricing approach.
- **Mail** — who the client actually writes to, and who answers. This is the
  only reliable signal for a relationship, as distinct from a codebase.
- **Drive** — team pages and the employee directory name roles and owners
  directly, and the access register names who approves what.

There *is* now a directory, and it is still not the answer on its own. A
directory says what someone's role is; it does not say who has done the work.
Use it to confirm a name and to get the role right, never to originate one —
except for questions that are genuinely about roles, like who approves an
access request, where the register is authoritative.

A name appearing once in a thread is not expertise. Look for people who
answered questions, were asked directly, or whose position the others accepted.

**Never guess from names, titles or vibes.** Every name in the answer must come
from a commit author, a comment author, or text that explicitly says so.

## Procedure

### 1. Decide which kind of question it is

| Question | Lead with |
|---|---|
| "Who owns `<file or directory>`" | `github_commits` with `path` |
| "Who knows about `<topic>`" | `github_search`, then read threads |
| "Who do I ask for `<access>`" | `drive_search` for the access register — it names approvers |
| "Who is our contact at `<client>`" | `gmail_search` with the client's domain |
| "What is `<person>`'s role" | `drive_search` for the team page or directory |
| "Who worked on `<client or project>`" | `github_search` on the name, then threads |
| "Who should review this change" | `github_commits` on the touched paths |

Most real questions want both signals. Do the other one too.

### 2. Commits, if there is a path

`github_commits` with `path` set. Count authors and note recency — somebody who
touched it two years ago is a weaker answer than somebody who touched it last
month. If the path is unknown, list directories with `github_file`.

### 3. Threads, always

`github_search` the topic, then `github_issue` on the substantive hits. Read for:

- who was asked directly ("Tomas, does the customs module read from Oracle?")
- who answered with specifics rather than opinion
- whose position the others accepted
- who said they *lack* knowledge — that is useful negative evidence and worth
  reporting when the question is about bench depth

### 4. Report depth honestly

If the evidence is thin, say so. "Sam has commented on payments twice but
nobody has shipped a payments integration here" is a far more useful answer
than a confident wrong name — especially when the question is being asked to
decide whether to pitch for work.

## Output

````markdown
{One sentence naming the best person or people, with the basis.}

**{Name}** — {what the evidence shows: commits to X, argued the Y decision,
was deferred to on Z}. {Recency.}
**{Name}** — {as above}

{If depth is thin or contested, a sentence saying so plainly.}

**Sources**
- [#{n} {title}]({url}) — {issue|PR}, {date}. {who said what}
- [{path}]({url}) — {n} commits by {names}, most recent {date}.

**Coverage**
- GitHub ({repo}): {n} results across {m} searches, {k} threads read{, commits
  on <path>}.
````

## Pitfalls

- **Commit counts flatter whoever does the merges.** In a small repo one person
  may author most commits administratively. Check whether they also argue
  substantively; if not, say the commit signal is weak here.
- **A name in a thread is not expertise.** Distinguish someone who asked from
  someone who answered.
- **The honest answer is sometimes "nobody".** Report that, with what you
  checked. It is exactly the answer a person deciding whether to pitch needs.
- **`github_commits` returns nothing for a path** — the path is probably wrong.
  List the parent directory rather than guessing again.
- **Do not infer from the GitHub account.** Where a corpus is authored by one
  account, the real attribution is in the comment text. Use the names people
  actually sign with, and say the account is not the author when they differ.
