#!/usr/bin/env node
// Run the eval set and report what passed, what failed, and why.
//
//   npm run eval                 # everything
//   npm run eval -- why-late     # one question, or several, by id
//   npm run eval -- --json       # machine-readable, for diffing two runs
//
// **What a run costs.** Fifteen questions at roughly a cent each. Cheap enough
// to run before and after every change, which is the only property that makes
// an eval set worth having — one that is too expensive to re-run becomes a
// document rather than a test.
//
// **Why it drives the SDK and not the HTTP server.** The server adds a gate, a
// budget and a rate limiter, none of which is under test, and requiring a
// running server to measure retrieval would make the eval set something you
// have to set up rather than something you run. This is the same path
// `scripts/badger-sdk.mjs` uses, with the same allowlist.
//
// Questions run one at a time on purpose. GitHub's search API allows 30
// requests a minute and answers a breach with a 403 that looks nothing like a
// rate limit, and a parallel runner would produce failures that are entirely
// the runner's fault.
import { query } from "@open-gitagent/gitagent";
import { readAllowedTools } from "../app/server/allowed-tools.mjs";
import { loadEnvFile } from "../tools/scripts/_env.mjs";
import { verifyCitations } from "../app/server/verify-citations.mjs";
import { QUESTIONS } from "../evals/questions.mjs";

const AGENT_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
loadEnvFile(`${AGENT_DIR}/.env`);

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const only = new Set(argv.filter((a) => !a.startsWith("--")));
const set = only.size ? QUESTIONS.filter((q) => only.has(q.id)) : QUESTIONS;

if (!set.length) {
  console.error(`no questions matched. ids: ${QUESTIONS.map((q) => q.id).join(", ")}`);
  process.exit(2);
}

const ALLOWED = readAllowedTools();
const say = (s) => !JSON_OUT && process.stdout.write(s);

/** One question, end to end. Never throws — a crash is a result, not an abort. */
async function ask(q) {
  const outputs = [];
  const tools = [];
  let answer = "";
  let crash = null;

  try {
    const result = query({ prompt: q.question, dir: AGENT_DIR, allowedTools: ALLOWED });
    for await (const msg of result) {
      if (msg.type === "tool_use") tools.push(msg.toolName);
      else if (msg.type === "tool_result")
        outputs.push(typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));
      else if (msg.type === "assistant" && msg.content) answer = msg.content;
    }
    const costs = typeof result.costs === "function" ? result.costs() : null;
    return { answer, outputs, tools, cost: costs?.totalCostUsd ?? 0, crash };
  } catch (err) {
    return { answer: "", outputs, tools, cost: 0, crash: err.message };
  }
}

/**
 * Grade one result.
 *
 * `mustCite` is checked against what was **retrieved**, not against the answer.
 * That is the distinction the whole set is built on: an agent that found the
 * right material and described it badly has a writing problem, and one that
 * never found it has a retrieval problem. Conflating them is how you spend a
 * day tuning a prompt to fix a search bug.
 */
function grade(q, r) {
  const retrieved = r.outputs.join("\n");
  const failures = [];

  if (r.crash) failures.push(`crashed: ${r.crash}`);
  if (!r.answer.trim()) failures.push("no answer produced");

  for (const needle of q.mustCite ?? []) {
    if (!retrieved.toLowerCase().includes(String(needle).toLowerCase())) {
      failures.push(`never retrieved: ${needle}`);
    }
  }
  if (q.mustCiteAny?.length) {
    const hit = q.mustCiteAny.some((n) => retrieved.toLowerCase().includes(String(n).toLowerCase()));
    if (!hit) failures.push(`retrieved none of: ${q.mustCiteAny.join(" | ")}`);
  }
  for (const re of q.mustSay ?? []) {
    if (!re.test(r.answer)) failures.push(`answer missing: ${re}`);
  }
  for (const re of q.mustNotSay ?? []) {
    if (re.test(r.answer)) failures.push(`answer contains what it should not: ${re}`);
  }

  // Citation verification is a separate axis: an answer can be correct and
  // still cite something it never opened, which is the failure mode that
  // destroys trust fastest. Reported, and counted as a failure.
  //
  // The shape is `{ ok, checked, findings }` — `checked` is how many citations
  // were examined and `findings` are the ones that could not be traced back to
  // a tool result. The first version of this read `verification.citations`,
  // which does not exist, so the check passed everything and printed "0
  // citations" on every question. An eval set containing a check that cannot
  // fail is worse than one without it: it reports confidence it never earned.
  const verification = verifyCitations(r.answer, r.outputs);
  if (verification.findings.length) {
    failures.push(`${verification.findings.length} unverified citation(s): ` +
      verification.findings.map((f) => f.citation ?? f.text ?? JSON.stringify(f)).join("; ").slice(0, 160));
  }

  return { failures, verified: verification.checked - verification.findings.length };
}

// ------------------------------------------------------------------- run

const results = [];
let spend = 0;

say(`running ${set.length} question(s)\n\n`);

for (const q of set) {
  say(`  ${q.id.padEnd(20)} `);
  const r = await ask(q);
  const g = grade(q, r);
  spend += r.cost;
  results.push({ id: q.id, question: q.question, why: q.why, ...g, cost: r.cost, tools: r.tools, answer: r.answer });
  say(g.failures.length ? `FAIL  ${g.failures.length} problem(s)\n` : `pass  (${g.verified} citations)\n`);
}

const failed = results.filter((r) => r.failures.length);

if (JSON_OUT) {
  console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, spend, results }, null, 2));
} else {
  console.log(`\n${"─".repeat(64)}`);
  console.log(`${results.length - failed.length}/${results.length} passed — $${spend.toFixed(4)}\n`);
  for (const r of failed) {
    console.log(`✗ ${r.id} — ${r.question}`);
    console.log(`  why it is in the set: ${r.why}`);
    for (const f of r.failures) console.log(`  · ${f}`);
    console.log(`  tools: ${r.tools.join(", ") || "none"}`);
    console.log(`  answer: ${r.answer.replace(/\s+/g, " ").slice(0, 220)}\n`);
  }
}

// Non-zero on any failure, so this can gate a deploy the way
// verify-citations.mjs already gates a demo.
process.exit(failed.length ? 1 : 0);
