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
  // Steps are OPTIONAL here. The new-skill form asks for a name and a trigger
  // and nothing else, then opens the file for editing — a two-field form and a
  // full-width editor beats three cramped boxes, and the description is the
  // only part the model reads before deciding, so it is the only part that
  // must exist up front.
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

/**
 * Overwrite a skill's SKILL.md.
 *
 * **The built-in four are refused, and refusing them is what keeps editing
 * simple.** They carry frontmatter the runtime's own learning loop owns —
 * `confidence`, `usage_count`, `success_count` — so allowing an edit raised a
 * question with no good answer: what does a hand edit mean to a counter the
 * agent maintains? Read-only removes the question rather than answering it,
 * they are part of the repository and so part of the deliverable, and the
 * download button is the honest escape hatch: take a copy, change it, upload
 * it under your own name. Deletes were already refused for the same reason.
 *
 * The frontmatter `name` must still equal the slug. The runtime keys a skill
 * by its DIRECTORY, so editing the name in place would leave a skill whose
 * file calls it one thing and whose folder calls it another — and the picker,
 * which lists directories, would keep offering the old one. Renaming is a
 * different operation (a move) and is not offered rather than half-done.
 */
export function updateSkill(skillsDir, slug, content) {
  const dir = skillDir(skillsDir, slug);
  if (!existsSync(join(dir, "SKILL.md"))) throw new Error("no such skill");
  const listed = listSkills(skillsDir).find((sk) => sk.slug === slug);
  if (listed?.origin === "handwritten") throw new Error("built-in skills cannot be edited");

  const text = String(content ?? "");
  if (!text.trim()) throw new Error("a skill cannot be empty");
  if (text.length > 50000) throw new Error("too long (50k chars max)");
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) throw new Error("missing the --- frontmatter block");
  const name = fm[1].match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (name !== slug) throw new Error(`name: must stay "${slug}" — renaming is not supported here`);
  if (!/^description:/m.test(fm[1])) throw new Error("frontmatter needs a description: line");

  writeFileSync(join(dir, "SKILL.md"), carryOrigin(join(dir, "SKILL.md"), text), "utf8");
  return { slug };
}

/**
 * Keep the provenance line an edit would otherwise drop.
 *
 * Origin is not stored anywhere but the frontmatter — `added_via: badger-ui`
 * for a UI skill, `learned_from:` for one the agent taught itself — so an edit
 * that replaces the whole file replaces that too, and the skill silently
 * becomes "handwritten". Measured: create a skill through the UI, edit it, and
 * it can no longer be deleted, because deletes refuse the built-in four. An
 * ordinary edit had turned into a one-way door.
 *
 * The marker is put back rather than the edit being refused. Demanding the
 * user preserve a line they never wrote and cannot see the purpose of would be
 * a worse trade than quietly keeping the file honest about where it came from.
 */
function carryOrigin(file, text) {
  let previous;
  try {
    previous = readFileSync(file, "utf8");
  } catch {
    return text;
  }
  const oldFm = previous.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const newFm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!oldFm || !newFm) return text;

  const carry = oldFm[1]
    .split(/\r?\n/)
    .filter((line) => /^(added_via|learned_from|added_at):/.test(line))
    .filter((line) => !new RegExp(`^${line.split(":")[0]}:`, "m").test(newFm[1]));
  if (!carry.length) return text;

  // Back into the frontmatter block, after its last line.
  return text.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, `$1\n${carry.join("\n")}$2`);
}

/**
 * Edit the two parts a person actually writes, leaving the rest of the file
 * alone.
 *
 * The pane shows a skill's description and its steps and nothing else — no
 * `license`, no `allowed-tools`, no `metadata` — so a save has to merge those
 * two back into a file that still carries everything it did before. Doing the
 * merge here rather than in the browser keeps every piece of YAML handling in
 * one place, including the block scalars the hand-written skills use.
 */
export function editSkill(skillsDir, slug, { description, instructions }) {
  const dir = skillDir(skillsDir, slug);
  let previous;
  try {
    previous = readFileSync(join(dir, "SKILL.md"), "utf8");
  } catch {
    throw new Error("no such skill");
  }
  const fm = previous.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fm) throw new Error("that skill's file has no frontmatter to edit");

  const oneLine = String(description ?? "").replace(/\s+/g, " ").trim();
  if (!oneLine) throw new Error("description is required — it is the trigger");
  if (oneLine.length > 500) throw new Error("description too long (500 chars max)");

  const front = replaceField(fm[1], "description", oneLine);
  const body = String(instructions ?? "").trim();
  return updateSkill(skillsDir, slug, `---\n${front}\n---\n\n${body}\n`);
}

/**
 * Swap one frontmatter field's value, whatever shape it was written in.
 *
 * A plain `key: value` line is replaced in place. A block scalar
 * ("description: >") owns every indented line beneath it, and all of those go
 * with it — otherwise the old text would survive under the new one-liner and
 * the file would claim two descriptions.
 */
function replaceField(frontmatter, key, value) {
  const lines = frontmatter.split(/\r?\n/);
  const at = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (at < 0) return [...lines, `${key}: ${value}`].join("\n");

  let end = at;
  const inline = lines[at].slice(key.length + 1).trim();
  if (!inline || /^[|>][-+]?\d*$/.test(inline)) {
    while (end + 1 < lines.length && (lines[end + 1].trim() === "" || /^\s/.test(lines[end + 1]))) {
      end += 1;
    }
  }
  return [...lines.slice(0, at), `${key}: ${value}`, ...lines.slice(end + 1)].join("\n");
}

/**
 * Remove a skill.
 *
 * The four hand-written ones are refused. They are part of the repository —
 * the submission's own argument about what an agent's procedures look like —
 * and a delete button on them is one misclick from a hole in the deliverable.
 * Learned and UI-added skills are removable, because pruning what the agent
 * taught itself is already a routine part of running this thing by hand.
 */
export function deleteSkill(skillsDir, slug) {
  const dir = skillDir(skillsDir, slug);
  const listed = listSkills(skillsDir).find((s) => s.slug === slug);
  if (!listed) throw new Error("no such skill");
  if (listed.origin === "handwritten") throw new Error("built-in skills cannot be deleted");
  rmSync(dir, { recursive: true, force: true });
  return { slug };
}
