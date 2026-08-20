// The web UI's view onto the agent's skills/ directory.
//
// Listing and creating work on the same files the runtime loads, so a skill
// added here exists to the agent on its next run. The server writes the file;
// review-and-commit stays a person's job.
//
// Origin is recovered from frontmatter: skill_learner stamps `learned_from`,
// this store stamps `added_via: badger-ui`, anything else is hand-written.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";


/** @returns {{slug: string, name: string, description: string, origin: "handwritten"|"learned"|"custom"}[]} */
export function listSkills(skillsDir) {
  let entries;
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let text;
    try {
      text = readFileSync(join(skillsDir, entry.name, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) continue;
    const field = (key) => readField(fm[1], key);
    const origin = /^learned_from:/m.test(fm[1])
      ? "learned"
      : /^added_via:/m.test(fm[1])
        ? "custom"
        : "handwritten";
    skills.push({
      slug: entry.name,
      name: field("name") || entry.name,
      description: field("description"),
      origin,
    });
  }
  return skills;
}

/**
 * Add a skill from a raw SKILL.md the user already has. Written verbatim —
 * it is their file — after checking it is a skill the runtime will actually
 * load: frontmatter with a kebab-case name and a description, no collision.
 */
export function createSkillFromFile(skillsDir, content) {
  const text = String(content ?? "");
  if (text.length > 50000) throw new Error("file too long (50k chars max)");
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) throw new Error("not a SKILL.md — missing the --- frontmatter block");
  const name = readField(fm[1], "name");
  const description = readField(fm[1], "description");
  if (!name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))
    throw new Error("frontmatter needs a kebab-case name: (e.g. name: my-skill)");
  // `readField`, not a regex: a regex captures ">" from a block scalar and
  // calls that a description, so an empty one passes validation.
  if (!description) throw new Error("frontmatter needs a description: line — it is the trigger");
  const dir = join(skillsDir, name);
  if (existsSync(dir)) throw new Error(`a skill named "${name}" already exists`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), stampOrigin(text, fm[1]), "utf8");
  return { slug: name };
}

/**
 * Mark an uploaded file as having come in through the UI.
 *
 * Origin lives only in frontmatter, so a file uploaded without `added_via` or
 * `learned_from` reads back as hand-written — which means built-in, which means
 * it can never be edited or deleted.
 *
 * Only when neither marker is present, so a learned skill exported and
 * re-uploaded still says it was learned.
 */
function stampOrigin(text, frontmatter) {
  if (/^(added_via|learned_from):/m.test(frontmatter)) return text;
  return text.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, "$1\nadded_via: badger-ui$2");
}

/**
 * One frontmatter field, without a YAML dependency.
 *
 * Two shapes: a plain value on the same line, and a block scalar
 * ("description: >" or "|") indented beneath, which every hand-written skill
 * uses. Block text is folded onto one line for the menu row.
 */
