// Deterministic tests for choosing a skill — no keys, no network, no model.
//
// These run against the agent's REAL skills directory rather than fixtures.
// That is deliberate: the thing under test is whether this agent's actual
// skill descriptions select correctly for this agent's actual questions, and
// a fixture would only prove the algorithm agrees with itself. The cost is
// that editing a skill's description can fail a test here — which is the
// intended alarm, not a nuisance, since that edit changes what fires.
//
// The precision cases matter more than the recall ones. A skill that fires
// with the wrong procedure sends the agent down a set of steps built for a
// different question; not firing merely leaves it where it is today.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  matchSkill,
  triggersOf,
  readProcedure,
  examplesOf,
  questionSimilarity,
} from "../app/server/skill-match.mjs";

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const pick = (question) => matchSkill(SKILLS, question)?.slug ?? null;

test("the who-questions select find-expert", () => {
  assert.equal(pick("Who knows about payments?"), "find-expert");
  assert.equal(pick("Who owns the accessibility audit for the NHS pilot?"), "find-expert");
  assert.equal(pick("Who should I ask about the offline sync layer?"), "find-expert");
  assert.equal(pick("Who has done this before with vets?"), "find-expert");
});

test("time-bounded questions select recent-activity", () => {
  assert.equal(pick("What shipped last week?"), "recent-activity");
  assert.equal(pick("Catch me up on the NHS pilot"), "recent-activity");
});

test("orientation questions select onboard-to-project", () => {
  assert.equal(pick("Get me up to speed on the Android app"), "onboard-to-project");
  assert.equal(pick("Tell me about the Brightsmile account"), "onboard-to-project");
});

test("a factual lookup selects nothing", () => {
  // Every one of these is answered by retrieving a document. A procedure for
  // weighing evidence about people, or for summarising a period, would send
  // the agent somewhere the answer is not.
  //
  // "What is our refund policy for an outage?" was in this list and should
  // not have been. trace-decision names it as its own example, and the author
  // is right: the interesting half of that answer is the exception someone
  // made, which is a decision to trace rather than a document to fetch.
  for (const q of [
    "How many days of leave can I carry over?",
    "How do I export our patient list?",
    "Are we using Postgres 15 or 16 for the reporting replica?",
    "Did we tell Brightsmile the app would be ready in March?",
    "What is our offboarding process?",
  ]) {
    assert.equal(pick(q), null, `expected no skill for: ${q}`);
  }
});

test("a question close to a skill's own example selects it", () => {
  // The second signal. None of these contains a trigger phrase verbatim; each
  // is a rewording of a question the skill names in its "When to Use".
  assert.equal(pick("Have we decided to rewrite the sync layer a third time?"), "trace-decision");
  assert.equal(pick("What is our refund policy for an outage?"), "trace-decision");
  assert.equal(pick("Who should review this PR?"), "find-expert");
  assert.equal(pick("What has Priya been working on recently?"), "recent-activity");
});

test("a trigger beats an example, so the author's explicit claim wins", () => {
  const m = matchSkill(SKILLS, "Get me up to speed on the Android app");
  assert.equal(m.slug, "onboard-to-project");
  assert.equal(m.via, "trigger");
});

test("every skill lists example questions for the second signal to use", () => {
  // Two of the four had none, which made them reachable only by exact
  // trigger. A skill with no examples silently loses half its coverage, and
  // nothing else would report that.
  for (const slug of ["find-expert", "onboard-to-project", "recent-activity", "trace-decision"]) {
    assert.ok(examplesOf(SKILLS, slug).length >= 3, `${slug} needs example questions`);
  }
});

test("similarity ignores question words, which otherwise match everything", () => {
  // "What is our X?" against "What is our Y?" is three shared function words
  // and no shared meaning. Left in, that scored 0.50 and fired the wrong
  // skill on a real eval question.
  assert.equal(
    questionSimilarity("What is our offboarding process?", "What is our position on discounting?"),
    0,
  );
  assert.ok(questionSimilarity("Who should review this PR?", "Who should review this?") > 0.9);
});

test("a bare “why” does not drag in trace-decision", () => {
  // trace-decision advertises "why" as a trigger. Honouring a three-letter
  // phrase would fire it on any question containing the word — including
  // these, which are incidents and lookups rather than decisions.
  assert.equal(pick("Why were some patients charged twice in March?"), null);
  assert.equal(pick("Why were Meadow Veterinary's reminders arriving at 3am?"), null);
});

test("the longest trigger wins when two match", () => {
  // "who owns" and "who has done this before" are both find-expert's, but a
  // longer phrase is a more specific claim on the question. Asserted through
  // the trigger rather than the slug so the ordering rule itself is pinned.
  const m = matchSkill(SKILLS, "Who has done this before, and who owns it now?");
  assert.equal(m.slug, "find-expert");
  assert.equal(m.trigger, "who has done this before");
});

test("triggers below the specificity floor are discarded", () => {
  const kept = triggersOf('Use for "why", "what is", "who owns", "get me up to speed on"');
  assert.deepEqual(kept, ["who owns", "get me up to speed on"]);
});

test("placeholder triggers are discarded rather than matched literally", () => {
  assert.deepEqual(triggersOf('Use for "what has {person} been working on"'), []);
});

test("a match carries the procedure, without its frontmatter", () => {
  const m = matchSkill(SKILLS, "Who knows about payments?");
  assert.ok(m.body.length > 200, "expected the skill's instructions");
  assert.ok(!m.body.includes("license:"), "frontmatter leaked into the procedure");
  assert.ok(!m.body.includes("allowed-tools:"), "frontmatter leaked into the procedure");
  assert.ok(!m.body.startsWith("---"), "frontmatter leaked into the procedure");
});

test("a missing skill yields null rather than throwing", () => {
  assert.equal(readProcedure(SKILLS, "no-such-skill"), null);
  assert.equal(matchSkill(join(SKILLS, "nowhere"), "Who owns this?"), null);
});

test("matching ignores case and punctuation", () => {
  assert.equal(pick("WHO OWNS the payment webhook?!"), "find-expert");
});

test("a trigger must be a whole phrase, not a fragment inside a word", () => {
  // "who owns" must not be found inside "whoever owns" — the padding in
  // `normalise` is what enforces that, and it is easy to lose in a refactor.
  assert.equal(pick("Tell whoever ownsthis to look"), null);
});
