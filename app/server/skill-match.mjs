/**
 * Choose the skill a question needs, and load its procedure.
 *
 * GAP offers three routes to get a skill in front of the model, and this file
 * replaces the third:
 *
 * 1. `task_tracker`'s matcher — broken. It normalises by the LONGER text
 *    (`dist/tools/task-tracker.js:36`), so no skill here clears its 0.1
 *    threshold and the model is told "No matching skills found".
 * 2. `formatSkillsForPrompt` — name, description and location only. An advert.
 * 3. Read-on-demand — the framework's real mechanism, and it works
 *    (`dist/skills.js:103-130` tells the model to `read` the SKILL.md).
 *
 * Route 3 is replaced because it spends a turn and a tool call before any
 * retrieval, while route 1 has already told the model nothing matches. A
 * size-dependent trade: at four skills the body fits in the prompt, at fifty
 * it does not — past a handful, delete this file and use route 3.
 *
 * Matching is on the quoted trigger phrases in a description, not word
 * overlap, which fires wrongly. No match means the agent answers unassisted.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listSkills } from "./skills-store.mjs";

/**
 * A trigger must clear both bars. Without them the one-word triggers `"why"`
 * and `"what is"` matched plain factual lookups no procedure helps.
 */
const MIN_TRIGGER_CHARS = 8;
const MIN_TRIGGER_WORDS = 2;

/**
 * How close a question must be to one of a skill's example questions. On the
 * eval set correct matches score 0.44–1.00 and correct non-matches 0.00–0.25;
 * 0.35 sits in the gap.
 */
const EXAMPLE_THRESHOLD = 0.35;

/**
 * Words that carry no topic. Comparing only content words is what makes
 * example matching safe: with these in, two questions sharing "what" and "our"
 * scored 0.50 and fired the wrong skill.
 *
 * Dropping "who" and "why" is safe even though they are real triggers — those
 * are claimed by trigger phrases, which are matched first.
 */
const STOP = new Set(
  ("what our the did was were why how who are and for with about you your they them from " +
    "been has have had get got into over out all any some its this that does can will would " +
    "should not but then than when which while there here more most each other").split(" "),
);

/** Words worth comparing: short and function words carry no signal. */
const words = (text) =>
  normalise(text)
    .trim()
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w));

/** Comparable form: lowercase, punctuation to spaces, single-spaced, padded. */
const normalise = (text) =>
  " " +
  String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim() +
  " ";

/**
 * The trigger phrases a description advertises — every quoted run of text,
 * filtered to those specific enough to be trusted. `{person}`-style
 * placeholders are dropped; matching them literally would never hit.
 */
export function triggersOf(description) {
  return (
    [...String(description ?? "").matchAll(/"([^"]{3,60})"/g)]
      .map((m) => m[1])
      // On the RAW phrase: normalising turns `{person}` into a space, so a
      // check afterwards would no longer see the placeholder.
      .filter((raw) => !raw.includes("{"))
      .map((raw) => normalise(raw).trim())
      .filter((p) => p.length >= MIN_TRIGGER_CHARS && p.split(" ").length >= MIN_TRIGGER_WORDS)
  );
}

/**
 * The example questions a skill's own "When to Use" section lists.
 *
 * Breadth belongs here rather than in `description:`, which the runtime puts
 * in every run's system prompt. The body is read only when this matcher picks
 * the skill, so an example question costs nothing until it is needed.
 */
export function examplesOf(skillsDir, slug) {
  const text = readProcedure(skillsDir, slug) ?? "";
  const section = text.match(/## When to Use\r?\n([\s\S]*?)(?:\r?\n## |$)/);
  if (!section) return [];
  return [...section[1].matchAll(/"([^"]+\?)"/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
}

/**
 * How alike two questions are, by shared words.
 *
 * The runtime's own formula, `matches / Math.max(a, b)`, which is correct
 * here: two questions are of comparable length, so symmetric normalisation
 * fits. It fails in `task-tracker.js` only because that compares a short
 * objective against a long description.
 */
export function questionSimilarity(a, b) {
  const x = words(a);
  const y = new Set(words(b));
  if (!x.length || !y.size) return 0;
  return x.filter((w) => y.has(w)).length / Math.max(x.length, words(b).length);
}

/**
 * The skill a question calls for, or null.
 *
 * Longest matching trigger wins — specificity is the only ordering signal
 * these phrases carry. Ties fall to directory order, which is arbitrary and
 * acceptable: neither skill is more entitled to the question.
 */
export function matchSkill(skillsDir, question) {
  const asked = normalise(question);
  const skills = listSkills(skillsDir);
  let best = null;

  // A curated skill outranks a learned one, always. A hand-written skill
  // carries a tested procedure; a crystallised one carries the two lines the
  // model narrated about its own run. When learned skills were allowed to win,
  // `trace-release-delay` displaced `trace-decision` and the eval fell from
  // 14/15 to 9/15. Learning stays on and fills gaps; it does not overwrite.
  const byOrigin = [
    skills.filter((s) => s.origin !== "learned"),
    skills.filter((s) => s.origin === "learned"),
  ];

  // First signal: an advertised trigger phrase appearing verbatim — the
  // author's own claim on that wording, so it is trusted outright.
  for (const tier of byOrigin) {
    for (const skill of tier) {
      for (const trigger of triggersOf(skill.description)) {
        if (!asked.includes(" " + trigger + " ")) continue;
        if (!best || trigger.length > best.trigger.length) {
          best = { slug: skill.slug, name: skill.name, trigger, via: "trigger" };
        }
      }
    }
    if (best) break;
  }

  // Second signal, only if no phrase matched: closeness to a question the
  // skill names as its own. Catches wording the author did not write a trigger
  // for.
  if (!best) {
    for (const skill of [...byOrigin[0], ...byOrigin[1]]) {
      for (const example of examplesOf(skillsDir, skill.slug)) {
        const score = questionSimilarity(question, example);
        if (score < EXAMPLE_THRESHOLD) continue;
        if (!best || score > best.score) {
          best = { slug: skill.slug, name: skill.name, trigger: example, via: "example", score };
        }
      }
    }
  }

  if (!best) return null;
  const body = readProcedure(skillsDir, best.slug);
  return body ? { ...best, body } : null;
}

/**
 * A skill's instructions, without its frontmatter.
 *
 * The frontmatter is loader metadata, not guidance, and sending it would
 * invite the model to treat `allowed-tools` as a second tool list.
 */
export function readProcedure(skillsDir, slug) {
  let text;
  try {
    text = readFileSync(join(skillsDir, slug, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
  return body || null;
}
