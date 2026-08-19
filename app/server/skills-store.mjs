// The web UI's view onto the agent's skills/ directory.
//
// Listing and creating both work on the same files the runtime loads, so a
// skill added here exists to the agent on its very next run — the same
// mechanism as the agent's own skill_learner, driven by a person instead.
// The commit is deliberately left to a human (or to the caller): the server
// writes the file; review-and-commit stays a person's job.
//
// Origin is recovered from frontmatter the different writers already leave
// behind: skill_learner stamps `learned_from`, this store stamps
// `added_via: badger-ui`, and anything else is hand-written.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** A plain name → a filesystem-safe kebab slug. Returns "" when nothing survives. */
export function slugify(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-|-$/g, "");
}

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
 * Write a new skill into the agent's tree. Throws with a human-readable
 * message on any invalid input; the caller turns that into a 4xx.
 */
export function createSkill(skillsDir, { name, description, instructions }) {
  const slug = slugify(name);
  if (!slug || slug.length > 60) throw new Error("name must contain a few plain words");
  if (!String(description ?? "").trim()) throw new Error("description is required");
  if (!String(instructions ?? "").trim()) throw new Error("instructions are required");
  if (String(description).length > 500) throw new Error("description too long (500 chars max)");
  if (String(instructions).length > 20000) throw new Error("instructions too long (20k chars max)");

  const dir = join(skillsDir, slug);
  if (existsSync(dir)) throw new Error(`a skill named "${slug}" already exists`);

  // One-line description in the frontmatter, so listSkills can read it back
  // without a YAML parser.
  const oneLineDescription = String(description).replace(/\s+/g, " ").trim();
  const content = [
    "---",
    `name: ${slug}`,
    `description: ${oneLineDescription}`,
    "added_via: badger-ui",
    `added_at: '${new Date().toISOString()}'`,
    "---",
    "",
    // `?? ""`, not String(instructions): with the steps left out — which the
    // two-field form does by design — String(undefined) writes the literal
    // word "undefined" into the file, and the agent would read it as the
    // procedure. Caught by creating one through the API and looking at it.
    String(instructions ?? "").trim(),
    "",
  ].join("\n");

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content, "utf8");
  return { slug };
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
  const name = fm[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = fm[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (!name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))
    throw new Error("frontmatter needs a kebab-case name: (e.g. name: my-skill)");
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
 * "Written verbatim — it is their file" was the original rule and it had a
 * trap in it. Origin is not stored anywhere but the frontmatter, so a file
 * uploaded without `added_via` or `learned_from` reads back as hand-written —
 * and hand-written means built-in, which means it can be neither edited nor
 * deleted. Measured: upload a SKILL.md, then try to remove it, and the server
 * answers "built-in skills cannot be deleted". A file you added and can never
 * take away.
 *
 * One line, and only when neither marker is already there, so a genuinely
 * learned skill exported and re-uploaded keeps saying it was learned.
 * Everything else about the file is still untouched.
 */
function stampOrigin(text, frontmatter) {
  if (/^(added_via|learned_from):/m.test(frontmatter)) return text;
  return text.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, "$1\nadded_via: badger-ui$2");
}

/**
 * One frontmatter field, without a YAML dependency.
 *
 * Handles the two shapes that actually appear in these files: a plain value
 * on the same line, and a block scalar ("description: >" or "|") whose text
 * is indented beneath — which every hand-written skill here uses. Block text
 * is folded onto one line, because the caller is labelling a menu row.
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
// The three below are what the manage-skills page needs. They work on the raw
// SKILL.md rather than on parsed fields, deliberately: the hand-written skills
// use YAML block scalars and carry frontmatter this store knows nothing about
// (`learned_from`, `added_at`), so round-tripping them through a three-field
// form would quietly drop whatever the form has no box for. The file is the
// artefact; the editor edits the file.

/** A slug that is safe to join onto a path. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The directory for a slug, or a thrown error.
 *
 * The regex is the whole of the path-traversal defence and it is enough: it
 * admits no dot, no slash and no backslash, so "../../etc" and "..%2f" and a
 * bare ".." all fail before `join` is ever reached. Validate here rather than
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

// Nothing edits a skill through the product any more, and `updateSkill`,
// `editSkill` and their YAML-merging helpers are gone with the feature rather
// than left behind as unreachable code that still writes files.
//
// Editing was tried and pulled. Splitting a SKILL.md into "the trigger" and
// "the steps" meant two boxes that hid `license`, `allowed-tools` and
// `metadata` while silently owning them on save, and it turned one artefact
// into two half-views of itself. A skill is a file. You read the file, and if
// you want a different one you download it, change it and upload it back —
// which is the same loop, with no machinery in the middle that can quietly
// drop a field.

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
