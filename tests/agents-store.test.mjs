// Deterministic tests for the agents store — no keys, no network, temp dirs.
//
// The store writes real OpenGAP sub-agent folders into the agent's own tree,
// so what matters is not that the happy path returns a slug but that the
// files the runtime and the exporter read are the shape they expect: a script
// path that resolves back to the one shared implementation, a SOUL.md the
// Lyzr adapter's own regexes can still read, and a root manifest whose
// agents: block never names a folder that is not there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import {
  listAgents,
  readAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  listToolCatalog,
} from "../app/server/agents-store.mjs";

/**
 * A stand-in for the repo root: two tools, two skills, the three hook files
 * and a commented agent.yaml. The comments are load-bearing here — the root
 * manifest is mostly comments and a save must not reformat it.
 */
function scratchRoot() {
  const root = mkdtempSync(join(tmpdir(), "badger-agents-"));
  mkdirSync(join(root, "tools", "scripts"), { recursive: true });
  mkdirSync(join(root, "skills", "find-expert"), { recursive: true });
  mkdirSync(join(root, "skills", "trace-decision"), { recursive: true });
  mkdirSync(join(root, "hooks"), { recursive: true });
  mkdirSync(join(root, "agents"), { recursive: true });

  writeFileSync(
    join(root, "tools", "gmail-search.yaml"),
    "name: gmail_search\ndescription: Search the mailbox.\nimplementation:\n  # both spellings\n  type: script\n  path: scripts/gmail-search.mjs\n  script: scripts/gmail-search.mjs\n  runtime: node\n\nannotations:\n  read_only: true\n",
  );
  writeFileSync(
    join(root, "tools", "drive-file.yaml"),
    "name: drive_file\ndescription: Read one document.\nimplementation:\n  type: script\n  path: scripts/drive-file.mjs\n  script: scripts/drive-file.mjs\n  runtime: node\n",
  );
  writeFileSync(join(root, "tools", "scripts", "gmail-search.mjs"), 'console.log("gmail-search ran");\n');
  writeFileSync(join(root, "tools", "scripts", "drive-file.mjs"), 'console.log("drive-file ran");\n');

  writeFileSync(
    join(root, "skills", "find-expert", "SKILL.md"),
    "---\nname: find-expert\ndescription: Who knows about a topic.\n---\n\n1. search\n",
  );
  writeFileSync(
    join(root, "skills", "trace-decision", "SKILL.md"),
    "---\nname: trace-decision\ndescription: How a decision was made.\n---\n\n1. search\n",
  );

  writeFileSync(join(root, "hooks", "hooks.yaml"), "hooks:\n  pre_tool_use:\n    - script: allow-tools.sh\n");
  writeFileSync(join(root, "hooks", "allow-tools.sh"), "#!/bin/sh\necho '{\"action\":\"allow\"}'\n");
  writeFileSync(
    join(root, "hooks", "allowed-tools.txt"),
    "# Every tool Badger may call — one name per line.\n#\n# An allowlist rather than a blocklist because it fails closed.\nread\nmemory\ntask_tracker\nskill_learner\n\ngmail_search\ndrive_file\n",
  );

  writeFileSync(join(root, "RULES.md"), "# Rules\n\nRead only.\n");
  writeFileSync(join(root, "DUTIES.md"), "# Duties\n\nreader\n");
  writeFileSync(
    join(root, "agent.yaml"),
    'spec_version: "0.1.0"\nname: badger\nversion: 0.1.0\ndescription: Workplace search.\n\n# This comment must survive every create and delete.\nruntime:\n  max_turns: 40\n\ntags:\n  - workplace-search\n',
  );
  return root;
}

const spec = (over = {}) => ({
  slug: "hr-badger",
  role: "People and policy researcher",
  goal: "Answer questions about people, policy and process from Drive and mail",
  instructions: "Search Drive first. Open what looks relevant. Cite every source.",
  tools: ["gmail_search"],
  skills: ["find-expert"],
  memory: true,
  outputFormat: "text",
  ...over,
});

// ── The round trip ────────────────────────────────────────────────────────

