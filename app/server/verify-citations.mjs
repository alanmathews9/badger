// Citation verification.
//
// Anything the answer cites must appear in what the tools actually returned
// during the session. A wrong answer carrying a real-looking link is worse
// than no answer, because it gets forwarded.
//
// NOT a gitagent post_response hook: that hook is fired without await, its
// result is discarded, and its payload is only { event, session_id } — it never
// receives the response text (dist/index.js:122, dist/sdk.js:359). Verification
// has to live where the message stream does, which is the SDK caller.

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
 * GitHub citations carry an id that matches literally. Mail and documents are
 * cited by subject and by name — free text, so they need parsing.
 *
 * Formats, from RULES.md:
 *   - {subject} — mail, {sender}, {date}. {contribution}
 *   - {document name} — {doc|sheet}, {date}. {what it says}
 *   - {document name}, comment by {speaker} — {what it says}
 *
 * The dangerous invention: a fabricated issue number is conspicuous, a
 * fabricated mail subject attributed to a real colleague is not.
 */
/**
 * Drop a leading reference marker from a free-text source name.
 *
 * The model numbers its source list — `- #1 Refund Policy — doc, …` — and the
 * number travels into the name, so verification looks for "#1 Refund Policy"
 * in output containing "1. Refund Policy" and reports a real document as
 * unretrieved.
 *
 * Stripped rather than forbidden: numbering a list is not wrong, and a
 * formatting habit must never read as a fabricated source. One function
 * because it applies to mail and to documents alike.
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
      // Strip a leading reference marker off the subject — see stripMarker.
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
 * Tolerant of how a model actually writes a link: Gemini emits `[Title] (url)`
 * with a space and `[Title]((id))` with doubled parentheses, and a strict
 * pattern left the brackets and URL in the "title", which then matched nothing
 * and produced a FALSE `unretrieved-document`.
 *
 * Being generous does not weaken the check: the extracted title still has to
 * appear in something a tool returned.
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
 * One-directional: it proves a cited thing WAS retrieved, not that the answer
 * characterises it correctly. Fabricated sources are the failure that actually
 * happens.
 */
export function verifyCitations(answer, toolOutputs) {
  const corpus = (Array.isArray(toolOutputs) ? toolOutputs : [toolOutputs]).join("\n");
  const cited = extractCitations(answer);
  const findings = [];

  for (const url of cited.urls) {
    // Only repository URLs are citations here.
    if (!/github\.com/i.test(url) && !/github\./i.test(url)) continue;
    if (!corpus.includes(url)) {
      // Named specifically: "invented" reads as a hallucinated issue.
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
      // Thread real, attribution not: it reads as something a colleague said.
      findings.push({
        kind: "misattributed-mail",
        // The subject alone: "subject — sender" is assembled by the citation
        // format and appears as one literal string nowhere.
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
 * An answer is usually mostly right, and blocking all of it over one bad link
 * hides four good ones. The reader needs to know which claim to distrust.
 */
export function annotateUnverified(answer, result) {
  if (result.ok) return String(answer ?? "");
  const bad = new Set(result.findings.map((f) => f.value));
  const TAG = " `[UNVERIFIED]`";
  let out = String(answer ?? "");

  // Links first, annotating AFTER the closing paren: a naive replace injects
  // the tag inside the URL and breaks the link.
  out = out.replace(/\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g, (whole, text, url) => {
    const refs = [...String(text).matchAll(/#(\d{1,6})/g)].map((m) => `#${m[1]}`);
    const hit = bad.has(url) || refs.some((r) => bad.has(r));
    return hit ? whole + TAG : whole;
  });

  // Then paths and #refs outside any link, skipping anything already tagged.
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
