// Citation verification.
//
// Badger's core promise is that every claim traces to something it retrieved.
// Until now that promise was a line in RULES.md asking the model nicely, and it
// has already been broken: one run emitted
// "https://github.alanmathews9/arkind-internal/issues/15" — the ".com" dropped
// while copying, a URL that does not exist. A wrong answer carrying a
// real-looking link is worse than no answer, because it gets forwarded.
//
// This turns the promise into a check: anything the answer cites must appear in
// what the tools actually returned during the session.
//
// NOT done as a gitagent post_response hook. That hook is fired without await,
// its result is discarded, and its payload is only { event, session_id } — it
// never receives the response text (dist/index.js:122, dist/sdk.js:359). It
// cannot see or stop anything. Verification has to live where the message
// stream does, which is the SDK caller.

/** Everything a citation can be, extracted from one block of text. */
export function extractCitations(text) {
  const s = String(text ?? "");
  return {
    urls: [...s.matchAll(/https?:\/\/[^\s)\]<>"']+/g)].map((m) => m[0].replace(/[.,;:]+$/, "")),
    // "#18" and "PR #23" — the numbers Badger cites issues and PRs by.
    numbers: [...new Set([...s.matchAll(/(?:^|[\s(\[])#(\d{1,6})\b/g)].map((m) => m[1]))],
    // Repo-relative paths: handbook/security-and-data.md, site/content/services.md
    paths: [...new Set([...s.matchAll(/\b((?:[\w.-]+\/)+[\w.-]+\.(?:md|yaml|yml|json|txt|ts|js|py|sql))\b/g)].map((m) => m[1]))],
  };
}

/**
 * Verify an answer against the concatenated text of every tool result.
 *
 * Deliberately one-directional: it proves a cited thing WAS retrieved. It does
 * not prove the answer characterises it correctly — quoting real issue #18 but
 * misrepresenting what Priya said would pass. Fabricated sources are the
 * failure that actually happens; this kills that class.
 */
export function verifyCitations(answer, toolOutputs) {
  const corpus = (Array.isArray(toolOutputs) ? toolOutputs : [toolOutputs]).join("\n");
  const cited = extractCitations(answer);
  const findings = [];

  for (const url of cited.urls) {
    // Ignore links to the tools' own docs or anything non-repo the model may
    // legitimately mention; only repository URLs are citations here.
    if (!/github\.com/i.test(url) && !/github\./i.test(url)) continue;
    if (!corpus.includes(url)) {
      // A malformed host is the observed failure, so name it specifically —
      // "invented" reads as a hallucinated issue, which is a different bug.
      const malformed = !/^https:\/\/github\.com\//i.test(url);
      findings.push({
        kind: malformed ? "malformed-url" : "unretrieved-url",
        value: url,
        detail: malformed
          ? "not a valid github.com URL and never appeared in any tool result"
          : "never appeared in any tool result",
      });
    }
  }

  for (const n of cited.numbers) {
    // Accept the number if the corpus mentions it as an issue/PR anywhere.
    const seen = new RegExp(`(?:^|[\\s(\\[/])#?${n}\\b`, "m").test(corpus);
    if (!seen) {
      findings.push({ kind: "unretrieved-reference", value: `#${n}`, detail: "no tool result mentions this issue or PR number" });
    }
  }

  for (const p of cited.paths) {
    if (!corpus.includes(p)) {
      findings.push({ kind: "unretrieved-path", value: p, detail: "no tool result contains this file path" });
    }
  }

  return {
    ok: findings.length === 0,
    checked: cited.urls.length + cited.numbers.length + cited.paths.length,
    findings,
  };
}

/** One-line human summary, for a CLI or a UI badge. */
export function formatVerification(result) {
  if (result.checked === 0) return "citations: none to verify";
  if (result.ok) return `citations: ${result.checked} verified, all retrieved`;
  const lines = result.findings.map((f) => `  ✗ ${f.value} — ${f.detail}`);
  return `citations: ${result.findings.length} of ${result.checked} UNVERIFIED\n${lines.join("\n")}`;
}