test("create, read, update and delete round trip", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");

  assert.deepEqual(listAgents(agents), []);
  assert.deepEqual(createAgent(agents, spec(), { rootDir: root }), { slug: "hr-badger" });

  const made = readAgent(agents, "hr-badger");
  assert.equal(made.role, "People and policy researcher");
  assert.match(made.goal, /people, policy and process/);
  assert.match(made.instructions, /Search Drive first/);
  assert.deepEqual(made.tools, ["gmail_search"]);
  assert.deepEqual(made.skills, ["find-expert"]);
  assert.equal(made.memory, true);
  assert.equal(made.outputFormat, "text");
  assert.equal(made.origin, "custom");
  assert.match(made.rules, /Read only/);
  assert.equal(existsSync(join(agents, "hr-badger", "memory", "MEMORY.md")), true);
  assert.equal(existsSync(join(agents, "hr-badger", "DUTIES.md")), true);

  // The listing carries every field the pane's rows and the ask route read,
  // not a subset that sends the caller back for a second request.
  assert.deepEqual(listAgents(agents), [
    {
      slug: "hr-badger",
      name: "hr-badger",
      role: made.role,
      goal: made.goal,
      description: made.goal,
      origin: "custom",
      createdAt: made.createdAt,
      // No git history in the scratch tree, so this falls back to the
      // manifest's own stamp — which for an agent never committed is right.
      updatedAt: made.createdAt,
      color: "clay",
      tools: ["gmail_search"],
      skills: ["find-expert"],
      memory: true,
      outputFormat: "text",
    },
  ]);
  // The cards render this, so it has to be a real timestamp rather than the
  // empty string `describe` falls back to for a manifest without one.
  assert.match(made.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  updateAgent(agents, "hr-badger", spec({ tools: ["drive_file"], skills: [], memory: false, outputFormat: "json" }), { rootDir: root });
  const edited = readAgent(agents, "hr-badger");
  assert.deepEqual(edited.tools, ["drive_file"]);
  assert.deepEqual(edited.skills, []);
  assert.equal(edited.outputFormat, "json");
  assert.equal(edited.memory, false);
  // Deselecting a tool removes its YAML: the directory is the tool list, so a
  // leftover file is a tool the agent still has.
  assert.equal(existsSync(join(agents, "hr-badger", "tools", "gmail-search.yaml")), false);
  // The skills: key goes away entirely rather than becoming an empty list.
  assert.equal(/^skills:/m.test(readFileSync(join(agents, "hr-badger", "agent.yaml"), "utf8")), false);

  assert.deepEqual(deleteAgent(agents, "hr-badger", { rootDir: root }), { slug: "hr-badger" });
  assert.deepEqual(listAgents(agents), []);
  assert.throws(() => readAgent(agents, "hr-badger"), /no such agent/);
  assert.throws(() => updateAgent(agents, "hr-badger", spec(), { rootDir: root }), /no such agent/);
  assert.throws(() => deleteAgent(agents, "hr-badger", { rootDir: root }), /no such agent/);
});

test("a rename moves the folder, keeping what the agent wrote itself", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  const manifest = () => readFileSync(join(root, "agent.yaml"), "utf8");

  createAgent(agents, spec(), { rootDir: root });
  // Something only the agent could have written, to prove the whole directory
  // travels rather than being rebuilt from the form's fields.
  writeFileSync(join(agents, "hr-badger", "memory", "MEMORY.md"), "# Memory\n\nLearned a thing.\n");

  const result = updateAgent(agents, "hr-badger", spec({ slug: "people-badger" }), { rootDir: root });
  assert.equal(result.slug, "people-badger");
  assert.equal(result.renamedFrom, "hr-badger");

  assert.equal(existsSync(join(agents, "hr-badger")), false);
  assert.match(
    readFileSync(join(agents, "people-badger", "memory", "MEMORY.md"), "utf8"),
    /Learned a thing/,
  );
  assert.equal(readAgent(agents, "people-badger").slug, "people-badger");

  // Listed once, under the new name only. Both would be a manifest claiming a
  // sub-agent whose folder is gone, which is a validation error.
  assert.match(manifest(), /^ {2}people-badger:$/m);
  assert.equal(/^ {2}hr-badger:$/m.test(manifest()), false);
});

