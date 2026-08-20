#!/usr/bin/env node
// Run the eval set and report what passed, what failed, and why.
//
//   npm run eval                 # everything
//   npm run eval -- why-late     # one question, or several, by id
//   npm run eval -- --json       # machine-readable, for diffing two runs
//
// Fifteen questions at roughly a cent each — cheap enough to run before and
// after every change, which is what makes an eval set a test rather than a
// document.
//
// It drives the SDK, not the HTTP server: the gate, budget and rate limiter
// are not under test, and needing a running server would make this something
// you set up rather than something you run.
//
// One question at a time. GitHub allows 30 search requests a minute and
// answers a breach with a 403 that looks nothing like a rate limit, so a
// parallel runner produces failures that are the runner's fault.
import { query } from "@open-gitagent/gitagent";
import { openAuditLog } from "../app/server/audit.mjs";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSystemSuffix } from "../app/server/system-suffix.mjs";
import { loadEnvFile } from "../tools/scripts/_env.mjs";
import { verifyCitations } from "../app/server/verify-citations.mjs";
import { QUESTIONS } from "../evals/questions.mjs";

const REPO_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/**
 * The agent directory the eval runs against — a throwaway copy, not the repo.
 *
 * Pointed at the repo, `skill_learner crystallize` writes and commits SKILL.md
 * files into it — one run left nine skills and nine commits on `main`. Worse,
 * a skill crystallised on question 3 is in the prompt for question 10, so
 * every question changes the agent answering the rest. That is not a
 * measurement.
 *
 * The copy runs the identical agent with the learning loop fully on; whatever
 * it writes dies with the directory. node_modules is symlinked because the
 * tools resolve it by walking up from tools/scripts/, and .gitagent so the run
 * uses the same search index rather than rebuilding one.
 */
function isolatedAgentDir() {
  const dir = mkdtempSync(join(tmpdir(), "badger-eval-"));
  cpSync(REPO_DIR, dir, {
    recursive: true,
    dereference: false,
    filter: (src) => !/(\/node_modules|\/\.git|\/app\/web\/dist)$/.test(src),
  });
  for (const name of ["node_modules", ".gitagent"]) {
    try {
      symlinkSync(join(REPO_DIR, name), join(dir, name), "dir");
    } catch {}
  }
  return dir;
}

const AGENT_DIR = isolatedAgentDir();
loadEnvFile(`${REPO_DIR}/.env`);

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const only = new Set(argv.filter((a) => !a.startsWith("--")));
const set = only.size ? QUESTIONS.filter((q) => only.has(q.id)) : QUESTIONS;

if (!set.length) {
  console.error(`no questions matched. ids: ${QUESTIONS.map((q) => q.id).join(", ")}`);
  process.exit(2);
}

const say = (s) => !JSON_OUT && process.stdout.write(s);

/** One question, end to end. Never throws — a crash is a result, not an abort. */
async function ask(q) {
  const outputs = [];
  const tools = [];
  let answer = "";
  let crash = null;

  try {
    // Same three the server withholds. Without this the full builtin set is in
    // the model's schema — `cli` included, which spawns a shell with
    // `shell: true` and the whole of process.env (dist/tools/cli.js:20-25) —
    // and the only thing left is `hooks/allow-tools.sh`, which fails OPEN on a
    // crash, a timeout or any non-JSON output (dist/hooks.js:83-107). These two
    // run on a laptop against the real .env, so that is the wrong place to
    // depend on a hook. It also makes the eval measure the same tool surface
    // production serves.
    const result = query({
      prompt: q.question,
      dir: AGENT_DIR,
      systemPromptSuffix: buildSystemSuffix(),
      disallowedTools: ["cli", "write", "edit"],
    });
    // The audit trail the runtime keeps only on its CLI path — see audit.mjs.
    const audit = openAuditLog(AGENT_DIR);
    for await (const msg of result) {
      audit.record(msg);
      if (msg.type === "tool_use") tools.push(msg.toolName);
      else if (msg.type === "tool_result")
        outputs.push(typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));
      else if (msg.type === "assistant" && msg.content) answer = msg.content;
    }
    audit.end();
    const costs = typeof result.costs === "function" ? result.costs() : null;
    return { answer, outputs, tools, cost: costs?.totalCostUsd ?? 0, crash };
  } catch (err) {
    return { answer: "", outputs, tools, cost: 0, crash: err.message };
  }
}

/**
 * Grade one result.
 *
 * `mustCite` is checked against what was RETRIEVED, not against the answer:
 * finding the right material and describing it badly is a writing problem,
 * never finding it is a retrieval problem, and conflating them means tuning a
 * prompt to fix a search bug.
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

  // A separate axis: an answer can be correct and still cite something it
  // never opened. Counted as a failure.
  //
  // The shape is `{ ok, checked, findings }`. Reading a field that does not
  // exist here passes everything silently — a check that cannot fail is worse
  // than no check, because it reports confidence it never earned.
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

// What the run learned, reported and then thrown away with the copy. Skills
// crystallised during an eval are a fact about the run, not a change to the
// agent — printing them keeps the loop visible without letting it leak into
// the repository.
try {
  const learned = readdirSync(join(AGENT_DIR, "skills"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => /^learned_from:/m.test(readFileSync(join(AGENT_DIR, "skills", e.name, "SKILL.md"), "utf8")))
    .map((e) => e.name);
  if (learned.length) {
    console.log(`\nlearned during this run (discarded with the copy): ${learned.join(", ")}`);
  }
} catch {}
rmSync(AGENT_DIR, { recursive: true, force: true });

// Non-zero on any failure, so this can gate a deploy the way
// verify-citations.mjs already gates a demo.
process.exit(failed.length ? 1 : 0);
