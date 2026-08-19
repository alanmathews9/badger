// Deterministic tests for the skills store — no keys, no network, temp dirs.
//
// The store is how the web UI reads the agent's skills and adds new ones.
// Listing recovers each skill's name and description from its frontmatter and
// says where it came from (written by hand, learned by the agent, or added by
// a person through the UI). Creating writes a real SKILL.md into the agent's
// own tree — the same mechanism the agent's own learning uses — with the
// name made filesystem-safe and collisions refused rather than overwritten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listSkills,
  createSkillFromFile,
  deleteSkill,
  readSkill,
} from "../app/server/skills-store.mjs";

function scratchSkillsDir() {
  const root = mkdtempSync(join(tmpdir(), "badger-skills-"));
  const dir = join(root, "skills");
  mkdirSync(dir);
  return dir;
}

function writeSkill(dir, slug, frontmatter) {
  mkdirSync(join(dir, slug));
  writeFileSync(join(dir, slug, "SKILL.md"), `---\n${frontmatter}\n---\n\nBody.\n`);
}

test("listSkills reads name, description and origin from frontmatter", () => {
  const dir = scratchSkillsDir();
  writeSkill(dir, "find-expert", 'name: find-expert\ndescription: Who knows about a topic.');
  writeSkill(dir, "learned-one", 'name: learned-one\ndescription: Learned.\nlearned_from: task:abc');
  writeSkill(dir, "my-custom", 'name: my-custom\ndescription: Mine.\nadded_via: badger-ui');

  const skills = listSkills(dir);
  const bySlug = Object.fromEntries(skills.map((s) => [s.slug, s]));
  assert.equal(bySlug["find-expert"].origin, "handwritten");
  assert.equal(bySlug["learned-one"].origin, "learned");
  assert.equal(bySlug["my-custom"].origin, "custom");
  assert.equal(bySlug["find-expert"].description, "Who knows about a topic.");
});

test("a directory without SKILL.md is skipped, not fatal", () => {
  const dir = scratchSkillsDir();
  mkdirSync(join(dir, "empty-dir"));
  writeSkill(dir, "real", "name: real\ndescription: Real.");
  assert.deepEqual(listSkills(dir).map((s) => s.slug), ["real"]);
});

test("a block-scalar description is read, folded onto one line", () => {
  const dir = scratchSkillsDir();
  // The hand-written skills use YAML block scalars — "description: >" with
  // the text indented beneath — so a parser that only reads single-line
  // values shows every one of them as blank in the picker.
  writeSkill(
    dir,
    "folded",
    "name: folded\ndescription: >\n  Who knows about a topic,\n  across all three sources.\nlicense: MIT",
  );
  writeSkill(
    dir,
    "literal",
    "name: literal\ndescription: |\n  Summarise what happened.\nmetadata:\n  author: someone",
  );

  const bySlug = Object.fromEntries(listSkills(dir).map((s) => [s.slug, s]));
  assert.equal(bySlug.folded.description, "Who knows about a topic, across all three sources.");
  assert.equal(bySlug.literal.description, "Summarise what happened.");
});

// ── Reading, editing and removing ─────────────────────────────────────────
//
// The manage-skills page. What matters here is not that the happy path works
// but that the two refusals hold — a slug can never escape the skills
// directory, and the built-in four can be neither edited nor deleted — and
// that an edit does not quietly change what a skill IS.

test("a slug can never escape the skills directory", () => {
  const dir = scratchSkillsDir();
  for (const bad of ["../secrets", "..", "a/b", "a\\b", ".hidden", "UPPER", ""]) {
    assert.throws(() => readSkill(dir, bad), /not a valid skill name/, `allowed: ${bad}`);
    assert.throws(() => deleteSkill(dir, bad), /not a valid skill name/, `allowed: ${bad}`);
  }
});

