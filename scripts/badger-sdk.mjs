#!/usr/bin/env node
// Run Badger through the gitagent SDK instead of the CLI, and verify its
// citations before trusting the answer.
//
// This exists for two reasons beyond testing:
//
//   1. Citation verification is impossible in a hook. gitagent's post_response
//      fires without await, discards its result, and never receives the
//      response text. The only place with both the tool outputs and the final
//      answer is the SDK caller — here.
//   2. The SDK path carries enforcement the CLI path cannot: allowedTools and
//      disallowedTools are applied in-process, so unlike hooks/allow-read-only.sh
//      they cannot fail open if a shell script crashes.
//
// This is the seed of the product backend. The web UI will do exactly this,
// then render the answer plus its verification badge.
//
//   node scripts/badger-sdk.mjs "what did we decide about Halden phase 2?"
import { readFileSync } from "node:fs";
import { query } from "@open-gitagent/gitagent";
import { verifyCitations, formatVerification, annotateUnverified } from "../src/verify-citations.mjs";

const AGENT_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

for (const line of readFileSync(`${AGENT_DIR}/.env`, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
}

const prompt = process.argv.slice(2).join(" ");
if (!prompt) {
  console.error('usage: node scripts/badger-sdk.mjs "<question>"');
  process.exit(1);
}

// The same allowlist hooks/allowed-tools.txt enforces, applied in-process.
// Badger's own tools plus read; no cli, write, edit, task_tracker or
// skill_learner, which the runtime would otherwise load.
const ALLOWED = [
  "github_search",
  "github_issue",
  "github_pr",
  "github_file",
  "github_commits",
  "read",
  "memory",
];

const toolOutputs = [];
let answer = "";
const toolCalls = [];

const result = query({ prompt, dir: AGENT_DIR, allowedTools: ALLOWED });

for await (const msg of result) {
  switch (msg.type) {
    case "tool_use":
      toolCalls.push(msg.toolName);
      process.stderr.write(`  ▶ ${msg.toolName}\n`);
      break;
    case "tool_result":
      // Everything Badger actually retrieved. This is the corpus a citation
      // must appear in to count as verified.
      toolOutputs.push(typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));
      break;
    case "assistant":
      if (msg.content) answer = msg.content;
      break;
    case "system":
      if (msg.subtype === "error") process.stderr.write(`  ! ${msg.content}\n`);
      break;
  }
}

const verification = verifyCitations(answer, toolOutputs);

// Show the answer with bad citations marked, rather than withholding it. An
// answer is usually mostly right; the reader needs to know which claim to
// distrust, not that something somewhere is wrong.
console.log("\n" + annotateUnverified(answer, verification).trim() + "\n");
console.log("─".repeat(60));
console.log(`tools called: ${toolCalls.length ? toolCalls.join(", ") : "none"}`);
console.log(formatVerification(verification));

const costs = typeof result.costs === "function" ? result.costs() : null;
if (costs) {
  console.log(
    `cost: $${(costs.totalCostUsd ?? 0).toFixed(4)} — ` +
      `${costs.totalInputTokens ?? 0} in / ${costs.totalOutputTokens ?? 0} out`,
  );
}

// Non-zero exit on an unverified citation, so this can gate a demo or CI.
process.exit(verification.ok ? 0 : 1);
