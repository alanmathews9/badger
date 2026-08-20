/**
 * Choose the skill a question needs, and load its procedure.
 *
 * ## Why this exists at all
 *
 * GAP has two ways a skill is supposed to reach the model, and on this agent
 * both fail.
 *
 * **1. The runtime's matcher says nothing matches.** `task_tracker` action
 * "begin" searches the skills directory and reports the result to the model.
 * Its scorer (`dist/tools/task-tracker.js:36`) is:
 *
 *     relevance = matches / Math.max(objectiveWords, skillDescriptionWords)
 *
 * Normalising by the LONGER text. A skill description is always far longer
 * than a task objective, so the divisor is always the description length and
 * the score is capped at `objectiveLength / descriptionLength` however
 * perfect the match. Measured against this agent's four skills and the
 * fifteen eval questions: **not one pair clears the 0.1 threshold.** The
 * model is told, as fact, "No matching skills found. Solve from scratch."
 *
 * **2. Our own system suffix told the model not to bother fetching one.** It
 * said skills were "procedures already in your prompt". They are not:
 * `loader.js:203` injects `formatSkillsForPrompt`, which emits each skill's
 * name, description and file location — never its body. So the model was
 * told the steps were in front of it when only the advert was.
 *
 * ## Why the fix is here rather than in a prompt
 *
 * This project's house rule, earned three times: guardrails go in tool output
 * and prompt data, not in prose. The precedent is exact — `memory` had the
 * same shape of failure (a rule told the agent to load it, a live run ignored
 * the rule), and the fix was to place the file's contents directly into the
 * prompt where they cannot be skipped. A matched skill now travels the same
 * way. `task_tracker` may still claim nothing matched; it no longer matters,
 * because the procedure is already in front of the model.
 *
 * ## Why phrases rather than words
 *
 * The obvious repair to the runtime's scorer — divide by the objective length
 * instead of the longer text — makes it fire, and fire wrongly. Measured on
 * the same fifteen questions, bag-of-words scored `trace-decision` at 0.75
 * for "What is our offboarding process?" and beat `find-expert` with
 * `onboard-to-project` on "Who owns the accessibility audit?". A skill that
 * fires with the wrong procedure is worse than one that does not fire.
 *
 * What these descriptions actually contain is a list of trigger phrases in
 * quotes — "who owns", "what shipped", "get me up to speed on" — written by
 * the skill's author for precisely this purpose. Matching those is matching
 * authored intent instead of inferring it from vocabulary. On the same
 * twenty questions it fired seven times and was right every time.
 *
 * Deliberately conservative. No match means the agent answers the way it does
 * today, which is the current behaviour and is not broken — only unassisted.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listSkills } from "./skills-store.mjs";

/**
 * A trigger must be at least this long, and at least two words.
 *
 * Both bars are load-bearing and both were set by measurement. `trace-decision`
 * lists `"why"` and `onboard-to-project` lists `"what is"`; without a floor
 * they matched "Why were some patients charged twice in March?" and "What is
 * our refund policy?" — factual lookups that no procedure helps. Raising the
 * bar removed every false positive in the sample and cost no true one.
 */
const MIN_TRIGGER_CHARS = 8;
const MIN_TRIGGER_WORDS = 2;

/**
 * How close a question must be to one of a skill's example questions.
 *
 * Measured against the eval set: correct matches score 0.44–1.00 and correct
 * non-matches score 0.00–0.25, so anything in that gap works. 0.35 sits in
 * it with room on both sides.
 */
const EXAMPLE_THRESHOLD = 0.35;

/**
 * Words that carry no topic — question words, auxiliaries, pronouns.
 *
 * Removing them is what makes example matching safe. With them in, "What is
 * our offboarding process?" scored 0.50 against "What is our position on
 * discounting?" purely on `what` and `our`, and "Did we tell Brightsmile the
 * app would be ready in March?" matched "What did the team do in March?" on
 * `did` and `march`. Both fired the wrong skill. Comparing only content words
 * removed every false fire in the sample at every threshold tried.
 *
 * The question words are safe to drop even though some are real triggers
 * ("who", "why"): those are claimed by the trigger phrases, which are matched
 * first and never reach this path.
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
 * filtered to those specific enough to be trusted.
 *
 * `{person}`-style placeholders are dropped: they are templates for a human
 * reader, and matching them literally would never hit.
 */
