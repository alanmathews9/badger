// The two rules that decide what a run reports, without a model or a network.
//
// Both were written after a production run where the agent searched Drive,
// Gmail and GitHub, read three sources, wrote the answer, and then showed the
// reader "My apologies, it seems I made a mistake in the task_id again" and
// nothing else. Neither rule needs the runtime to be exercised, which is the
// point: this is the part that fails silently.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLoggingCall, taskIdFrom } from "../app/server/run-agent.mjs";

test("the task id is read out of the begin result the runtime prints", () => {
  const begun =
    "Task started: 01a6a648-7720-420e-8802-adb87bd02d1c\nObjective: Find the HR policy\n\n⚡ SKILL MATCH FOUND";
  assert.equal(taskIdFrom(begun), "01a6a648-7720-420e-8802-adb87bd02d1c");
});

test("a result that announces no task yields no id, rather than a wrong one", () => {
  assert.equal(taskIdFrom("Task not found: 01a6a648-7720-420e-8802-adb87bd02d1c"), null);
  assert.equal(taskIdFrom(""), null);
  assert.equal(taskIdFrom(undefined), null);
});

test("begin is work; everything else on those two tools is paperwork", () => {
  // begin opens the task before any retrieval, so it must NOT close the
  // answer — a run whose first call was treated as logging would keep the
  // model's opening narration as its answer forever.
  assert.equal(isLoggingCall("task_tracker", { action: "begin" }), false);
  assert.equal(isLoggingCall("task_tracker", { action: "update" }), true);
  assert.equal(isLoggingCall("task_tracker", { action: "end" }), true);
  assert.equal(isLoggingCall("skill_learner", { action: "evaluate" }), true);
  assert.equal(isLoggingCall("drive_search", { query: "hr policy" }), false);
  assert.equal(isLoggingCall("task_tracker"), true);
});

// ── Which assistant message is the answer ────────────────────────────────
//
// Three runs, all real, all from one evening. The rule has to get all three
// right, and each one on its own suggests a different rule.
//
// `answerFrom` is the same two lines the stream loop runs, over a transcript
// of (assistant text | tool call) in the order the runtime emitted them.
function answerFrom(events) {
  let answer = "";
  let logging = false;
  for (const [kind, value, args] of events) {
    if (kind === "tool") {
      if (isLoggingCall(value, args)) logging = true;
      else answer = "";
    } else if (value && (!answer || !logging)) {
      answer = value;
    }
  }
  return answer;
}

test("narration the model kept working after is not the answer", () => {
  // "what is the HR policy": searched, read one document, wrote its account of
  // what Gmail returned, searched GitHub, then filed paperwork and stopped
  // without ever answering. Every later assistant message was empty, so the
  // narration was the last prose in the run and was shown as the answer.
  const run = [
    ["tool", "drive_search", {}],
    ["text", "The Gmail search returned a thread where Nadia Okonkwo asks…\n\nNext, I will search GitHub."],
    ["tool", "github_search", {}],
    ["text", ""],
    ["tool", "task_tracker", { action: "update" }],
    ["tool", "task_tracker", { action: "end" }],
    ["tool", "skill_learner", { action: "crystallize" }],
    ["text", ""],
  ];
  assert.equal(answerFrom(run), "");
});

test("an answer written before the paperwork survives the paperwork", () => {
  // "what is our hr policy": the answer was written, then the learning loop
  // failed four times on a mistyped id and the model's last words were an
  // apology for it. The apology replaced a complete answer.
  const run = [
    ["tool", "drive_search", {}],
    ["tool", "gmail_thread", {}],
    ["text", "The leave policy allows 25 days plus public holidays…"],
    ["tool", "task_tracker", { action: "end" }],
    ["tool", "task_tracker", { action: "end" }],
    ["tool", "skill_learner", { action: "evaluate" }],
    ["text", "My apologies, it seems I made a mistake in the task_id again."],
  ];
  assert.match(answerFrom(run), /^The leave policy allows 25 days/);
});

test("an answer written after the paperwork is still the answer", () => {
  // "what is the leave policy": the model logged first and answered last,
  // which is the other legal order and the one a rule keyed on "before the
  // paperwork" alone would throw away.
  const run = [
    ["tool", "drive_search", {}],
    ["tool", "drive_file", {}],
    ["tool", "task_tracker", { action: "end" }],
    ["tool", "skill_learner", { action: "crystallize" }],
    ["text", "The current leave policy, updated on 2026-01-08, allows 25 days…"],
  ];
  assert.match(answerFrom(run), /^The current leave policy/);
});
