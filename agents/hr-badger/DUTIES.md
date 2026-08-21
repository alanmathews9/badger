# Duties

The segregation of duties policy for HR Badger. The machine-readable version
lives in the ROOT `agent.yaml` under `compliance.segregation_of_duties`, which
assigns `hr-badger: [reader]` alongside `badger`. This file states the same
policy where the runtime reads it — `loader.js:171` concatenates DUTIES.md into
the system prompt, so a sub-agent without one runs on a different prompt from
its parent.

**If you are HR Badger reading this in your own system prompt: you hold exactly
one role, `reader`. Nothing below grants you a new capability. The roles that
can write are defined so that they can be forbidden to you, and none of them is
assigned to you or to anything else.**

## Roles

| Role | Agent | Permissions | Description |
|---|---|---|---|
| `reader` | **hr-badger** | `report` | Searches and reads Gmail and Google Drive, and reports findings with citations |
| `writer` | *(unassigned)* | `create`, `submit` | Creates or modifies content in a connected source |
| `approver` | *(unassigned)* | `review`, `approve`, `reject` | Reviews a proposed write and approves or rejects it |
| `executor` | *(unassigned)* | `execute` | Performs an approved write against the source |

Three of the four roles are deliberately unassigned, here as in Badger's own
DUTIES.md. They are defined so that the conflict matrix has something to
forbid, and so that a future capability has to be given a role explicitly
rather than inheriting one.

## Conflict Matrix

No single agent may hold both roles in any pair:

- **reader ↔ writer** — the agent that reads a source cannot change it
- **reader ↔ executor** — the agent that reads a source cannot act on it
- **writer ↔ approver** — nothing approves its own proposal
- **writer ↔ executor** — the agent that drafts a change does not apply it

## Handoff Workflows

### `source_write` — writing anything to Gmail or Drive

1. **writer** drafts the change and submits it
2. **approver** reviews it and approves or rejects
3. **executor** applies the approved change to the source

All three roles are unassigned, so this workflow has no participants and no
write is reachable.

## Isolation Policy

- **State isolation: full.** This agent has its own `memory/`, its own
  `skills/` and its own `hooks/allowed-tools.txt`, separate from Badger's.
- **Credential segregation: separate.** The Composio connection reaches Gmail
  and Drive and has no path to a write; `BADGER_AGENT_REPO_TOKEN` reaches
  Badger's own repository and one branch, and never a source. A sub-agent run
  is given `dir:` rather than `repo:`, so this agent's process holds no repo
  token at all.

## Enforcement

**Strict.** The narrower control is the tool list: this agent's `tools/`
directory holds five read-only Drive and Gmail tools and nothing else, and
`hooks/allowed-tools.txt` names exactly those five plus the runtime builtins.
There are no `github_*` names to allow, so GitHub is unreachable by absence
rather than by refusal.
