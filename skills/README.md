# Skills

Each skill is a directory holding `SKILL.md` with YAML frontmatter (`name`,
`description`, `license`, `allowed-tools`, `metadata`). Skills named in
`agent.yaml` load at startup; invoke one explicitly with
`/skill:<name> <args>`, though the model selects on the `description`.

| Skill | Purpose |
|---|---|
| `answer-question` | Answer a question about the company's own work by searching connected sources live, reading the threads behind the results, and citing every claim. |

## Why one skill, and not one per source

An earlier plan here listed five: `search-gmail`, `search-drive`,
`search-github`, `federate`, `cite`. That was a split by **data source and
pipeline stage**, and reading seventeen published gitagent agents showed it has
no precedent — those agents decompose by **user-facing task**, and none of them
has a routing or formatting skill (see `RESEARCH-GAP-IDIOM.md` §5).

So per-source mechanics live in the tools (`tools/*.yaml`) and, as more sources
arrive, in `skills/answer-question/references/<source>.md`. Citation is an
output-format section inside the skill plus a rule in `RULES.md`, which is how
every agent in the corpus handles an output contract.

New skills should be added when a genuinely different **question shape** needs
a different procedure — a scheduled digest, or reconstructing a decision
timeline — not when a new source is connected.