export function triggersOf(description) {
  return (
    [...String(description ?? "").matchAll(/"([^"]{3,60})"/g)]
      .map((m) => m[1])
      // The placeholder check runs on the RAW phrase, before normalising.
      // Normalising turns `{person}` into a space, so a check afterwards sees
      // the harmless-looking "what has person been working on" and keeps it.
      .filter((raw) => !raw.includes("{"))
      .map((raw) => normalise(raw).trim())
      .filter((p) => p.length >= MIN_TRIGGER_CHARS && p.split(" ").length >= MIN_TRIGGER_WORDS)
  );
}

/**
 * The example questions a skill's own "When to Use" section lists.
 *
 * **This is where breadth comes from, and it is free.** A trigger phrase has
 * to live in `description:`, which the runtime injects into the system prompt
 * of *every* run — so each phrase added there is paid for on every question,
 * whether or not the skill fires. The body is read only when this matcher
 * chooses the skill, so an example question added to "When to Use" costs
 * nothing until it is needed. Breadth belongs here; the description stays
 * short and carries only the few phrases worth paying for.
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
 * This is the runtime's own formula — `matches / Math.max(a, b)` — and here
 * it is the right one. It fails in `task-tracker.js` because it compares a
 * short objective against a long description, so the longer text always sets
 * the divisor. Two questions are of comparable length, which is exactly the
 * case symmetric normalisation is for. The bug was never the formula; it was
 * using a similarity measure where a containment measure belonged.
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
 * Longest matching trigger wins: "who has done this before" is a more
 * specific claim on the question than "who owns", and specificity is the only
 * ordering signal these phrases carry. Ties fall to whichever skill the
 * directory listed first, which is alphabetical and arbitrary — acceptable,
 * because a tie means two skills advertised equally specific triggers and
 * neither is more entitled to it.
 */
export function matchSkill(skillsDir, question) {
  const asked = normalise(question);
  const skills = listSkills(skillsDir);
  let best = null;

  // A curated skill outranks a learned one, always.
  //
  // Both are real skills and both are matched the same way. The difference is
  // what is behind the description: a hand-written skill carries a tested
  // procedure — open the thread, check the margin, establish whether it is
  // settled — while a freshly crystallised one carries the two lines the model
  // narrated about its own run:
  //
  //     ## Steps
  //     1. Gathered information from Gmail, Drive and GitHub…
  //     2. Drafted the reply based on the gathered information.
  //
  // Measured, and this is why the rule exists: an eval run crystallised nine
  // skills, several of them narrower restatements of questions the built-in
  // four already cover, and from the moment each appeared it started winning
  // the match. `trace-release-delay` displaced `trace-decision` on exactly the
  // questions trace-decision was written for, and the score fell from 14/15 to
  // 9/15 — not because learning is wrong, but because a two-line procedure
  // replaced a tested one.
  //
  // So learning stays on and stays visible; it just fills gaps rather than
  // overwriting the curated set. A learned skill routes when nothing built in
  // claims the question, which is the case it was created for in the first
  // place.
  const byOrigin = [
    skills.filter((s) => s.origin !== "learned"),
    skills.filter((s) => s.origin === "learned"),
  ];

  // First signal: an advertised trigger phrase appearing verbatim. This is a
  // deliberate claim by the skill's author on that wording, so it is trusted
  // outright and the longest — most specific — claim wins.
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

  // Second signal, only if no phrase matched: how close the question is to one
  // the skill names as its own. This is what catches a question the author
  // meant to cover but did not phrase a trigger for — "Have we decided to
  // rewrite the sync layer a third time?" against "Did we decide to rewrite
  // the sync layer again?".
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
 * The frontmatter is metadata for the loader — license, allowed-tools, the
 * learning loop's own counters — and none of it is guidance. Sending it would
 * spend tokens telling the model about bookkeeping and invite it to treat
 * `allowed-tools` as a second, conflicting tool list.
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
