#!/usr/bin/env node
// Print the input schema for one or more Composio tool slugs.
//   node scripts/composio-schema.mjs GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS ...
import { loadEnvFile } from "../tools/scripts/_env.mjs";

loadEnvFile(new URL("../.env", import.meta.url));
const key = process.env.COMPOSIO_API_KEY;

for (const slug of process.argv.slice(2)) {
  const res = await fetch(`https://backend.composio.dev/api/v3/tools/${slug}`, {
    headers: { "x-api-key": key },
  });
  if (!res.ok) {
    console.log(`${slug}: HTTP ${res.status}`);
    continue;
  }
  const t = await res.json();
  const props = t.input_parameters?.properties ?? {};
  const req = t.input_parameters?.required ?? [];
  console.log(`\n=== ${slug}`);
  for (const [k, v] of Object.entries(props)) {
    const mark = req.includes(k) ? "*" : " ";
    console.log(` ${mark}${k} (${v.type ?? "?"}) ${(v.description ?? "").slice(0, 90)}`);
  }
}
