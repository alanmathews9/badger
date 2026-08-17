# Skills

Each skill is a directory holding `SKILL.md` with YAML frontmatter (`name`,
`description`, `license`, `allowed-tools`, `metadata`). Skills named in
`agent.yaml` load at startup. The model selects on the `description`, so each
one names the phrasings that should trigger it; `/skill:<name> <args>` forces
one explicitly.

| Skill | The question it answers |
|---|---|
| `trace-decision` | "What did we decide about X, and why? Is it actually settled?" |
| `find-expert` | "Who knows about X / owns Y / should I ask?" |
| `onboard-to-project` | "Get me up to speed on X." |
| `triage-pr-feedback` | "What's left to do on PR #N?" |
| `activity-digest` | "What shipped last week / what has moved on X?" |

## How these were chosen

Not by guessing. Two inputs:

**The published gitagent agents** decompose by *user-facing task*, never by data
source, and none has a router or a formatting skill (`RESEARCH-GAP-IDIOM.md`
§5). `claude-law-firm` has `contract-review`, `legal-research`,
`policy-writing`; `gstack-agent` has `review`, `ship`, `retro`. Every one is a
named procedure.

**Glean's own engineering agent library** — eight agents, of which five are
read-only: project onboarding, resolve PR feedback, standup, launch
documentation, self-evaluation. `onboard-to-project`, `triage-pr-feedback` and
`activity-digest` map directly onto those.

Two earlier plans were retired:

- *`search-gmail` / `search-drive` / `search-github` / `federate` / `cite`* —
  a split by source and pipeline stage, which has no precedent in the corpus.
- *`answer-question`* — a single generic skill. A skill has to be *selected*,
  and one that always applies cannot be. That content belongs in `SOUL.md` and
  `RULES.md`, which is where it now lives.
- *`check-policy`* — dropped because "find the file and read it" is not a
  procedure. The interesting version, where a file and a thread disagree, is
  `trace-decision`'s job.

## Where things live

Per-source mechanics live in the tools (`tools/*.yaml`), not in skills. As more
sources are connected they go in `skills/<name>/references/<source>.md` — the
authors' own pattern for a skill spanning several backends.

Shared discipline — citation format, the search budget, rate-limit handling,
proposal-versus-decision — lives in `RULES.md` under Output Constraints and
Interaction Boundaries, which is how every agent in the corpus handles an
output contract.

Add a skill when a genuinely different **question shape** needs a different
procedure. Never when a new source is connected.
