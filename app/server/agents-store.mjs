// The web UI's view onto the agent's agents/ directory — Badger's sub-agents.
//
// Each one is a real OpenGAP sub-agent folder (spec §13, directory form): its
// own agent.yaml, SOUL.md, RULES.md, DUTIES.md, tools/, skills/, hooks/ and
// optionally memory/. The runtime loads whatever directory it is handed, so a
// sub-agent written here runs by passing `dir: agents/<slug>` and nothing else.
//
// Unlike skills, this is a field-based editor: a sub-agent is a directory of
// generated files rather than one artefact a person hand writes. The lesson
// from skills-store still holds — anything the form does not own has to
// survive a save, so `metadata.added_via`, `metadata.created_at` and every
// unknown key in agent.yaml are carried through an edit.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import yaml from "js-yaml";
import { lastCommitDates } from "./git-dates.mjs";

/** A slug that is safe to join onto a path. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A colour name. Never joined onto a path; checked so it cannot carry markup. */
const COLOR = /^[a-z][a-z0-9-]{0,31}$/;

/** Runtime builtins, so the generated allowed-tools.txt can keep the ones the root list permits. */
const BUILTINS = ["read", "memory", "task_tracker", "skill_learner", "write", "edit", "cli", "capture_photo"];

const MODEL = "google-vertex:gemini-2.5-flash";

/**
 * The directory for a slug, or a thrown error.
 *
 * The regex is the whole path-traversal defence: no dot, no slash, no
 * backslash, so "../../etc" fails before `join` is reached. Here rather than
 * at the route, so a second caller cannot forget — and exported so that
 * schedules-store, which joins the same slug onto the same tree, shares this
 * one guard instead of carrying a second copy of the regex.
 */
export function agentDir(agentsDir, slug) {
  const name = String(slug ?? "");
  if (!SLUG.test(name) || name.length > 40) throw new Error("not a valid agent name");
  return join(agentsDir, name);
}

// ── Reading ───────────────────────────────────────────────────────────────

/**
 * @returns {{slug,name,role,goal,description,origin,tools:string[],skills:string[],
 *            memory:boolean,outputFormat:"text"|"json"}[]}
 */
