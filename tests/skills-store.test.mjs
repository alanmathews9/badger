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
  createSkill,
  createSkillFromFile,
  deleteSkill,
  editSkill,
  readSkill,
  slugify,
  updateSkill,
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

test("slugify turns a plain name into a safe directory name", () => {
  assert.equal(slugify("Summarise for a customer"), "summarise-for-a-customer");
  assert.equal(slugify("  Weird!!  name??  "), "weird-name");
  assert.equal(slugify("répondre en français"), "rpondre-en-franais");
});

test("slugify refuses names that leave nothing usable", () => {
  assert.equal(slugify("!!!"), "");
  assert.equal(slugify("../../etc/passwd"), "etcpasswd");
});

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

test("createSkill writes a loadable SKILL.md marked as added via the UI", () => {
  const dir = scratchSkillsDir();
  const { slug } = createSkill(dir, {
    name: "Summarise for a customer",
    description: "Turn internal detail into a customer-safe summary.",
    instructions: "Never name internal people. Lead with the outcome.",
  });
  assert.equal(slug, "summarise-for-a-customer");
  const text = readFileSync(join(dir, slug, "SKILL.md"), "utf8");
  assert.match(text, /name: summarise-for-a-customer/);
  assert.match(text, /added_via: badger-ui/);
  assert.match(text, /Never name internal people/);
  // And the store can read back what it wrote.
  assert.equal(listSkills(dir).find((s) => s.slug === slug).origin, "custom");
});

test("createSkill refuses a collision instead of overwriting", () => {
  const dir = scratchSkillsDir();
  writeSkill(dir, "find-expert", "name: find-expert\ndescription: Existing.");
  assert.throws(
    () => createSkill(dir, { name: "Find Expert", description: "d", instructions: "i" }),
    /already exists/,
  );
});

test("createSkill validates its inputs", () => {
  const dir = scratchSkillsDir();
  assert.throws(() => createSkill(dir, { name: "!!!", description: "d", instructions: "i" }), /name/);
  assert.throws(() => createSkill(dir, { name: "ok", description: "", instructions: "i" }), /description/);
  // Steps are NOT required. The new-skill form asks for a name and a trigger
  // and then opens the file for editing, so a skill legitimately exists for a
  // moment with no body.
  assert.doesNotThrow(() => createSkill(dir, { name: "no steps yet", description: "d" }));
  assert.equal(
    readSkill(dir, "no-steps-yet").content.includes("undefined"),
    false,
    "an absent body must not write the literal word undefined into the file",
  );
  assert.throws(
    () => createSkill(dir, { name: "ok", description: "d", instructions: "x".repeat(20001) }),
    /too long/,
  );
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

test("a built-in skill is reported as one, and is still editable and removable", () => {
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
  assert.doesNotThrow(() => editSkill(dir, "built-in", { description: "x", instructions: "y" }));
  assert.doesNotThrow(() => deleteSkill(dir, "built-in"));
  assert.equal(existsSync(join(dir, "built-in")), false);
});

test("an edit keeps the provenance that decides what a skill is", () => {
  const dir = scratchSkillsDir();
  createSkill(dir, { name: "mine", description: "first", instructions: "1. one" });
  editSkill(dir, "mine", { description: "second", instructions: "1. two" });

  const after = readSkill(dir, "mine");
  assert.equal(after.description, "second");
  assert.match(after.content, /1\. two/);
  // The bug this test exists for: origin is read back off `added_via`, so an
  // edit that replaced the whole file turned a custom skill into a built-in
  // one — and built-in ones cannot be deleted. An ordinary edit became a
  // one-way door.
  assert.equal(after.origin, "custom", "an edit must not turn a custom skill built-in");
  assert.doesNotThrow(() => deleteSkill(dir, "mine"));
});

test("an edit rewrites a block-scalar description instead of leaving two", () => {
  const dir = scratchSkillsDir();
  mkdirSync(join(dir, "folded"));
  writeFileSync(
    join(dir, "folded", "SKILL.md"),
    "---\nname: folded\ndescription: >\n  first line\n  second line\nadded_via: badger-ui\nlicense: MIT\n---\n\nbody\n",
  );
  editSkill(dir, "folded", { description: "replaced", instructions: "new body" });

  const after = readSkill(dir, "folded").content;
  assert.match(after, /description: replaced/);
  assert.equal(/first line/.test(after), false, "the folded block must go with the line it belonged to");
  assert.match(after, /license: MIT/, "frontmatter the pane never shows must survive a save");
});

test("a rename is refused rather than half-applied", () => {
  const dir = scratchSkillsDir();
  createSkill(dir, { name: "keep me", description: "d", instructions: "i" });
  // The runtime keys a skill by its directory, so a file whose name disagrees
  // with its folder is a skill the picker still offers under the old name.
  assert.throws(
    () => updateSkill(dir, "keep-me", "---\nname: renamed\ndescription: d\n---\n\ni\n"),
    /renaming is not supported/,
  );
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
