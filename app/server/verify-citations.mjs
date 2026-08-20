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
    ...extractSourceLines(s),
  };
}

/**
 * Mail and Drive citations, taken from the Sources block.
 *
 * GitHub citations carry an id — a number, a path, a URL — that can be matched
 * literally. Mail and documents have no such handle: RULES.md has them cited by
 * subject and by document name, which are free text, so they need parsing
 * rather than pattern-matching against the whole answer.
 *
 * Formats, from RULES.md:
 *   - {subject} — mail, {sender}, {date}. {contribution}
 *   - {document name} — {doc|sheet}, {date}. {what it says}
 *   - {document name}, comment by {speaker} — {what it says}
 *
 * This class of citation is exactly the one worth checking. A fabricated issue
 * number is conspicuous; a fabricated mail subject attributed to a real
 * colleague reads as authoritative and is the more dangerous invention.
 */
/**
 * Drop a leading reference marker from a free-text source name.
 *
 * RULES.md asks for `- {subject} — mail, …` and `- {name} — doc, …`, and the
 * model numbers its list instead: `- #1 Refund Policy — doc, 2026-08-18.` The
 * number then travelled into the name, so verification searched tool output
 * containing "1. Refund Policy" for the literal "#1 Refund Policy" and reported
 * a document that had plainly been read as unretrieved.
 *
 * It applied to mail first and to documents a run later, which is the whole
 * reason this is one function rather than three copies of a regex: the fix was
 * made twice because the second place was missed.
 *
 * Stripped rather than forbidden. Numbering a list is not wrong, and a
 * formatting habit must never read as a fabricated source. A name that
 * genuinely never appeared is still reported.
 */
function unnumber(text) {
  return String(text ?? "").replace(/^#\d+\s+/, "").trim();
}

function extractSourceLines(s) {
  const mail = [];
  const documents = [];

  for (const line of s.split("\n")) {
    const item = line.match(/^\s*[-*]\s+(.*)$/);
    if (!item) continue;
    const body = item[1].trim();

    const asMail = body.match(/^(.+?)\s+—\s+mail,\s*([^,]+?),/i);
    if (asMail) {
      // Strip a leading reference marker off the subject.
      //
      // RULES.md asks for `- {subject} — mail, {sender}, {date}`, and the
      // model has started writing `- #1 Our reminders are going out at 3am —
      // mail, …` instead, numbering its sources the way it numbers GitHub
      // issues. The number then travelled into the subject, so verification
      // looked for the literal "#1 Our reminders…" in tool output that
      // contains "1. Our reminders…" — and reported a perfectly real message
      // as unretrieved. Five citations on one answer, on a run whose retrieval
      // was correct.
      //
      // Stripped rather than forbidden, because this is the model formatting a
      // list and it is not wrong to number things. What must not happen is a
      // formatting habit reading as a fabricated source.
      mail.push({ subject: unnumber(stripLink(asMail[1])), sender: asMail[2].trim() });
      continue;
    }

    const asDoc = body.match(/^(.+?)\s+—\s+(doc|sheet|document|spreadsheet)\b/i);
    if (asDoc) {
      documents.push(unnumber(stripLink(asDoc[1])));
      continue;
    }

    const asComment = body.match(/^(.+?),\s*comment by\s+([^—]+?)\s*—/i);
    if (asComment) documents.push(unnumber(stripLink(asComment[1])));
  }

  return { mail, documents };
}

/**
 * Citations may be written as markdown links; compare the visible text.
 *
 * Tolerant of the ways a model actually writes a link, which are not always the
 * way the spec does. Gemini emits `[Title] (url)` with a space, and
 * `[Title]((id))` with doubled parentheses, often enough that a strict
 * `^\[(.*)\]\([^)]*\)$` left the whole string — brackets, URL and all — as
 * the "title", which then matched nothing.
 *
 * That produced a **false** `unretrieved-document` on a document the agent had
 * genuinely opened, and the UI stamps those `[UNVERIFIED]`. A verifier that
 * cries wolf on correct answers is worse than no verifier: it teaches the
 * reader to ignore the badge, which is the one thing the badge cannot survive.
 * Found by the eval set, 2026-08-18.
 *
 * Being generous here does not weaken the check. What is verified is the
 * extracted *title*, and it still has to appear in something a tool returned;
 * all this does is extract the title correctly in the first place.
 */
const stripLink = (s) =>
  String(s)
    .replace(/^\[(.*?)\]\s*\(+[^)]*\)+$/, "$1")
    .replace(/^\*\*|\*\*$/g, "")
    .trim();