test("a rename onto a name already taken is refused, and changes nothing", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  createAgent(agents, spec(), { rootDir: root });
  createAgent(agents, spec({ slug: "eng-badger" }), { rootDir: root });

  assert.throws(
    () => updateAgent(agents, "hr-badger", spec({ slug: "eng-badger" }), { rootDir: root }),
    /already exists/,
  );
  assert.equal(existsSync(join(agents, "hr-badger")), true);
  assert.equal(readAgent(agents, "eng-badger").slug, "eng-badger");
});

test("the mark's colour survives a round trip and a junk one is refused", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  createAgent(agents, spec({ color: "teal" }), { rootDir: root });
  assert.equal(readAgent(agents, "hr-badger").color, "teal");

  updateAgent(agents, "hr-badger", spec({ color: "violet" }), { rootDir: root });
  assert.equal(readAgent(agents, "hr-badger").color, "violet");

  assert.throws(
    () => updateAgent(agents, "hr-badger", spec({ color: "<img onerror=x>" }), { rootDir: root }),
    /colour/,
  );
});

test("two agents cannot claim the same name", () => {
  const root = scratchRoot();
  createAgent(join(root, "agents"), spec(), { rootDir: root });
  assert.throws(() => createAgent(join(root, "agents"), spec(), { rootDir: root }), /already exists/);
});

// ── Refusals ──────────────────────────────────────────────────────────────

test("a slug can never escape the agents directory", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  for (const bad of ["../secrets", "..", "a/b", "a\\b", ".hidden", "UPPER", ""]) {
    assert.throws(() => readAgent(agents, bad), /not a valid agent name/, `allowed: ${bad}`);
    assert.throws(() => deleteAgent(agents, bad, { rootDir: root }), /not a valid agent name/, `allowed: ${bad}`);
    // Create validates the slug before it is ever joined onto a path, so the
    // message is the pane's one rather than the path guard's.
    assert.throws(() => createAgent(agents, spec({ slug: bad }), { rootDir: root }), /lower-case words|not a valid agent name/);
  }
  assert.equal(existsSync(join(root, "secrets")), false);
});

test("an unknown tool or skill is refused by name", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  assert.throws(() => createAgent(agents, spec({ tools: ["github_search"] }), { rootDir: root }), /no tool named "github_search"/);
  assert.throws(() => createAgent(agents, spec({ skills: ["onboard-to-project"] }), { rootDir: root }), /no skill named "onboard-to-project"/);
  // A skill slug is checked against the regex too — it is joined onto a path.
  assert.throws(() => createAgent(agents, spec({ skills: ["../../etc"] }), { rootDir: root }), /no skill named/);
  assert.equal(listAgents(agents).length, 0, "nothing is written when validation fails");
});

test("the fields a person types are bounded, with messages written for them", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  assert.throws(() => createAgent(agents, spec({ role: "  " }), { rootDir: root }), /give the agent a role/);
  assert.throws(() => createAgent(agents, spec({ goal: "" }), { rootDir: root }), /give the agent a goal/);
  assert.throws(() => createAgent(agents, spec({ role: "x".repeat(201) }), { rootDir: root }), /role is too long/);
  assert.throws(() => createAgent(agents, spec({ goal: "x".repeat(201) }), { rootDir: root }), /goal is too long/);
  assert.throws(() => createAgent(agents, spec({ instructions: "x".repeat(20001) }), { rootDir: root }), /too long/);
  assert.throws(() => createAgent(agents, spec({ outputFormat: "yaml" }), { rootDir: root }), /output format/);
});

// ── What must survive a save ──────────────────────────────────────────────

test("an edit does not change where an agent came from", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  createAgent(agents, spec(), { rootDir: root });
  const created = readFileSync(join(agents, "hr-badger", "agent.yaml"), "utf8").match(/created_at: (\S+)/)[1];

  updateAgent(agents, "hr-badger", spec({ role: "Something else" }), { rootDir: root });
  const after = readFileSync(join(agents, "hr-badger", "agent.yaml"), "utf8");
  assert.equal(readAgent(agents, "hr-badger").origin, "custom");
  assert.match(after, /added_via: badger-ui/);
  assert.match(after, new RegExp(`created_at: ${created}`), "the creation time is not restamped");
});