test("a built-in skill is reported as one, and is still removable", () => {
  const dir = scratchSkillsDir();
  // No `added_via` and no `learned_from` — that is what "hand-written" means
  // to the store, and it is recovered from the file rather than tracked apart.
  mkdirSync(join(dir, "built-in"));
  writeFileSync(
    join(dir, "built-in", "SKILL.md"),
    "---\nname: built-in\ndescription: ships with badger\n---\n\n1. do it\n",
  );
  // The origin is still reported — the UI tags it — but it grants no
  // protection. Refusing edits and deletes on the shipped four was policy
  // dressed as safety: they are files in a git repository, so `git checkout`
  // already recovers one. The special category cost two bugs in a day, both
  // of the form "no provenance marker, therefore sacred".
  assert.equal(readSkill(dir, "built-in").origin, "handwritten");
  assert.doesNotThrow(() => deleteSkill(dir, "built-in"));
  assert.equal(existsSync(join(dir, "built-in")), false);
});

test("an uploaded skill can be removed again", () => {
  const dir = scratchSkillsDir();
  // A SKILL.md someone already had. It carries no provenance line, because
  // why would it — and that was the trap: origin is read back off the
  // frontmatter, so the file returned as "handwritten", which means built-in,
  // which means neither editable nor deletable. A skill you added and could
  // never take away.
  createSkillFromFile(dir, "---\nname: mine\ndescription: from elsewhere\nlicense: MIT\n---\n\n1. step\n");
  const made = readSkill(dir, "mine");
  assert.equal(made.origin, "custom");
  assert.match(made.content, /license: MIT/, "the rest of their file is still untouched");
  assert.doesNotThrow(() => deleteSkill(dir, "mine"));
});

test("uploading a learned skill does not restamp it as UI-added", () => {
  const dir = scratchSkillsDir();
  createSkillFromFile(dir, "---\nname: taught\ndescription: d\nlearned_from: a question\n---\n\n1. step\n");
  // Export a learned skill and put it back and it is still a learned skill.
  // The stamp is only for files that claim no origin at all.
  assert.equal(readSkill(dir, "taught").origin, "learned");
  assert.equal(/added_via/.test(readSkill(dir, "taught").content), false);
});

// ── Creating from a whole file ────────────────────────────────────────────
//
// The only way a skill is created now: one string, whether it was typed into
// the box or loaded from disk. What matters is that the frontmatter the
// runtime depends on is really there, because these files are written by hand.

test("a file is refused unless the runtime could actually load it", () => {
  const dir = scratchSkillsDir();
  assert.throws(() => createSkillFromFile(dir, "no frontmatter here"), /frontmatter/);
  assert.throws(
    () => createSkillFromFile(dir, "---\nname: Not Kebab\ndescription: d\n---\n\nbody\n"),
    /kebab-case/,
  );
  assert.throws(
    () => createSkillFromFile(dir, "---\nname: fine\n---\n\nbody\n"),
    /description/,
  );
  // The template offers a block scalar, and a one-line regex captured ">" from
  // it and called that a description — so a file whose `description: >` had
  // nothing indented beneath passed with an empty trigger, which is the one
  // field the model reads before deciding whether the skill applies.
  assert.throws(
    () => createSkillFromFile(dir, "---\nname: fine\ndescription: >\n---\n\nbody\n"),
    /description/,
  );
});

test("a file that would load is written as given, and can be removed", () => {
  const dir = scratchSkillsDir();
  const file = "---\nname: mine\ndescription: >\n  when someone asks \"who owns\" a thing\nlicense: MIT\n---\n\n## When to Use\n\n\"Who owns billing?\"\n";
  const { slug } = createSkillFromFile(dir, file);
  assert.equal(slug, "mine");

  const back = readSkill(dir, "mine");
  assert.match(back.content, /license: MIT/);
  assert.match(back.description, /who owns/);
  assert.equal(back.origin, "custom", "stamped so it can be deleted again");
  assert.doesNotThrow(() => deleteSkill(dir, "mine"));
});

test("two skills cannot claim the same name", () => {
  const dir = scratchSkillsDir();
  const file = "---\nname: taken\ndescription: d\n---\n\nbody\n";
  createSkillFromFile(dir, file);
  assert.throws(() => createSkillFromFile(dir, file), /already exists/);
});
