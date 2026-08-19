// Deterministic tests for source link recovery — no keys, no network.
//
// A cited source should link to the real thing when the run gives us enough
// to build the address, and render as plain text when it does not. GitHub
// items carry their reference in the citation itself; mail and documents are
// cited by subject and by name, so their ids come from the matching opened
// item. A link we cannot build is omitted — a dead link is worse than none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { attachSourceUrls } from "../app/server/source-links.mjs";

const REPO = "alan-arkind/arkind";

test("issues and PRs link into the repository", () => {
  const items = [
    { kind: "issue", ref: "8", label: "Android shipped late" },
    { kind: "pr", ref: "30", label: "Sync rewrite, first attempt" },
  ];
  attachSourceUrls(items, [], REPO);
  assert.equal(items[0].url, "https://github.com/alan-arkind/arkind/issues/8");
  assert.equal(items[1].url, "https://github.com/alan-arkind/arkind/pull/30");
});

test("files link to the blob on main", () => {
  const items = [{ kind: "file", ref: "handbook/leave.md", label: "handbook/leave.md" }];
  attachSourceUrls(items, [], REPO);
  assert.equal(items[0].url, "https://github.com/alan-arkind/arkind/blob/main/handbook/leave.md");
});

test("no repository configured: GitHub items get no url", () => {
  const items = [{ kind: "issue", ref: "8", label: "#8" }];
  attachSourceUrls(items, [], null);
  assert.equal(items[0].url, undefined);
});

test("a document cited by name recovers its id from the opened item", () => {
  const items = [{ kind: "doc", ref: "Offboarding Checklist", label: "Offboarding Checklist" }];
  const opened = [{ kind: "doc", ref: "1AbC_dEf", label: "Offboarding Checklist", detail: "document" }];
  attachSourceUrls(items, opened, REPO);
  assert.equal(items[0].url, "https://docs.google.com/document/d/1AbC_dEf");
});

test("a spreadsheet links to the spreadsheets endpoint", () => {
  const items = [{ kind: "doc", ref: "Refund log", label: "Refund log" }];
  const opened = [{ kind: "doc", ref: "1Sheet", label: "Refund log 2026", detail: "spreadsheet" }];
  attachSourceUrls(items, opened, REPO);
  assert.equal(items[0].url, "https://docs.google.com/spreadsheets/d/1Sheet");
});

test("a mail thread cited by subject recovers its thread id", () => {
  const items = [{ kind: "mail", ref: "Re: March delivery", label: "Re: March delivery" }];
  const opened = [{ kind: "mail", ref: "18f2ab9cd", label: "Re: March delivery" }];
  attachSourceUrls(items, opened, REPO);
  assert.equal(items[0].url, "https://mail.google.com/mail/u/0/#all/18f2ab9cd");
});

test("no matching opened item: mail and documents stay unlinked", () => {
  const items = [
    { kind: "mail", ref: "Re: something never opened", label: "Re: something never opened" },
    { kind: "doc", ref: "Unopened doc", label: "Unopened doc" },
  ];
  attachSourceUrls(items, [], REPO);
  assert.equal(items[0].url, undefined);
  assert.equal(items[1].url, undefined);
});

test("an opened document whose label was never recovered cannot match", () => {
  // labelOpened leaves the raw file id as the label when the tool output gave
  // no name — matching a citation against an id would be a coincidence.
  const items = [{ kind: "doc", ref: "Offboarding Checklist", label: "Offboarding Checklist" }];
  const opened = [{ kind: "doc", ref: "1AbC_dEf", label: "1AbC_dEf" }];
  attachSourceUrls(items, opened, REPO);
  assert.equal(items[0].url, undefined);
});
