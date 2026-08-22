# Duties

The segregation of duties policy for Badger. `agent.yaml` holds the machine
-readable version under `compliance.segregation_of_duties`, and
`opengap validate --compliance` checks this file's claims against it.

**If you are Badger reading this in your own system prompt: you hold exactly
one role, `reader`. Nothing below grants you a new capability. The roles that
can write are defined here so that they can be forbidden to you, and none of
them is assigned to you or to anything else.**

Badger's central promise is that it reads and never writes. Everywhere else in
this repository that promise is enforced in code — an eight-action Composio
enable list, the `DIRECT_TOOLS` preset, ten scripts that can call nothing else,
and `hooks/allowed-tools.txt` gating by exact name. This file is the same
promise stated as a duty policy, which is the standard's vocabulary for it, and
it exists so that the guarantee survives someone adding a capability later
without reading the code.

## Roles

| Role | Agent | Permissions | Description |
|---|---|---|---|
| `reader` | **badger** | `report` | Searches and reads GitHub, Gmail and Google Drive, and reports findings with citations |
| `writer` | *(unassigned)* | `create`, `submit` | Creates or modifies content in a connected source |
| `approver` | *(unassigned)* | `review`, `approve`, `reject` | Reviews a proposed write and approves or rejects it |
| `executor` | *(unassigned)* | `execute` | Performs an approved write against the source |

Three of the four roles are deliberately unassigned. That is the point: they
are defined so that the conflict matrix below has something to forbid, and so
that a future capability has to be given a role explicitly rather than
inheriting one.

## Conflict Matrix

No single agent may hold both roles in any pair:

- **reader ↔ writer** — the agent that reads a source cannot change it
- **reader ↔ executor** — the agent that reads a source cannot act on it
- **writer ↔ approver** — nothing approves its own proposal
- **writer ↔ executor** — the agent that drafts a change does not apply it

The first pair is the one that matters today, and it is what makes
"read-only" a property of the role assignment rather than a claim in prose.
Badger holds `reader`, so `writer` and `executor` are unreachable for it under
strict enforcement — assigning either one to `badger` fails validation and,
in CI, fails the build.

## Handoff Workflows

### `source_write` — writing anything to GitHub, Gmail or Drive

1. **writer** drafts the change and submits it
2. **approver** reviews it and approves or rejects
3. **executor** applies the approved change to the source

Approval is required at each step. All three roles are unassigned, so this
workflow has no participants and no write is reachable. That is the intended
state for the read-only phase; it is written down as a workflow rather than as
an absence so that phase 2 of the capability roadmap (propose, don't execute)
has a defined shape to grow into — a `writer` that drafts and stops, with no
`executor` behind it.

## Isolation Policy

- **State isolation: full.** Each role operates with its own memory and state.
  Trivially satisfied while one agent holds one role.
- **Credential segregation: separate.** Each role carries its own credential
  scope, and as of the learning loop there are two credentials rather than one.
  They are separate in the way that matters:

  | Credential | Reaches | Can write |
  |---|---|---|
  | The Composio connection | GitHub, Gmail, Drive — the **sources** | No path to it; see the four layers |
  | `BADGER_AGENT_REPO_TOKEN` | Badger's **own** repository, one branch | Yes, and only there |

  The second one exists because GAP's learning loop is git: a skill the agent
  crystallises has to become a commit or it dies with the container. It is
  scoped to a single repository — Badger's — and the runtime would happily have
  read it from `GITHUB_TOKEN`, which `app/server/agent-repo.mjs` deliberately
  refuses to do so that a write token for the agent's own repo can never be
  confused with one that reaches a source.

  This is not a hole in the `source_write` handoff below. That handoff governs
  writing to a **source**. Writing to the agent's own definition is a different
  action with a different reviewer: the agent commits to a branch, never to
  `main`, and a human merges it.

The honest caveat, stated here because it is stated in the README too: the
Composio connected account underneath Badger is an OAuth2 grant holding
account-wide `repo` scope, because GitHub offers no read-only OAuth scope for
private repositories. The credential is write-capable; the *role* is not, and
every layer between them is software. Narrowing that is a credential change
(a GitHub App with `contents:read`), not a policy change, and it is named in
the README as the known gap.

## Enforcement

**Strict.** A segregation-of-duties violation is an error, not a warning.
`opengap validate --compliance` fails, and `.github/workflows/agent.yml` fails
the build on it.
