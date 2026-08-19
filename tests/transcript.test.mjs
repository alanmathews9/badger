// Deterministic tests for the chat transcript builder — no keys, no network.
//
// The builder turns a conversation history plus the new question into one
// prompt for the agent. Each case names the property it protects: the bare
// question passes through untouched, prior turns arrive as a transcript, the
// model's own Sources/Coverage boilerplate is stripped before it is re-fed,
// the oldest turns fall off first under the character budget, and a request
// body that is not a well-formed conversation is refused rather than guessed
// at.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, parseAskBody } from "../app/server/transcript.mjs";

test("no history: the prompt is exactly the question", () => {
  assert.equal(buildPrompt([], "Why was the app late?"), "Why was the app late?");
});

test("history arrives as a transcript, question last", () => {
  const prompt = buildPrompt(
    [{ question: "Why was the app late?", answer: "The sync layer was rewritten twice." }],
    "Who decided that?",
  );
  const q1 = prompt.indexOf("Why was the app late?");
  const a1 = prompt.indexOf("The sync layer was rewritten twice.");
  const q2 = prompt.indexOf("Who decided that?");
  assert.ok(q1 >= 0 && a1 > q1 && q2 > a1, prompt);
});

test("Sources and Coverage sections are stripped from prior answers", () => {
  const answer = [
    "The delay was the sync rewrite.",
    "",
    "**Sources**",
    "- #8 Android 4.2 shipped five weeks late",
    "",
    "**Coverage**",
    "- GitHub: 1 search.",
  ].join("\n");
  const prompt = buildPrompt([{ question: "Why late?", answer }], "next");
  assert.ok(prompt.includes("The delay was the sync rewrite."));
  assert.ok(!prompt.includes("**Sources**"));
  assert.ok(!prompt.includes("**Coverage**"));
});

test("oldest turns are dropped first when over budget, newest kept", () => {
  const history = [
    { question: "first question", answer: "x".repeat(6000) },
    { question: "second question", answer: "y".repeat(6000) },
  ];
  const prompt = buildPrompt(history, "third question", { budget: 7000 });
  assert.ok(!prompt.includes("first question"));
  assert.ok(prompt.includes("second question"));
  assert.ok(prompt.includes("third question"));
});

test("a single oversize answer is truncated rather than dropping the whole turn", () => {
  const history = [{ question: "only question", answer: "z".repeat(20000) }];
  const prompt = buildPrompt(history, "next", { budget: 5000 });
  assert.ok(prompt.includes("only question"));
  assert.ok(prompt.length < 7000, `prompt is ${prompt.length} chars`);
});

test("parseAskBody accepts a well-formed conversation", () => {
  const parsed = parseAskBody({
    question: "  Who decided?  ",
    history: [{ question: "Why late?", answer: "Sync rewrite." }],
  });
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.question, "Who decided?");
  assert.equal(parsed.history.length, 1);
});

test("parseAskBody refuses a missing or empty question", () => {
  assert.ok(parseAskBody({}).error);
  assert.ok(parseAskBody({ question: "   " }).error);
});

test("parseAskBody refuses an over-long question", () => {
  assert.ok(parseAskBody({ question: "q".repeat(501) }).error);
});

test("parseAskBody drops malformed history turns instead of failing the request", () => {
  const parsed = parseAskBody({
    question: "ok",
    history: [
      { question: "good", answer: "good" },
      { question: 7, answer: "bad" },
      "not a turn",
      null,
    ],
  });
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.history.length, 1);
});

test("parseAskBody treats a non-array history as empty", () => {
  const parsed = parseAskBody({ question: "ok", history: "nope" });
  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.history, []);
});

test("parseAskBody caps the number of history turns kept, newest kept", () => {
  const history = Array.from({ length: 60 }, (_, i) => ({
    question: `q${i}`,
    answer: `a${i}`,
  }));
  const parsed = parseAskBody({ question: "ok", history });
  assert.ok(parsed.history.length <= 20, `kept ${parsed.history.length}`);
  assert.equal(parsed.history.at(-1).question, "q59");
});

test("a picked skill becomes one explicit instruction line", () => {
  const prompt = buildPrompt([], "Who knows payments?", { skill: "find-expert" });
  assert.equal(prompt, 'Use your "find-expert" skill to answer this: Who knows payments?');
});

test("the skill line survives into a follow-up with history", () => {
  const prompt = buildPrompt(
    [{ question: "q1", answer: "a1" }],
    "and now?",
    { skill: "recent-activity" },
  );
  assert.ok(prompt.includes('Use your "recent-activity" skill to answer this: and now?'), prompt);
});

test("parseAskBody accepts a well-formed skill slug and drops junk", () => {
  assert.equal(parseAskBody({ question: "q", skill: "find-expert" }).skill, "find-expert");
  assert.equal(parseAskBody({ question: "q", skill: "Not A Slug!" }).skill, null);
  assert.equal(parseAskBody({ question: "q" }).skill, null);
});
