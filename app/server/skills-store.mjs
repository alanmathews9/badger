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
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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
    const field = (key) => {
      // First line wins; block scalars (>- / |) fall back to the slug rather
      // than a YAML parse — descriptions we write are single-line on purpose.
      const m = fm[1].match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
      return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
    };
    const origin = /^learned_from:/m.test(fm[1])
      ? "learned"
      : /^added_via:/m.test(fm[1])
        ? "custom"
        : "handwritten";
    skills.push({
      slug: entry.name,
      name: field("name") || entry.name,
      description: /^[>|]/.test(field("description")) ? "" : field("description"),
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
    String(instructions).trim(),
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
  writeFileSync(join(dir, "SKILL.md"), text, "utf8");
  return { slug: name };
}