/**
 * Loose containment: collapse whitespace, ignore case, and ignore a leading
 * "Re:" so that a reply cited by its subject still matches the thread it was
 * retrieved from. Deliberately forgiving — the target is invention, not
 * transcription.
 */
export function mentions(corpus, value) {
  const norm = (t) =>
    String(t)
      .toLowerCase()
      .replace(/^re:\s*/i, "")
      .replace(/[‘’“”]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  const needle = norm(value);
  return needle.length > 3 && norm(corpus).includes(needle);
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

  for (const m of cited.mail) {
    if (!mentions(corpus, m.subject)) {
      findings.push({
        kind: "unretrieved-mail",
        value: m.subject,
        detail: "no tool result contains a message with this subject",
      });
    } else if (m.sender && !mentions(corpus, m.sender)) {
      // The thread is real but the attribution is not — the more damaging half,
      // since the quote then reads as something a named colleague said.
      findings.push({
        kind: "misattributed-mail",
        // The subject alone, so annotateUnverified can find it in the answer —
        // "subject — sender" is assembled by the citation format and does not
        // appear as one literal string anywhere.
        value: m.subject,
        detail: `the thread was retrieved but "${m.sender}" never appears in it`,
      });
    }
  }

  for (const d of cited.documents) {
    if (!mentions(corpus, d)) {
      findings.push({
        kind: "unretrieved-document",
        value: d,
        detail: "no tool result contains a document with this name",
      });
    }
  }

  return {
    ok: findings.length === 0,
    checked:
      cited.urls.length +
      cited.numbers.length +
      cited.paths.length +
      cited.mail.length +
      cited.documents.length,
    findings,
  };
}

/**
 * Mark unverified citations inline rather than failing the whole answer.
 *
 * Borrowed from claude-law-firm's legal-research skill, which flags a citation
 * it cannot stand behind as "[UNVERIFIED — attorney should confirm]" instead of
 * dropping the memo. An answer is usually mostly right; blocking all of it over
 * one bad link hides four good ones. The reader needs to know which claim to
 * distrust, not that something somewhere is wrong.
 */
export function annotateUnverified(answer, result) {
  if (result.ok) return String(answer ?? "");
  const bad = new Set(result.findings.map((f) => f.value));
  const TAG = " `[UNVERIFIED]`";
  let out = String(answer ?? "");

  // Markdown links first, annotating AFTER the closing paren. A naive
  // find-and-replace injects the tag inside the URL and inside the link text,
  // which breaks the link — the one thing a citation must not do.
  out = out.replace(/\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g, (whole, text, url) => {
    const refs = [...String(text).matchAll(/#(\d{1,6})/g)].map((m) => `#${m[1]}`);
    const hit = bad.has(url) || refs.some((r) => bad.has(r));
    return hit ? whole + TAG : whole;
  });

  // Then bare occurrences — paths and #refs outside any link. Skip anything
  // already inside a link or already tagged.
  for (const v of [...bad].sort((a, b) => b.length - a.length)) {
    if (/^https?:/.test(v)) continue; // URLs are only cited inside links
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<!\\]\\()${esc}(?![^\\s]*\\)| \`\\[UNVERIFIED)`, "g"), v + TAG);
  }

  return out;
}

/** One-line human summary, for a CLI or a UI badge. */
export function formatVerification(result) {
  if (result.checked === 0) return "citations: none to verify";
  if (result.ok) return `citations: ${result.checked} verified, all retrieved`;
  const lines = result.findings.map((f) => `  ✗ ${f.value} — ${f.detail}`);
  return `citations: ${result.findings.length} of ${result.checked} UNVERIFIED\n${lines.join("\n")}`;
}
