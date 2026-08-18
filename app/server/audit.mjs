// The audit trail agent.yaml promises, on the paths that actually run.
//
// agent.yaml declares compliance.recordkeeping.audit_logging: true, and the
// runtime does implement it — but only in its CLI entry point. sdk.js never
// touches dist/audit.js, so every SDK run (this server, badger-sdk.mjs,
// eval.mjs) left no trace while the manifest claimed one. Measured
// 2026-08-18: .gitagent/audit.jsonl was last written by an Aug 17 CLI run
// and stayed silent through a full eval sweep the day after.
//
// Same file, same JSONL shape as the runtime's AuditLogger, so CLI and SDK
// runs interleave into one log. Reimplemented rather than imported because
// the package does not export the class.
//
// In production each entry also goes to stdout: Cloud Run's filesystem dies
// with the instance, and it is Cloud Logging's default 30-day retention that
// makes the declared retention_days: 30 true there.

import { appendFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export function openAuditLog(agentDir) {
  const dir = join(agentDir, ".gitagent");
  const path = join(dir, "audit.jsonl");
  const sessionId = randomUUID();
  const toStdout = process.env.NODE_ENV === "production";

  // Writes are synchronous, deliberately. The first version chained async
  // appends and a real run proved the point: the process printed its answer
  // and exited with the final response and session_end still queued, so the
  // log ended mid-session. A dozen sub-kilobyte writes per answer cost
  // nothing next to the seconds of API calls around them, and a sync write
  // cannot be dropped at exit. Failures are still non-fatal, exactly as in
  // the runtime: an unwritable audit log must never take an answer down.
  try {
    mkdirSync(dir, { recursive: true });
  } catch {}
  const write = (event, data = {}) => {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      event,
      ...data,
    });
    if (toStdout) console.log(line);
    try {
      appendFileSync(path, line + "\n", "utf8");
    } catch {}
  };

  write("session_start");
  return {
    /** Feed every message from a query() stream through this. */
    record(msg) {
      if (msg.type === "tool_use") {
        write("tool_use", { tool: msg.toolName, args: msg.args ?? {} });
      } else if (msg.type === "tool_result") {
        const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        // The runtime truncates results to 1000 characters; matched here both
        // for shape and because a log holding full bodies would be an index by
        // the back door, which RULES.md forbids memory to become.
        write("tool_result", { tool: msg.toolName, result: String(text ?? "").slice(0, 1000) });
      } else if (msg.type === "assistant") {
        write("response");
      }
    },
    end() {
      write("session_end");
    },
  };
}