function readField(frontmatter, key) {
  const lines = frontmatter.split(/\r?\n/);
  const at = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (at < 0) return "";

  const inline = lines[at].slice(key.length + 1).trim();
  if (inline && !/^[|>][-+]?\d*$/.test(inline)) {
    return inline.replace(/^["']|["']$/g, "");
  }

  // A block scalar: every following line indented past column 0 belongs to it.
  const block = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    if (!/^\s/.test(lines[i])) break;
    block.push(lines[i].trim());
  }
  return block.join(" ").replace(/\s+/g, " ").trim();
}

// ── Reading, editing and removing an existing skill ───────────────────────
//
// Raw SKILL.md rather than parsed fields: these files carry frontmatter this
// store knows nothing about, and a field-based round trip drops whatever it
// has no box for. The file is the artefact; the editor edits the file.

/** A slug that is safe to join onto a path. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The directory for a slug, or a thrown error.
 *
 * The regex is the whole path-traversal defence: no dot, no slash, no
 * backslash, so "../../etc" fails before `join` is reached. Here rather than
 * at the route, so a second caller cannot forget.
 */
function skillDir(skillsDir, slug) {
  if (!SLUG.test(String(slug ?? ""))) throw new Error("not a valid skill name");
  return join(skillsDir, String(slug));
}

/** One skill, with its file. @returns {{slug,name,description,origin,content}} */
export function readSkill(skillsDir, slug) {
  const dir = skillDir(skillsDir, slug);
  let content;
  try {
    content = readFileSync(join(dir, "SKILL.md"), "utf8");
  } catch {
    throw new Error("no such skill");
  }
  const listed = listSkills(skillsDir).find((s) => s.slug === slug);
  return {
    slug,
    name: listed?.name ?? slug,
    description: listed?.description ?? "",
    origin: listed?.origin ?? "handwritten",
    content,
  };
}

// Editing was tried and pulled. Splitting a SKILL.md into "the trigger" and
// "the steps" meant two boxes that hid `license`, `allowed-tools` and
// `metadata` while silently owning them on save, and it turned one artefact
// into two half-views of itself. A skill is a file. You read the file, and if
// you want a different one you download it, change it and upload it back —
// which is the same loop, with no machinery in the middle that can quietly
// drop a field.

/**
 * Overwrite a skill's SKILL.md with a new one.
 *
 * The whole file, the same string the editor holds — there is no merging here
 * and that is the point. An earlier version of this took a description and a
 * body and stitched them into the existing frontmatter, which meant this
 * function silently owned `license`, `allowed-tools` and `metadata` on every
 * save while the pane never showed them. One box, one string, nothing in
 * between.
 *
 * The frontmatter `name` must still equal the slug. The runtime keys a skill
 * by its DIRECTORY, so renaming in place would leave a skill whose file calls
 * it one thing and whose folder calls it another, and the picker lists
 * directories. Renaming is a move, and is refused rather than half-done.
 */
export function updateSkill(skillsDir, slug, content) {
  const dir = skillDir(skillsDir, slug);
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) throw new Error("no such skill");

  const text = String(content ?? "");
  if (!text.trim()) throw new Error("a skill cannot be empty");
  if (text.length > 50000) throw new Error("too long (50k chars max)");
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) throw new Error("missing the --- frontmatter block");
  if (readField(fm[1], "name") !== slug)
    throw new Error(`name: must stay "${slug}" — renaming is not supported here`);
  if (!readField(fm[1], "description"))
    throw new Error("frontmatter needs a description: line — it is the trigger");

  writeFileSync(file, carryOrigin(readFileSync(file, "utf8"), text), "utf8");
  return { slug };
}

/**
 * Keep the provenance line an edit would otherwise drop.
 *
 * Origin is not stored anywhere but the frontmatter — `added_via: badger-ui`
 * for a skill added here, `learned_from:` for one the agent taught itself — so
 * an edit that replaces the whole file replaces that too, and the skill
 * silently becomes hand-written. Measured before the fix: add a skill, edit
 * it, and it reports as built-in afterwards. Nothing depends on that any more
 * for permissions, but the file would still be lying about where it came
 * from, and the list would tag it wrongly.
 *
 * Put back rather than refused. Demanding someone preserve a line they never
 * wrote and cannot see the purpose of is a worse trade than keeping the file
 * honest for them.
 */
function carryOrigin(previous, text) {
  const oldFm = previous.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const newFm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!oldFm || !newFm) return text;

  const carry = oldFm[1]
    .split(/\r?\n/)
    .filter((line) => /^(added_via|learned_from|added_at):/.test(line))
    .filter((line) => !new RegExp(`^${line.split(":")[0]}:`, "m").test(newFm[1]));
  if (!carry.length) return text;

  return text.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, `$1\n${carry.join("\n")}$2`);
}

/**
 * Remove a skill.
 *
 * Any skill, including the ones that ship with Badger. They are files in a git
 * repository, so a delete is recoverable by the same means as every other
 * change to this repo, and refusing one was policy dressed as safety. The
 * confirm in the pane is the real guard: it names what is going.
 */
export function deleteSkill(skillsDir, slug) {
  const dir = skillDir(skillsDir, slug);
  const listed = listSkills(skillsDir).find((s) => s.slug === slug);
  if (!listed) throw new Error("no such skill");
  rmSync(dir, { recursive: true, force: true });
  return { slug };
}
