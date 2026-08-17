---
name: onboard-to-project
description: >
  Produce a structured brief that gets someone up to speed on a project,
  client, system or component fast — what it is, who owns it, the documents
  that matter, what is currently open, and what changed recently. Use for
  "get me up to speed on", "what is", "tell me about", "I'm taking over",
  "brief me on", "I have a call about", "where do I start with". Use it
  proactively when someone is clearly new to a thing rather than asking one
  narrow question about it.
license: MIT
allowed-tools: github_search github_issue github_pr github_file github_commits gmail_search gmail_thread drive_search drive_file drive_comments memory
metadata:
  author: alan-mathews
  version: "1.0.0"
  category: retrieval
---

# Brief someone on a project

## When to Use

The user needs orientation rather than a specific fact. They are joining a
project, taking one over, covering for someone, or walking into a meeting about
something they do not know.

If they asked one narrow question, answer that instead — do not force a brief.

## Why this needs a procedure

Orientation fails in a specific way: you read the README and believe you
understand. The README says what the thing is *for*. It does not say that the
customs module was out of scope and nobody knows if it reads from Oracle.

A useful brief therefore has to cover both the settled and the unsettled, and
it must end with what is currently in dispute — because that is what the person
will walk into.

Each source contributes a different half of an orientation:

| Source | What it gives a newcomer |
|---|---|
| **Drive** | The onboarding pack, the team page, the access register, the client-facing history. Where to start, who to ask, what was officially concluded. |
| **GitHub** | What the team argued about, and what remains open. |
| **Gmail** | The live relationship — what the client is currently expecting, and what was promised. |

The Drive onboarding documents are genuinely useful and should be found rather
than paraphrased: there is a first-week checklist, an engineering setup page,
a document specifically about joining an engagement mid-flight, and an access
register naming who approves what. Point the person at them by name.

Access is the part that bites. It has real, measured lead times — nine days for
one client system, eleven for another — so a brief that omits "request access
today" has failed at the one thing it could have changed.

## Procedure

Work these in order. Stop early only if the subject turns out not to exist.

### 1. Establish the subject exists, and find its home

`github_search` the name. In parallel, `github_file` with `path: ""` to list the
root and find the directory that holds it — client engagements, handbook pages
and playbooks all live in predictable places.

If nothing matches, say so and stop. Do not brief on a guess.

### 2. Read the official description

`github_file` on the main document — a README, a client folder's overview, a
playbook. This is the settled version and it belongs first in the brief.

### 3. Find who is involved

`github_commits` on the directory for who has been touching it. Then note who
argues about it in threads. Give names with a basis, never a bare list.

### 4. Find what is open

`github_search` restricted to open items — `state:open` — for the subject. These
are the live questions. This section is what makes the brief worth reading.

Open the two or three most substantial with `github_issue` or `github_pr` so you
can say what the disagreement actually is, not just its title.

### 5. Find what changed recently

`github_commits` on the directory, most recent first. Recent movement tells the
reader whether this is active or dormant.

### 6. Name the traps

Anything in the threads a newcomer would get wrong: a commitment made to one
client that does not generalise, a rule that changed, a number that is out of
date. This is the highest-value part of the brief and it comes from comments,
never from files.

## Output

A brief may run longer than a normal answer. Keep each section tight.

````markdown
**{Subject}** — {one sentence on what it is.}

**Where it lives**
{paths, with links}

**Who to ask**
- **{Name}** — {basis: commits, argued X, owns Y}
- **{Name}** — {basis}

**What's settled**
{Two to four bullets of the official position, each cited.}

**What's open**
- [#{n} {title}]({url}) — {what the actual disagreement is, in a clause.}

**Recent movement**
{Two or three commits or merged PRs with dates, or "nothing since {date}".}

**Watch out for**
{One to three traps a newcomer would fall into. Cite each.}

**Coverage**
- GitHub ({repo}): {n} results across {m} searches, {k} threads read.
````

Drop any section that has nothing in it, and say so rather than padding:
"No open issues reference this."

## Pitfalls

- **Briefing from the README alone.** It is the marketing version. The brief is
  only useful if it includes what is unresolved.
- **Listing open issues by title.** A title is not a disagreement. Open the
  substantial ones and say what is actually at stake.
- **A bare list of names.** Every name needs a basis and a recency.
- **Six searches is the budget** and a brief burns through it fastest. Prefer
  one broad search plus targeted file reads over many narrow searches.
- **The subject does not exist.** Say that. Do not assemble a brief from
  loosely related material.