test("a hand-written agent reads as built in, and keeps its keys through an edit", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  mkdirSync(join(agents, "eng-badger"));
  writeFileSync(
    join(agents, "eng-badger", "agent.yaml"),
    'spec_version: "0.1.0"\nname: eng-badger\nversion: 0.1.0\ndescription: Seeded.\nauthor: alan-mathews\ntags:\n  - seeded\n',
  );
  writeFileSync(
    join(agents, "eng-badger", "SOUL.md"),
    "# Engineer\n\n## Core Identity\n\nEngineering researcher\n\n## Goal\n\nTrace decisions\n\n## Instructions\n\nStart in issues.\n",
  );
  assert.equal(readAgent(agents, "eng-badger").origin, "handwritten");

  updateAgent(agents, "eng-badger", spec({ slug: "eng-badger" }), { rootDir: root });
  const after = readFileSync(join(agents, "eng-badger", "agent.yaml"), "utf8");
  assert.match(after, /author: alan-mathews/, "a key the pane has no box for survives");
  assert.match(after, /- seeded/);
  assert.equal(readAgent(agents, "eng-badger").origin, "handwritten", "an edit does not make it UI-added");
});

// ── The shapes other software reads ───────────────────────────────────────

test("SOUL.md round trips through the Lyzr exporter's own regexes", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  createAgent(agents, spec(), { rootDir: root });
  const soul = readFileSync(join(agents, "hr-badger", "SOUL.md"), "utf8");

  // Copied verbatim from node_modules/@open-gitagent/opengap/dist/adapters/
  // lyzr.js:90-91. A SOUL.md these do not match exports as the description
  // twice, silently — which is why the headings are generated, not typed.
  //
  // The goal expression is also wrong upstream: `\s*.*?\n+` swallows the first
  // line under the heading, so a goal written directly beneath it exports as
  // "## Instructions". This case is what pins the lead-in line renderSoul
  // writes to absorb that.
  const roleMatch = soul.match(/##\s*Core\s*Identity\s*\n+([\s\S]*?)(?=\n##|\n$|$)/i);
  const goalMatch = soul.match(/##\s*(?:Values|Purpose|Goal|Mission)\s*.*?\n+([\s\S]*?)(?=\n##|\n$|$)/i);
  assert.ok(roleMatch, "Core Identity is unreadable to the exporter");
  assert.ok(goalMatch, "Goal is unreadable to the exporter");
  assert.equal(roleMatch[1].trim().split("\n")[0].replace(/^[-*]\s*/, ""), spec().role);
  assert.equal(goalMatch[1].trim().split("\n")[0].replace(/^[-*]\s*/, ""), spec().goal);

  // And back out through the store, which is what the pane shows.
  const back = readAgent(agents, "hr-badger");
  assert.equal(back.role, spec().role);
  assert.equal(back.goal, spec().goal);
  assert.equal(back.instructions, spec().instructions);
});

test("a SOUL.md missing its sections reads as empty, never throws", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  createAgent(agents, spec(), { rootDir: root });
  writeFileSync(join(agents, "hr-badger", "SOUL.md"), "# Just a heading\n");
  const back = readAgent(agents, "hr-badger");
  assert.equal(back.role, "");
  assert.equal(back.instructions, "");
  assert.equal(back.goal, "Answer questions about people, policy and process from Drive and mail", "falls back to the manifest description");
});

test("a copied tool YAML points back at the one shared implementation, and it runs", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  createAgent(agents, spec({ tools: ["gmail_search", "drive_file"] }), { rootDir: root });

  const toolsDir = join(agents, "hr-badger", "tools");
  const copied = readFileSync(join(toolsDir, "gmail-search.yaml"), "utf8");
  // Three .. segments: the runtime resolves a script as
  // join(agentDir, "tools", script) (dist/tool-loader.js), and agentDir is
  // agents/<slug>. Asserted as a value here, computed in the store.
  assert.match(copied, /^\s+path: \.\.\/\.\.\/\.\.\/tools\/scripts\/gmail-search\.mjs$/m);
  assert.match(copied, /^\s+script: \.\.\/\.\.\/\.\.\/tools\/scripts\/gmail-search\.mjs$/m);
  assert.match(copied, /# both spellings/, "the file is copied, not regenerated");

  // The path is not merely plausible: resolve it the way the runtime does and
  // run what is there.
  const script = copied.match(/^\s+script: (\S+)$/m)[1];
  const resolved = resolve(toolsDir, script);
  assert.equal(resolved, join(root, "tools", "scripts", "gmail-search.mjs"));
  assert.match(execFileSync(process.execPath, [resolved], { encoding: "utf8" }), /gmail-search ran/);

  // The scripts themselves are never copied. One implementation, many agents.
  assert.equal(existsSync(join(toolsDir, "scripts")), false);
});

