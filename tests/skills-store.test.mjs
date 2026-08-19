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
import { listSkills, createSkill, slugify } from "../app/server/skills-store.mjs";

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
  assert.throws(() => createSkill(dir, { name: "ok", description: "d", instructions: "" }), /instructions/);
  assert.throws(
    () => createSkill(dir, { name: "ok", description: "d", instructions: "x".repeat(20001) }),
    /too long/,
  );
});
