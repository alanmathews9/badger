# Skills

Each skill is a directory containing `SKILL.md` with YAML frontmatter
(`name`, `description`, optional `metadata`), plus an optional `scripts/`.
Skills listed in `agent.yaml` are loaded at startup; invoke one in the REPL
with `/skill:<name> <args>`.

Planned for Badger — prompts land next session:

| Skill | Purpose |
|---|---|
| `search-gmail` | Turn a natural-language question into Gmail query syntax (`from:`, `after:`, `has:attachment`), page results, rank by recency and thread depth. |
| `search-drive` | Drive full-text plus metadata search; decide when to open a document versus trust its title and snippet. |
| `search-github` | Code, issue, PR and discussion search; map "who owns X" to CODEOWNERS and commit history. |
| `federate` | Fan out one question to all three sources, run them concurrently, merge and dedupe results, and report which sources answered and which failed. |
| `cite` | Format the answer: finding first, then citations with source, title, author, date and link. Enforces the no-uncited-claims rule from RULES.md. |

Keep each `SKILL.md` under roughly 150 lines. They are injected into context on
invocation, and Badger's turns already carry large tool results.