test("a copied skill says where it started", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  createAgent(agents, spec({ skills: ["find-expert", "trace-decision"] }), { rootDir: root });
  const copied = readFileSync(join(agents, "hr-badger", "skills", "find-expert", "SKILL.md"), "utf8");
  assert.match(copied, /copied_from: badger/);
  assert.match(copied, /name: find-expert/);

  // The manifest must NOT carry a `skills:` list, and this assertion used to
  // say the opposite. loader.js:194 treats that key as a hard filter over
  // discoverSkills(), so listing the selection there permanently hides
  // anything the agent later crystallises for itself. The directory is the
  // selection; see `write` in agents-store.
  assert.equal(
    /^skills:/m.test(readFileSync(join(agents, "hr-badger", "agent.yaml"), "utf8")),
    false,
    "a skills filter in the manifest would hide what the agent learns",
  );
});

test("a skill the agent learned for itself survives an unrelated save", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  createAgent(agents, spec({ skills: ["find-expert", "trace-decision"] }), { rootDir: root });

  // What skill_learner crystallize writes: a folder in the agent's own
  // skills/, marked `learned_from` and carrying no `copied_from`.
  const learned = join(agents, "hr-badger", "skills", "draft-refund-reply");
  mkdirSync(learned, { recursive: true });
  writeFileSync(
    join(learned, "SKILL.md"),
    "---\nname: draft-refund-reply\ndescription: Draft a refund reply.\nlearned_from: task:abc\n---\n\n# Draft\n",
  );

  // Deselect one of the copied skills and save, the way editing any field does.
  updateAgent(agents, "hr-badger", spec({ skills: ["find-expert"] }), { rootDir: root });

  assert.equal(existsSync(learned), true, "pruning must not reach what the agent wrote itself");
  assert.equal(existsSync(join(agents, "hr-badger", "skills", "trace-decision")), false);
  assert.equal(existsSync(join(agents, "hr-badger", "skills", "find-expert")), true);

  // And it is listed, so the pane shows what the agent taught itself.
  assert.deepEqual(readAgent(agents, "hr-badger").skills.sort(), [
    "draft-refund-reply",
    "find-expert",
  ]);
});

test("the generated allowed-tools.txt keeps the header and names only this agent's tools", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  createAgent(agents, spec({ tools: ["gmail_search"] }), { rootDir: root });
  const allowed = readFileSync(join(agents, "hr-badger", "hooks", "allowed-tools.txt"), "utf8");
  assert.match(allowed, /^# Every tool Badger may call/);
  assert.match(allowed, /^skill_learner$/m, "the learning loop is still permitted");
  assert.match(allowed, /^gmail_search$/m);
  assert.equal(/^drive_file$/m.test(allowed), false, "a tool this agent does not have is not listed");
  assert.equal(/^cli$/m.test(allowed), false);
  assert.equal(existsSync(join(agents, "hr-badger", "hooks", "allow-tools.sh")), true);
});

// ── The root manifest ─────────────────────────────────────────────────────
//
// `opengap validate` fails the build when the agents: block names a folder
// that is not there (dist/commands/validate.js:60), so create and delete both
// have to move it. The file is mostly comments and must come back unreformatted.

