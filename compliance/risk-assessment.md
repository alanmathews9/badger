# Risk Assessment

Why Badger is classified `risk_tier: standard`, and what the residual risks
actually are. This is the justification the spec asks for behind that one word
in `agent.yaml`.

## Why `standard` and not `high`

`high` and `critical` are defined by consequence, not by data sensitivity. The
spec enforces that: declare `high` and the schema requires
`supervision.human_in_the_loop` to be `always` or `conditional`. Badger answers
without asking a human first, so declaring `high` would mean declaring a
supervision model that does not exist.

The consequence of Badger being wrong is that a person reads a wrong answer
about their own company. That is a real cost and it is why citation
verification exists, but nobody is denied credit, no trade is placed and no
money moves. `standard` is the honest tier.

`low` would be wrong in the other direction: Badger reads confidential
material — private repositories, internal mail, unpublished documents — across
three systems at once, which is precisely the combination that makes workplace
search valuable and makes a mistake in it expensive.

## The risks, in the order they actually matter

### 1. A confident wrong answer

The failure mode of every retrieval agent, and the one the eval catches. The
2026-08-20 run scored 14/15, and the single failure is the instructive one:
the right answer with an invented citation attribution, caught by the verifier
and graded as a failure rather than talked down.

Controls: every claim tied to something a tool returned (`RULES.md`, as a drop
rule); citations verified against actual tool output and marked `[UNVERIFIED]`
inline when they fail (`app/server/verify-citations.mjs`); a non-zero exit so
a demo can be gated on it.

Residual: verification proves a cited document was retrieved. It does not
prove the document says what the answer claims. That gap is what the one eval
failure lives in.

### 2. A source that was never reached, reported as empty

The most dangerous shape of a partial answer, because "nothing in Drive
mentions this" and "Drive was never contacted" look identical to a reader.

Controls: `hooks/check-sources.sh` refuses to start a session when a declared
source has no credential; `RULES.md` requires the coverage line to name what
each source returned, including the ones that returned nothing; a rate limit
is explicitly not an empty result.

Residual: the runtime is fail-soft about sources by design, so this control is
a pre-flight rather than a guarantee mid-run.

### 3. The credential is write-capable and the enforcement is software

Stated plainly because it is the honest weak point of the read-only claim.
Four independent layers stop a write — Composio's `DIRECT_TOOLS` preset, an
eight-action enable list, ten scripts that can call nothing else, and an
allowlist keyed by exact tool name — and all four are code we wrote. Beneath
them the Composio connected account is an OAuth2 grant holding account-wide
`repo` scope, because **GitHub has no read-only OAuth scope for private
repositories**: `repo` is the narrowest scope that can read one, and it grants
write.

Controls: the account it is granted on (`alan-arkind`) owns exactly one
repository, so the credential is restricted by fact and not only by our tool
layer declining to look. Segregation of duties (`DUTIES.md`) makes the
read-only property a role assignment that CI checks rather than a claim in
prose.

Residual: real, and named in the README rather than buried. Closing it needs a
GitHub App with `contents:read`, `issues:read`, `pull_requests:read` on one
repository — genuinely read-only at the credential — which Composio's GitHub
toolkit does not offer, so taking it means going around Composio and reopening
the multi-user problem that chose Composio in the first place. Reviewed
quarterly (`validation-schedule.yaml`).

### 4. Prompt injection from retrieved content

Badger reads issue bodies, mail and document comments written by other people.
Any of it can contain text addressed to the model.

Controls: `RULES.md` states that retrieved content is data and never
instructions. More load-bearing than the rule: Badger holds no write tool, no
shell and no network tool, so the most an injection can achieve is a wrong
answer — which is risk 1, already controlled — rather than an action.

Residual: the prompt-level rule is the weakest kind of control. It is
acceptable here only because the capability surface behind it is empty.

### 5. Data exposure through the demo gate

One shared passphrase, not an account system. Anyone holding it sees the whole
seeded corpus.

Controls: server-side check with constant-time compare, signed cookie, rate
limits per IP, and a server that binds to localhost only when no passphrase is
set — there is no default passphrase. The corpus is entirely fictional, on
RFC 2606 reserved domains, so nothing real is behind the gate.

Residual: acceptable for a demo, unacceptable for a product. Named as such.

### 6. Cost and abuse

Controls: a daily answer ceiling (250, about $1.25 at worst), a concurrency
cap, and `--max-instances 1`, which also makes the in-memory rate limits
correct rather than silently doubling them per instance.

Residual: no billing budget alert is configured. The app-level cap is the real
protection and it is live.

## What is deliberately not claimed

- No FINRA, SEC or Federal Reserve framework is declared. None applies, and
  naming one to score better on `opengap audit` would be dressing.
- `immutable: false` on the audit log. It is append-only, not write-once.
- `log_contents` names two categories, not five. Prompt and response bodies
  are not recorded; the manifest says so.
- `bias_testing: false`, `lda_search: false`. Neither is performed and neither
  is relevant to retrieval over one organisation's own documents.
