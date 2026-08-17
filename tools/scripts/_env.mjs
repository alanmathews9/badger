// Load .env if there is one, and shrug if there is not.
//
// On a laptop the agent's credentials live in <agent-dir>/.env. In a container
// there is no such file — configuration arrives as real environment variables,
// from Secret Manager. The previous code called readFileSync unguarded, so a
// deployed Badger would have crashed on boot with ENOENT before serving a
// single request.
//
// Real environment variables always win: values are only filled in where
// nothing is set already, so `docker run -e COMPOSIO_API_KEY=...` overrides a
// stale file, and Secret Manager overrides everything.
import { readFileSync } from "node:fs";

/**
 * @param {string | URL} path  the .env to read, if it exists
 * @returns {boolean} whether a file was actually loaded
 */
export function loadEnvFile(path) {
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch (err) {
    // ENOENT is the normal container case. Anything else — a permissions
    // problem, a directory where a file should be — is worth knowing about,
    // because it looks identical from the outside: nothing gets loaded.
    if (err?.code !== "ENOENT") {
      console.warn(`[env] could not read ${path}: ${err.message}`);
    }
    return false;
  }

  for (const line of contents.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    process.env[match[1]] ??= match[2].trim().replace(/^["']|["']$/g, "");
  }
  return true;
}