test("create and delete keep the root agents: block in sync", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  const manifest = () => readFileSync(join(root, "agent.yaml"), "utf8");

  createAgent(agents, spec(), { rootDir: root });
  assert.match(manifest(), /^agents:\n {2}hr-badger:\n {4}description: "/m);
  assert.match(manifest(), /# This comment must survive every create and delete\./);
  assert.match(manifest(), /^tags:$/m);

  createAgent(agents, spec({ slug: "eng-badger" }), { rootDir: root });
  assert.match(manifest(), /^ {2}hr-badger:$/m);
  assert.match(manifest(), /^ {2}eng-badger:$/m);

  deleteAgent(agents, "hr-badger", { rootDir: root });
  assert.equal(/^ {2}hr-badger:$/m.test(manifest()), false);
  assert.match(manifest(), /^ {2}eng-badger:$/m);

  // The last one out takes the block with it: `agents:` with nothing under it
  // is null, and the schema wants an object.
  deleteAgent(agents, "eng-badger", { rootDir: root });
  assert.equal(/^agents:/m.test(manifest()), false);
  assert.match(manifest(), /# This comment must survive every create and delete\./);
});

test("repeated create and delete leaves the root manifest byte for byte", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  const file = join(root, "agent.yaml");
  const before = readFileSync(file, "utf8");

  // Three times, because the first version of this ate one blank line per
  // cycle: the blank line after the block fell inside the replaced range and
  // was filtered out with the empty entries. One round trip looked clean and
  // the manifest lost its spacing over a week of use.
  for (let i = 0; i < 3; i++) {
    createAgent(agents, spec(), { rootDir: root });
    deleteAgent(agents, "hr-badger", { rootDir: root });
  }

  assert.equal(readFileSync(file, "utf8"), before);
});

test("an agent whose folder has no manifest is skipped, not fatal", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  mkdirSync(join(agents, "half-written"));
  createAgent(agents, spec(), { rootDir: root });
  assert.deepEqual(listAgents(agents).map((a) => a.slug), ["hr-badger"]);
});

test("the tool catalog is the root tools directory, by name", () => {
  const root = scratchRoot();
  const catalog = listToolCatalog(join(root, "tools"));
  assert.deepEqual(catalog.map((t) => t.name).sort(), ["drive_file", "gmail_search"]);
  assert.equal(catalog.find((t) => t.name === "gmail_search").file, "gmail-search.yaml");
  assert.match(catalog.find((t) => t.name === "gmail_search").description, /Search the mailbox/);
  assert.deepEqual(listToolCatalog(join(root, "nowhere")), []);
});

test("a manifest that arrived with two agents: blocks is repaired by the next save", () => {
  // The failure this fixes: a sub-agent created on a clone whose branch did
  // not yet carry main's own block wrote a second block further down the file,
  // git merged both without a conflict because the edits are 150 lines apart,
  // and YAML refuses a duplicated key. The agent then failed to load at all —
  // every question came back in half a second with no steps and no answer.
  const root = scratchRoot();
  const agents = join(root, "agents");
  const file = join(root, "agent.yaml");
  const before = readFileSync(file, "utf8");
  writeFileSync(
    file,
    `agents:\n  eng-badger:\n    description: "From GitHub."\n\n${before}agents:\n  hr-badger:\n    description: "Policy."\n`,
  );
  assert.throws(() => yaml.load(readFileSync(file, "utf8")), /duplicated mapping key/);

  createAgent(agents, spec({ slug: "support-badger", goal: "Support." }), { rootDir: root });

  const text = readFileSync(file, "utf8");
  assert.equal(text.split("\n").filter((line) => line === "agents:").length, 1);
  assert.deepEqual(Object.keys(yaml.load(text).agents), ["eng-badger", "hr-badger", "support-badger"]);
});

test("a manifest edit that would not parse is refused rather than written", () => {
  const root = scratchRoot();
  const agents = join(root, "agents");
  const file = join(root, "agent.yaml");
  // A goal is JSON.stringify'd into the entry, so no ordinary field can break
  // the file. What can is a manifest that is already broken somewhere else —
  // this asserts the guard fires on the RESULT rather than on the input.
  writeFileSync(file, `${readFileSync(file, "utf8")}\nname: twice\nname: twice\n`);
  assert.throws(
    () => createAgent(agents, spec(), { rootDir: root }),
    /no longer parses/,
  );
  assert.match(readFileSync(file, "utf8"), /name: twice\nname: twice/);
});