export function listAgents(agentsDir) {
  let entries;
  try {
    entries = readdirSync(agentsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const dates = lastCommitDates(dirname(agentsDir), "agents");
  const agents = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const listed = describe(join(agentsDir, entry.name), entry.name, dates[entry.name]);
    if (listed) agents.push(listed);
  }
  return agents;
}

/** One agent, with the two long fields the pane edits. @returns {{...listing, instructions, rules}} */
export function readAgent(agentsDir, slug) {
  const dir = agentDir(agentsDir, slug);
  const listed = describe(dir, String(slug), lastCommitDates(dirname(agentsDir), "agents")[slug]);
  if (!listed) throw new Error("no such agent");
  return {
    ...listed,
    instructions: parseSoul(readIfPresent(join(dir, "SOUL.md"))).instructions,
    rules: readIfPresent(join(dir, "RULES.md")),
  };
}

/** The listing fields, or null when the folder holds no loadable agent.yaml. */
function describe(dir, slug, committedAt) {
  let manifest;
  try {
    manifest = yaml.load(readFileSync(join(dir, "agent.yaml"), "utf8"));
  } catch {
    return null;
  }
  if (!manifest || typeof manifest !== "object") return null;

  const meta = manifest.metadata && typeof manifest.metadata === "object" ? manifest.metadata : {};
  const soul = parseSoul(readIfPresent(join(dir, "SOUL.md")));
  return {
    slug,
    name: typeof manifest.name === "string" ? manifest.name : slug,
    role: soul.role,
    goal: soul.goal || String(manifest.description ?? ""),
    description: String(manifest.description ?? ""),
    origin: meta.added_via === "badger-ui" ? "custom" : "handwritten",
    // The cards show when an agent was made. Read from the manifest and never
    // from the folder's mtime, which every deploy rewrites.
    createdAt: typeof meta.created_at === "string" ? meta.created_at : "",
    // When it last actually changed, from git. An agent created here and not
    // yet committed has no commit, and for that one "last updated" and
    // "created" are the same moment — so the manifest's own stamp is the
    // honest fallback rather than an empty cell.
    updatedAt: committedAt || (typeof meta.created_at === "string" ? meta.created_at : ""),
    // The colour the agent's mark is drawn in. Shape-checked only — which
    // names exist is the UI's business, and it falls back to the first for one
    // it does not know.
    color: COLOR.test(String(meta.color ?? "")) ? String(meta.color) : "",
    tools: toolNamesIn(join(dir, "tools")),
    skills: subdirectories(join(dir, "skills")),
    memory: meta.memory === true,
    outputFormat: meta.output_format === "json" ? "json" : "text",
  };
}

/**
 * Role, goal and instructions back out of SOUL.md.
 *
 * The first two regexes are the Lyzr Studio exporter's own
 * (dist/adapters/lyzr.js:90-91) — parsing with the same expressions is what
 * keeps a round trip through this editor from quietly breaking the export.
 * A missing section is an empty string, never a throw: these files can be
 * edited by hand.
 */
function parseSoul(text) {
  const section = (re) => {
    const m = String(text ?? "").match(re);
    return m ? m[1].trim() : "";
  };
  const firstLine = (s) => s.split("\n")[0].replace(/^[-*]\s*/, "").trim();
  return {
    role: firstLine(section(/##\s*Core\s*Identity\s*\n+([\s\S]*?)(?=\n##|\n$|$)/i)),
    goal: firstLine(section(/##\s*(?:Values|Purpose|Goal|Mission)\s*.*?\n+([\s\S]*?)(?=\n##|\n$|$)/i)),
    instructions: section(/##\s*Instructions\s*\n+([\s\S]*?)(?=\n##\s|\n$|$)/i),
  };
}

// ── Writing ───────────────────────────────────────────────────────────────

/** Create a sub-agent folder from the pane's fields. @returns {{slug: string}} */
export function createAgent(agentsDir, spec, options = {}) {
  const rootDir = options.rootDir ?? dirname(agentsDir);
  const clean = validate(rootDir, spec);
  const dir = agentDir(agentsDir, clean.slug);
  if (existsSync(dir)) throw new Error(`an agent named "${clean.slug}" already exists`);

  const manifest = {
    spec_version: "0.1.0",
    name: clean.slug,
    version: "0.1.0",
    description: clean.goal,
    author: "badger-ui",
    license: "MIT",
    model: { preferred: MODEL, constraints: { temperature: 0.1, max_tokens: 8192 } },
    runtime: { max_turns: 18, timeout: 300 },
    metadata: {
      added_via: "badger-ui",
      created_at: new Date().toISOString(),
      output_format: clean.outputFormat,
      memory: clean.memory,
      color: clean.color,
    },
  };

  mkdirSync(dir, { recursive: true });
  write(dir, clean, manifest, rootDir, agentsDir);
  syncRootManifest(rootDir, clean.slug, clean.goal);
  return { slug: clean.slug };
}

/** Overwrite a sub-agent from the pane's fields, keeping what the form does not own. */
export function updateAgent(agentsDir, slug, spec, options = {}) {
  const rootDir = options.rootDir ?? dirname(agentsDir);
  let dir = agentDir(agentsDir, slug);
  if (!existsSync(join(dir, "agent.yaml"))) throw new Error("no such agent");
  const clean = validate(rootDir, { ...spec, slug: spec?.slug ?? slug });

  // A rename is a MOVE, because the runtime keys an agent by its directory.
  // The whole folder goes with it — memory/, hooks/, anything the agent wrote
  // itself — and the old entry comes out of the root manifest, or the agent
  // would be listed twice under two names.
  const renamed = clean.slug !== String(slug);
  if (renamed) {
    const target = agentDir(agentsDir, clean.slug);
    if (existsSync(target)) throw new Error(`an agent named "${clean.slug}" already exists`);
    renameSync(dir, target);
    syncRootManifest(rootDir, String(slug), null);
    dir = target;
  }

  // Merged onto the manifest on disk rather than rebuilt, so `added_via`,
  // `created_at` and any key this editor knows nothing about survive a save.
  // Origin lives only in metadata, and a file with no marker reads as
  // built-in — the same trap that cost skills three bugs.
  const previous = yaml.load(readFileSync(join(dir, "agent.yaml"), "utf8")) ?? {};
  const manifest = {
    ...previous,
    name: clean.slug,
    description: clean.goal,
    metadata: {
      ...(previous.metadata && typeof previous.metadata === "object" ? previous.metadata : {}),
      output_format: clean.outputFormat,
      memory: clean.memory,
      color: clean.color,
    },
  };

  write(dir, clean, manifest, rootDir, agentsDir);
  syncRootManifest(rootDir, clean.slug, clean.goal);
  return { slug: clean.slug, renamedFrom: renamed ? String(slug) : null };
}

/** Remove a sub-agent, and its entry in the root manifest with it. */
export function deleteAgent(agentsDir, slug, options = {}) {
  const dir = agentDir(agentsDir, slug);
  if (!existsSync(join(dir, "agent.yaml"))) throw new Error("no such agent");
  rmSync(dir, { recursive: true, force: true });
  syncRootManifest(options.rootDir ?? dirname(agentsDir), String(slug), null);
  return { slug: String(slug) };
}

/** Everything the form owns, written over whatever is already there. */
function write(dir, clean, manifest, rootDir, agentsDir) {
  // `skills:` is NEVER written, and this is not an omission.
  //
  // loader.js:194 treats the key as a hard FILTER over `discoverSkills()`, so
  // listing the pane's selection there would permanently hide anything the
  // agent later crystallises for itself — the sub-agent's skills/ would fill
  // up with work the model could never use, silently. CLAUDE.md records the
  // same trap for the root agent; setting it here reintroduced it one level
  // down.
  //
  // The DIRECTORY is the selection instead, exactly as `tools/` is the tool
  // schema. writeSkills below puts the chosen ones there, which makes the
  // filter redundant as well as harmful.
  delete manifest.skills;

  writeFileSync(join(dir, "agent.yaml"), yaml.dump(manifest, { lineWidth: -1 }), "utf8");
  writeFileSync(join(dir, "SOUL.md"), renderSoul(clean), "utf8");

  for (const file of ["RULES.md", "DUTIES.md"]) {
    // Copied once. They are policy, not form fields, so an edit made in the
    // file survives a save from the pane.
    if (!existsSync(join(dir, file)) && existsSync(join(rootDir, file))) {
      cpSync(join(rootDir, file), join(dir, file));
    }
  }

  writeTools(dir, clean, rootDir, agentsDir);
  writeSkills(dir, clean, rootDir);
  writeHooks(dir, clean, rootDir);

  if (clean.memory && !existsSync(join(dir, "memory", "MEMORY.md"))) {
    mkdirSync(join(dir, "memory"), { recursive: true });
    writeFileSync(join(dir, "memory", "MEMORY.md"), "# Memory\n", "utf8");
  }
}

/**
 * SOUL.md, in the one shape the Lyzr exporter can read.
 *
 * `## Core Identity` with a single unbulleted line beneath is what
 * dist/adapters/lyzr.js:90 matches on. The goal is not that simple: line 91 is
 * `##\s*(?:Values|Purpose|Goal|Mission)\s*.*?\n+(...)`, and the greedy `\s*`
 * eats the blank line while `.*?` then eats the first line of content — so the
 * capture starts one line late and the goal exports as whatever follows it.
 * Measured: with the goal directly under the heading it exports as
 * "## Instructions". The lead-in line below is what the exporter consumes,
 * leaving the goal itself as the captured first line.
 */
function renderSoul(clean) {
  return [
    `# ${clean.role}`,
    "",
    "## Core Identity",
    "",
    clean.role,
    "",
    "## Goal",
    "",
    "Every answer this agent gives serves one purpose:",
    "",
    clean.goal,
    "",
    "## Instructions",
    "",
    clean.instructions || "Answer the question from what you retrieve, and cite every source.",
    "",
  ].join("\n");
}

/**
 * One YAML per selected tool, pointing back at the shared implementation.
 *
 * The runtime resolves a script as join(agentDir, "tools", script)
 * (dist/tool-loader.js), so from agents/<slug>/tools the repo root is three
 * segments up. Computed rather than written down, and the scripts themselves
 * are never copied: one implementation, many agents.
 */
function writeTools(dir, clean, rootDir, agentsDir) {
  const toolsDir = join(dir, "tools");
  mkdirSync(toolsDir, { recursive: true });
  const catalog = listToolCatalog(join(rootDir, "tools"));
  const prefix = `${relative(toolsDir, join(rootDir, "tools")).split(sep).join("/")}/`;

  const keep = new Set();
  for (const name of clean.tools) {
    const entry = catalog.find((t) => t.name === name);
    keep.add(entry.file);
    const source = readFileSync(join(rootDir, "tools", entry.file), "utf8");
    writeFileSync(join(toolsDir, entry.file), rewriteImplementation(source, prefix), "utf8");
  }
  for (const file of readdirSync(toolsDir)) {
    if (file.endsWith(".yaml") && !keep.has(file)) rmSync(join(toolsDir, file));
  }
}

/** Rewrite `path:` and `script:` inside the top-level implementation block. */
function rewriteImplementation(text, prefix) {
  let inside = false;
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (line.length && !/^\s/.test(line)) inside = /^implementation:/.test(line);
      if (!inside) return line;
      const m = line.match(/^(\s+)(path|script):\s*(\S+)\s*$/);
      return m ? `${m[1]}${m[2]}: ${prefix}${m[3]}` : line;
    })
    .join("\n");
}

/**
 * Copy the selected Badger skills in.
 *
 * The runtime's `skills:` key filters an agent's own skills/ folder and cannot
 * reach the parent's, so a sub-agent that should know a procedure needs its
 * own copy. `copied_from: badger` records where it started — it is not in
 * skill.schema.json and will cost one `opengap validate` error per copy, which
 * is accepted rather than chased.
 */
function writeSkills(dir, clean, rootDir) {
  const skillsDir = join(dir, "skills");
  mkdirSync(skillsDir, { recursive: true });

  for (const slug of clean.skills) {
    const target = join(skillsDir, slug);
    rmSync(target, { recursive: true, force: true });
    cpSync(join(rootDir, "skills", slug), target, { recursive: true });
    const file = join(target, "SKILL.md");
    if (existsSync(file)) writeFileSync(file, stampCopied(readFileSync(file, "utf8")), "utf8");
  }
  // Deselecting a skill removes the COPY the pane made, and nothing else. A
  // skill the agent crystallised for itself lives in this same directory and
  // is its own work — pruning by "not in the current selection" deleted it on
  // the next save of any unrelated field, which is the same shape as the
  // crystallisation that overwrote onboard-to-project.
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || clean.skills.includes(entry.name)) continue;
    if (!copiedByUs(join(skillsDir, entry.name))) continue;
    rmSync(join(skillsDir, entry.name), { recursive: true, force: true });
  }
}

/** Did this skill get here by being copied from Badger's own skills/? */
function copiedByUs(dir) {
  return /^copied_from:/m.test(readIfPresent(join(dir, "SKILL.md")));
}

function stampCopied(text) {
  if (/^copied_from:/m.test(text)) return text;
  return text.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, "$1\ncopied_from: badger$2");
}

/**
 * All three hook files, so the sub-agent is genuinely standalone.
 *
 * allowed-tools.txt is generated rather than copied: the builtins the root
 * list already permits, plus only the tools this agent has. Real enforcement
 * is still `disallowedTools` and the in-process guard — dist/hooks.js treats a
 * crash, a timeout and non-JSON output as allow, so nothing rests on this.
 */
function writeHooks(dir, clean, rootDir) {
  const hooksDir = join(dir, "hooks");
  mkdirSync(hooksDir, { recursive: true });
  for (const file of ["hooks.yaml", "allow-tools.sh"]) {
    if (existsSync(join(rootDir, "hooks", file))) cpSync(join(rootDir, "hooks", file), join(hooksDir, file));
  }

  const root = readIfPresent(join(rootDir, "hooks", "allowed-tools.txt")).split(/\r?\n/);
  const header = [];
  for (const line of root) {
    if (line.trim() && !line.startsWith("#")) break;
    header.push(line);
  }
  const permitted = new Set(root.map((l) => l.trim()));
  const builtins = BUILTINS.filter((name) => permitted.has(name));
  const lines = [...header, ...builtins, "", ...clean.tools, ""];
  writeFileSync(join(hooksDir, "allowed-tools.txt"), lines.join("\n"), "utf8");
}

// ── Validation ────────────────────────────────────────────────────────────
//
// Every message is written for the person in the pane, not for a log.

function validate(rootDir, spec) {
  const slug = String(spec?.slug ?? "");
  if (!SLUG.test(slug) || slug.length > 40)
    throw new Error("name must be lower-case words joined by hyphens, 40 characters at most");

  const role = String(spec?.role ?? "").trim();
  const goal = String(spec?.goal ?? "").trim();
  if (!role) throw new Error("give the agent a role — one line saying what it is");
  if (!goal) throw new Error("give the agent a goal — one line saying what it is for");
  if (role.length > 200) throw new Error("role is too long (200 characters max)");
  if (goal.length > 200) throw new Error("goal is too long (200 characters max)");

  const instructions = String(spec?.instructions ?? "").trim();
  if (instructions.length > 20000) throw new Error("instructions are too long (20,000 characters max)");

  const color = String(spec?.color ?? "clay");
  if (!COLOR.test(color)) throw new Error("that colour is not one we can store");

  const outputFormat = spec?.outputFormat ?? "text";
  if (outputFormat !== "text" && outputFormat !== "json")
    throw new Error('output format must be "text" or "json"');

  const known = listToolCatalog(join(rootDir, "tools")).map((t) => t.name);
  const tools = [...new Set(list(spec?.tools))];
  for (const name of tools) if (!known.includes(name)) throw new Error(`no tool named "${name}"`);

  const available = subdirectories(join(rootDir, "skills"));
  const skills = [...new Set(list(spec?.skills))];
  for (const slugged of skills) {
    if (!SLUG.test(slugged) || !available.includes(slugged))
      throw new Error(`no skill named "${slugged}"`);
  }

  return {
    slug,
    role,
    goal,
    color,
    instructions,
    tools,
    skills,
    outputFormat,
    memory: spec?.memory === true,
  };
}

const list = (value) => (Array.isArray(value) ? value.map((v) => String(v)) : []);

/**
 * The root tools/ directory as {name, description, file} — what the pane's
 * tool multi-select lists, and what a selected tool name is checked against.
 *
 * Every one of those files writes its description as a YAML block scalar, so
 * it is folded onto one line here the same way skills-store folds a skill's.
 */
export function listToolCatalog(toolsDir) {
  const dir = String(toolsDir);
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
  } catch {
    return [];
  }
  const catalog = [];
  for (const file of files) {
    let parsed;
    try {
      parsed = yaml.load(readFileSync(join(dir, file), "utf8"));
    } catch {
      continue;
    }
    if (!parsed || typeof parsed.name !== "string") continue;
    const description = String(parsed.description ?? "").replace(/\s+/g, " ").trim();
    catalog.push({ name: parsed.name, description, file });
  }
  return catalog;
}

