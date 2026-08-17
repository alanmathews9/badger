// The agent's tool allowlist, read from the file that already enforces it.
//
// `hooks/allowed-tools.txt` is the source of truth: the shell hook gates every
// tool call against it, and both callers that use the SDK pass the same list as
// `allowedTools`, which removes everything else from the model's schema.
//
// This module exists because that list used to be a hardcoded array in two
// places. Adding Gmail and Drive to the hook file would have left both arrays
// at five GitHub tools, and the failure would have been quiet and plausible:
// Badger would have reported, truthfully, that it could not search mail.
//
// Only agent-facing names are taken. The same file documents the underlying
// Composio slugs in UPPER_SNAKE and the historical MCP names as `github__*`,
// and neither is a name the runtime knows.
import { readFileSync } from "node:fs";

const ALLOWLIST_PATH = new URL("../../hooks/allowed-tools.txt", import.meta.url);

/** @returns {string[]} agent-facing tool names, in file order. */
export function readAllowedTools(path = ALLOWLIST_PATH) {
  const names = readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[a-z][a-z0-9_]*$/.test(line) && !line.includes("__"));

  // A parse that silently returns a handful of names would disable most of
  // Badger while looking like it worked. Fail loudly instead: this is the one
  // failure mode the refactor was meant to remove.
  if (names.length < 6) {
    throw new Error(
      `hooks/allowed-tools.txt parsed to only ${names.length} tool names — refusing to run with a truncated allowlist`,
    );
  }
  return names;
}
