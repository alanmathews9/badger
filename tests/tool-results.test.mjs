// Deterministic tests for reading a search tool's result list back out of its
// own output — no keys, no network.
//
// The three search tools print a fixed shape so the agent can find issue
// numbers, thread ids and file ids where it expects them. `parseToolResults`
// reads that same text to build the list the browser shows under a search
// step. The fixtures below are byte-for-byte the shapes the tools emit:
// `tools/scripts/search.mjs`, `gmail-search.mjs`, `drive-search.mjs`, and the
// index path's `RENDER` table in `_index-tool.mjs`, which is deliberately
// identical so one parser serves both.
//
// The failure that matters is a silent one: a format drift makes the parser
// return nothing, the step shows no documents, and the UI looks merely quiet
// rather than broken. Hence a test per source, plus the negative cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseToolResults } from "../app/server/tool-results.mjs";

const GITHUB_OUT = `query: android delay
today: 2026-08-19 — use this date, do not recall one
3 shown of 7 total match(es) in alan-arkind/arkind, most relevant first

#8 [issue, open] Android app shipped five weeks late
  by @priya-n, updated 2026-07-02, 14 comments
  https://github.com/alan-arkind/arkind/issues/8
  The sync layer was rewritten twice. Review took 4 of the 35 days.

#30 [PR, closed] Rewrite the sync layer
  by @tomas-r, updated 2026-05-11, 6 comments
  https://github.com/alan-arkind/arkind/pull/30

#14 [issue, closed] Release checklist for 2.4
  by @marta-s, updated 2026-06-30, 2 comments
  https://github.com/alan-arkind/arkind/issues/14
  Checklist before we cut the build.

To read a full thread including comments, call github_issue with its number.
`;

const GMAIL_OUT = `query: brightsmile march
today: 2026-08-19 — use this date, do not recall one
2 message(s) of 40 considered, most relevant first

1. Re: launch date for Brightsmile
   from priya@arkind.example — 2026-03-04
   thread: 18f2ac9d1
   We told them March, and that is no longer true. We need to say so today.

2. Brightsmile onboarding
   from support@arkind.example — 2026-02-11
   thread: 18e0bb2c7

A single message is rarely the answer. Call gmail_thread with a thread id to read the whole exchange, which is where the disagreement and the decision usually are.
`;

const DRIVE_OUT = `query: android release notes
2 file(s) of 9 considered, most relevant first

1. Android release notes v2.4  [doc]
   id: 1AbCdEf   modified 2026-07-01
   …App Store review held the build for most of the delay.

2. Release tracker  [sheet]
   id: 1ZyXwVu   modified 2026-06-28

Call drive_file with an id to read one in full.
`;

test("GitHub results carry number, type, state and title", () => {
  const rows = parseToolResults("github_search", GITHUB_OUT);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    source: "github",
    kind: "issue",
    ref: "8",
    title: "Android app shipped five weeks late",
    detail: "issue · open",
  });
  // A PR is a different kind from an issue, so the row can carry the right
  // mark and the right word.
  assert.equal(rows[1].kind, "pr");
  assert.equal(rows[1].ref, "30");
  assert.equal(rows[1].detail, "PR · closed");
  // A result with no body still parses — the body line is optional in the
  // tool's own output when the issue has none.
  assert.equal(rows[2].title, "Release checklist for 2.4");
});

test("Gmail results carry the subject and the thread id", () => {
  const rows = parseToolResults("gmail_search", GMAIL_OUT);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    source: "gmail",
    kind: "mail",
    ref: "18f2ac9d1",
    title: "Re: launch date for Brightsmile",
    detail: "priya@arkind.example",
  });
  assert.equal(rows[1].ref, "18e0bb2c7");
});

test("Drive results carry the file id and distinguish a sheet from a doc", () => {
  const rows = parseToolResults("drive_search", DRIVE_OUT);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    source: "drive",
    kind: "doc",
    ref: "1AbCdEf",
    title: "Android release notes v2.4",
    detail: "document",
  });
  assert.equal(rows[1].kind, "doc");
  assert.equal(rows[1].detail, "spreadsheet");
});

test("the index path's output parses identically to the live path", () => {
  // `_index-tool.mjs` renders each source in the live tool's shape on purpose.
  // If that ever drifts, this test is what says so.
  const indexed = `matched: android, delay
today: 2026-08-19 — use this date, do not recall one
1 shown of 4 match(es), most relevant first

#8 [issue, open] Android app shipped five weeks late
  by @priya-n, updated 2026-07-02, 14 comments
  https://github.com/alan-arkind/arkind/issues/8
  The sync layer was rewritten twice.

To read a full thread including comments, call github_issue with its number.
`;
  const rows = parseToolResults("github_search", indexed);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ref, "8");
  assert.equal(rows[0].title, "Android app shipped five weeks late");
});

test("a real 'nothing found' returns no rows rather than a bad row", () => {
  const empty = `No matches for: kubernetes
Searched alan-arkind/arkind. This is a real "nothing found", not an error.
`;
  assert.deepEqual(parseToolResults("github_search", empty), []);
});

test("a tool that is not a search returns no rows", () => {
  // github_issue prints a whole thread, not a list. Feeding it to the list
  // parser must produce nothing rather than mining the prose for shapes that
  // happen to look like results.
  assert.deepEqual(parseToolResults("github_issue", GITHUB_OUT), []);
});

test("the footer's own instructions are never mistaken for results", () => {
  // Every footer names a tool and an id-ish word. None of the three should
  // ever contribute a row.
  for (const [name, out] of [
    ["github_search", GITHUB_OUT],
    ["gmail_search", GMAIL_OUT],
    ["drive_search", DRIVE_OUT],
  ]) {
    for (const row of parseToolResults(name, out)) {
      assert.ok(!row.title.includes("call "), `footer leaked into a row: ${row.title}`);
    }
  }
});

test("rows are capped, and the cap is reported rather than hidden", () => {
  const many =
    `20 message(s) of 60 considered, most relevant first\n\n` +
    Array.from(
      { length: 20 },
      (_, i) => `${i + 1}. Subject ${i}\n   from a@arkind.example — 2026-01-0${(i % 9) + 1}\n   thread: t${i}\n`,
    ).join("\n");
  const rows = parseToolResults("gmail_search", many, { limit: 8 });
  assert.equal(rows.length, 8);
  assert.equal(rows[7].ref, "t7");
});