function toolNamesIn(toolsDir) {
  return listToolCatalog(toolsDir)
    .map((t) => t.name)
    .sort();
}

function subdirectories(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function readIfPresent(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

// ── The root manifest's agents: block ─────────────────────────────────────

/**
 * Add or remove one entry, by editing the text.
 *
 * `opengap validate` fails the build when a name here has no folder under
 * agents/ (dist/commands/validate.js:60), so the two have to move together. A
 * YAML round trip would keep them in sync and delete every comment in a file
 * that is mostly comments, so this is a targeted textual edit instead.
 * Description null means remove.
 *
 * EVERY `agents:` block is collected and rewritten as one, and this is the
 * load-bearing part rather than tidiness. The first version took the first
 * block it found and appended a whole new one when there was none, which is
 * correct in one file and wrong across two: a sub-agent created on a clone
 * whose branch did not yet carry main's own block wrote a second block 150
 * lines further down, git merged both without a conflict because the edits
 * are nowhere near each other, and YAML refuses a duplicated key. The agent
 * then failed to load at all and every question in production came back in
 * half a second with no steps and no answer. Repairing on write means the
 * next save heals a manifest that arrived broken.
 */
function syncRootManifest(rootDir, slug, description) {
  const file = join(rootDir, "agent.yaml");
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }

  const lines = text.split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^agents:\s*$/.test(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && (lines[end].trim() === "" || /^\s/.test(lines[end]))) end++;
    // Give back the blank lines that separate the block from whatever follows.
    // Without this they fall inside the replaced range and are dropped, so every
    // create-then-delete cycle eats one line of the manifest's spacing.
    while (end > i + 1 && lines[end - 1].trim() === "") end--;
    blocks.push({ start: i, end });
    i = end - 1;
  }

  if (!blocks.length) {
    if (description === null) return;
    return writeManifest(file, text, insertBlock(text, entry(slug, description)));
  }

  // Every block's entries, in the order they appear, with the named one taken
  // out wherever it sits. A duplicate slug across two blocks keeps the first.
  const body = blocks.flatMap(({ start, end }) =>
    lines.slice(start + 1, end).filter((line) => line.trim() !== ""),
  );

  const kept = [];
  const seen = new Set();
  for (let i = 0; i < body.length; i++) {
    const named = body[i].match(/^ {2}(\S[^:]*):\s*$/);
    if (named && (named[1] === slug || seen.has(named[1]))) {
      while (i + 1 < body.length && /^ {3}/.test(body[i + 1])) i++;
      continue;
    }
    if (named) seen.add(named[1]);
    kept.push(body[i]);
  }
  if (description !== null) kept.push(...entry(slug, description));

  // One block, where the first one was; the rest of them go.
  const replacement = kept.length ? ["agents:", ...kept] : [];
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const block = blocks.find((b) => b.start === i);
    if (!block) {
      out.push(lines[i]);
      continue;
    }
    if (block === blocks[0]) out.push(...replacement);
    // Removing the last entry removes the block, and with it the blank line
    // `insertBlock` put in front of what follows — otherwise the separator
    // before the block and the one after it both survive and the file grows a
    // line on every create-then-delete cycle.
    const drop =
      block === blocks[0] && replacement.length
        ? block.end
        : lines[block.start - 1]?.trim() === "" && lines[block.end]?.trim() === ""
          ? block.end + 1
          : block.end;
    i = drop - 1;
  }
  writeManifest(file, text, out.join("\n"));
}

/**
 * Write the manifest only if it still parses.
 *
 * The agent is a YAML file the runtime loads before anything else, so an
 * unparseable one is not a bad save — it is an agent that cannot answer at
 * all. Refusing here turns that into a failed request, which the caller
 * reports, instead of a manifest that is broken until someone reads a log.
 */
function writeManifest(file, before, after) {
  try {
    yaml.load(after);
  } catch (err) {
    throw new Error(`refusing to write an agent.yaml that no longer parses: ${err.message}`);
  }
  void before;
  writeFileSync(file, after, "utf8");
}

const entry = (slug, description) => [`  ${slug}:`, `    description: ${JSON.stringify(description)}`];

/** A new block, ahead of `tags:` when there is one so the manifest keeps its shape. */
function insertBlock(text, body) {
  const block = `agents:\n${body.join("\n")}\n`;
  const at = text.search(/^tags:\s*$/m);
  if (at < 0) return `${text.replace(/\n*$/, "\n")}\n${block}`;
  return `${text.slice(0, at)}${block}\n${text.slice(at)}`;
}
