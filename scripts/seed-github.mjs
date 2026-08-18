#!/usr/bin/env node
// Seed the Arkind corpus into a fresh private GitHub repository: files, issues,
// comments, branches, pull requests, reviews, merges.
//
// THIS SCRIPT IS WRITE-CAPABLE AND THE AGENT CANNOT REACH IT.
//
// Every tool in WRITE_TOOLS below is deliberately absent from
// `hooks/allowed-tools.txt` and from the enable lists in `tools/scripts/`. The
// agent holds eight read tools; this holds eleven write ones, and the two lists
// do not intersect.
//
// **Why this script exists at all.** The corpus it replaces was built by hand,
// which is why it could never be reproduced, reviewed as a diff, or corrected
// without clicking through a browser. A corpus that is the ground truth for an
// eval set has to be source code.
//
//   node scripts/seed-github.mjs --dry-run   # print the plan, touch nothing
//   node scripts/seed-github.mjs             # create the repo and seed it
//   node scripts/seed-github.mjs --force     # seed into a repo that already exists
//
// There is no --reset. Deleting a repository needs the `delete_repo` scope,
// which this credential does not have and should not have; if a run goes wrong,
// delete the repository in the browser and run again. That asymmetry is
// deliberate — the seeder can build the demo and cannot destroy anything else.
//
// ---------------------------------------------------------------------------
// Two GitHub facts that shape the whole script.
//
// 1. **Issues and pull requests share one number sequence.** All 22 issues are
//    created before the first pull request so that PRs land on 23–30, exactly
//    as the corpus text refers to them. Every creation asserts the number it
//    got; a mismatch stops the run rather than producing a corpus whose own
//    cross-references are wrong.
//
// 2. **`created_at` cannot be backdated.** Only commits can, via
//    `author__date`. So every issue and PR will show today's date, and every
//    date that matters is written into the body text instead. This is stated in
//    the corpus files and in the README rather than hidden.
// ---------------------------------------------------------------------------

import { Composio, SessionPreset } from "@composio/core";
import { loadEnvFile } from "../tools/scripts/_env.mjs";
import { FILES, ISSUES, PULLS, REPO } from "./seed/corpus-github.mjs";
import { authorFor } from "./seed/company.mjs";

loadEnvFile(new URL("../.env", import.meta.url));

const USER_ID = process.env.BADGER_USER_ID ?? "badger-demo-alan";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const FORCE = args.has("--force");

const WRITE_TOOLS = [
  // diagnostics — read, but not the agent's reads
  "GITHUB_GET_THE_AUTHENTICATED_USER",
  "GITHUB_GET_A_REPOSITORY",
  "GITHUB_GET_REPOSITORY_CONTENT",
  "GITHUB_GET_A_REFERENCE",
  "GITHUB_LIST_REPOSITORY_ISSUES",
  "GITHUB_LIST_PULL_REQUESTS_FILES",
  // writes
  "GITHUB_CREATE_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER",
  "GITHUB_CREATE_A_BLOB",
  "GITHUB_CREATE_A_TREE",
  "GITHUB_CREATE_A_COMMIT",
  "GITHUB_UPDATE_A_REFERENCE",
  "GITHUB_CREATE_AN_ISSUE",
  "GITHUB_CREATE_AN_ISSUE_COMMENT",
  "GITHUB_UPDATE_AN_ISSUE",
  "GITHUB_CREATE_A_REFERENCE",
  "GITHUB_CREATE_A_PULL_REQUEST",
  "GITHUB_UPDATE_A_PULL_REQUEST",
  "GITHUB_MERGE_A_PULL_REQUEST",
  "GITHUB_CREATE_A_REVIEW_COMMENT_FOR_A_PULL_REQUEST",
];

const { owner, name: repo } = REPO;

// GitHub's secondary rate limit is roughly 80 content-creating requests a
// minute and it answers with a 403 that looks nothing like a rate limit. 900ms
// keeps us at ~66/min with no bursting, which costs a few minutes of wall clock
// and buys a run that finishes.
const PACE_MS = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------- plan

/** What a run would do, without a session or a network call. */
function plan() {
  const prFiles = PULLS.flatMap((p) => p.files);
  const comments = ISSUES.reduce((n, i) => n + i.comments.length, 0);
  const prComments = PULLS.reduce((n, p) => n + (p.comments?.length ?? 0), 0);
  const reviews = PULLS.reduce((n, p) => n + (p.reviewComments?.length ?? 0), 0);

  console.log(`repository        ${owner}/${repo} (private)`);
  console.log(`files on main     ${FILES.length}`);
  console.log(`issues            ${ISSUES.length}  (#1–#${ISSUES.length}), ${comments} comments`);
  console.log(`  closed          ${ISSUES.filter((i) => i.state === "closed").length}`);
  console.log(`  open            ${ISSUES.filter((i) => i.state !== "closed").length}`);
  console.log(`pull requests     ${PULLS.length}  (#${PULLS[0].number}–#${PULLS.at(-1).number})`);
  console.log(`  merged          ${PULLS.filter((p) => p.merge).length}`);
  console.log(`  left open       ${PULLS.filter((p) => !p.merge && !p.close).length}`);
  console.log(`  closed unmerged ${PULLS.filter((p) => p.close).length}`);
  console.log(`branch commits    ${prFiles.length}`);
  console.log(`pr comments       ${prComments} + ${reviews} review comments`);

  // Four calls per file commit: blob, tree, commit, ref.
  const total = (FILES.length + prFiles.length) * 4 + ISSUES.length + comments +
    PULLS.length * 3 + prComments + reviews;
  console.log(`\n~${total} write calls, ~${Math.ceil((total * PACE_MS) / 60000)} minutes at ${PACE_MS}ms pacing.`);
}

if (DRY_RUN) {
  plan();
  process.exit(0);
}

// ---------------------------------------------------------------- session

const composio = new Composio();
const session = await composio.create(USER_ID, {
  toolkits: ["github"],
  tools: { github: { enable: WRITE_TOOLS } },
  sessionPreset: SessionPreset.DIRECT_TOOLS,
});

/** Execute, and fail loudly. A half-seeded repository is worse than none. */
async function call(slug, params) {
  const res = await session.execute(slug, params);
  if (res?.error != null) {
    throw new Error(`${slug} failed: ${JSON.stringify(res.error).slice(0, 500)}`);
  }
  return res.data ?? {};
}

/** Execute and pace, for anything that creates content. */
async function write(slug, params) {
  const data = await call(slug, params);
  await sleep(PACE_MS);
  return data;
}

/** Composio wraps some responses and not others. Take the first plausible key. */
const pick = (data, ...keys) => {
  for (const k of keys) {
    const v = data?.[k] ?? data?.data?.[k] ?? data?.response_data?.[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};

// ------------------------------------------------------- guard: the account
//
// The credential must be the single-repository demo account. Seeding into the
// wrong account is the one mistake here that cannot be undone with this tool
// set, because nothing in WRITE_TOOLS can delete a repository.

const me = await call("GITHUB_GET_THE_AUTHENTICATED_USER", {});
const login = pick(me, "login");
if (login !== owner) {
  throw new Error(
    `authenticated as "${login}", expected "${owner}".\n` +
      `Composio picks one connected account per toolkit and cannot be told which ` +
      `(measured 2026-08-18: the 'account' execute option is disabled on this ` +
      `project). Disconnect the other GitHub connection and try again.`,
  );
}
console.log(`account   ${login}`);

// ------------------------------------------------------- guard: the repo

let repoExists = true;
try {
  await call("GITHUB_GET_A_REPOSITORY", { owner, repo });
} catch {
  repoExists = false;
}

if (repoExists && !FORCE) {
  const issues = await call("GITHUB_LIST_REPOSITORY_ISSUES", { owner, repo, per_page: 1 });
  const any = Array.isArray(pick(issues, "items", "issues")) || Array.isArray(issues);
  throw new Error(
    `${owner}/${repo} already exists${any ? " and has issues" : ""}. ` +
      `Delete it in the browser, or pass --force to seed into it anyway.`,
  );
}

if (!repoExists) {
  await write("GITHUB_CREATE_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER", {
    name: repo,
    private: true,
    description: "Appointment booking for small clinics. Booking, reminders, deposits.",
    // The first commit has to come from somewhere; every later write updates
    // against a sha, and an empty repository has no default branch to update.
    auto_init: true,
    has_issues: true,
    has_wiki: false,
    has_projects: false,
    delete_branch_on_merge: false, // PR branches stay browsable after merge.
    // Every merge below is a rebase, because a squash would rewrite the
    // branch's authored dates to now and undo the whole Git Data path above.
    // Rebase is on by default; saying so makes the dependency explicit rather
    // than leaving it to a default that could change.
    allow_rebase_merge: true,
  });
  console.log(`repo      created ${owner}/${repo} (private)`);
  await sleep(2000); // auto_init's commit is not instantly visible to contents.
}

// --------------------------------------------------------------- helpers

/**
 * Commit one file, with a real authored date.
 *
 * This goes the long way round — blob, tree, commit, move the ref — instead of
 * the one-call contents API, and the reason is measured rather than stylistic.
 *
 * **`GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS` silently discards `author__date`.**
 * The parameter is in its schema, it is documented as an ISO 8601 timestamp,
 * and the commit comes back stamped with the time of the API call. So does
 * `committer__date`. Author *name* and *email* are honoured; only the dates are
 * dropped. Verified 2026-08-18 by writing two files, one with author dates and
 * one with both author and committer dates: both landed on today.
 *
 * `GITHUB_CREATE_A_COMMIT` honours both, verified the same way. Four calls a
 * file instead of one, and in exchange the history is real — which matters
 * because `github_commits` is one of the agent's five tools and "what shipped
 * last week" is meaningless when every commit landed this morning.
 *
 * `base_tree` officially wants a tree SHA; a commit SHA works and GitHub
 * resolves it. Also verified rather than assumed.
 */
async function putFile({ path, content, message, date, branch, author }) {
  const ref = `heads/${branch ?? "main"}`;
  const parent = await headOf(branch ?? "main");
  const who = author ?? authorFor(path);

  const blob = await write("GITHUB_CREATE_A_BLOB", {
    owner,
    repo,
    content: Buffer.from(content, "utf8").toString("base64"),
    encoding: "base64",
  });
  const tree = await write("GITHUB_CREATE_A_TREE", {
    owner,
    repo,
    base_tree: parent,
    tree: [{ path, mode: "100644", type: "blob", sha: pick(blob, "sha") }],
  });
  const commit = await write("GITHUB_CREATE_A_COMMIT", {
    owner,
    repo,
    message,
    tree: pick(tree, "sha"),
    parents: [parent],
    author__name: who.name,
    author__email: who.email,
    committer__name: who.name,
    committer__email: who.email,
    ...(date ? { author__date: date, committer__date: date } : {}),
  });
  const sha = pick(commit, "sha");

  // `heads/main`, not `refs/heads/main`, despite the tool's own description
  // saying "fully qualified" and giving `refs/heads/main` as the example.
  // Composio drops this straight into the URL path — the same place
  // GITHUB_GET_A_REFERENCE takes it — so the qualified form asks GitHub for
  // `git/refs/refs/heads/main` and comes back 422 "Reference does not exist".
  // Measured 2026-08-18, and it cost a run. GITHUB_CREATE_A_REFERENCE is the
  // opposite and does want `refs/heads/...`: there the ref travels in the body,
  // exactly as in GitHub's own API.
  await write("GITHUB_UPDATE_A_REFERENCE", { owner, repo, ref, sha });
  return sha;
}

const headOf = async (branch = "main") => {
  const ref = await call("GITHUB_GET_A_REFERENCE", { owner, repo, ref: `heads/${branch}` });
  return pick(pick(ref, "object") ?? {}, "sha");
};

/**
 * The line each review comment will hang from, one per file in the PR.
 *
 * A review comment on GitHub belongs to a line, not to a file. GitHub itself
 * has an escape hatch — `subject_type: "file"` — and **Composio's wrapper does
 * not accept it**: the parameter is absent from the tool schema and the call
 * 422s demanding a `line`. Measured 2026-08-18, and it cost a run.
 *
 * Guessing a line does not work either. `line` is validated against the diff,
 * so any number outside a hunk is a 422, and the corpus's comments are about
 * files whose first change is often nowhere near the top.
 *
 * So read the answer out of the pull request instead of inventing it: fetch the
 * diff GitHub itself computed and take the first line each file actually adds.
 * That line is inside a hunk by construction, so the comment always lands.
 *
 * Two shapes measured against the live API rather than assumed:
 *   - the payload arrives under `details`, not `files` (every Composio GitHub
 *     tool uses a different key), each entry `{ filename, patch, status }`;
 *   - `patch` is a unified diff whose hunk headers are `@@ -a,b +c,d @@`. The
 *     new-file line number advances on context and added lines and stands
 *     still on removals, which is what the walk below does.
 *
 * A file with no `patch` (binary, or too large for GitHub to diff) is skipped
 * and its comment falls back to line 1 at the call site.
 */
async function reviewAnchors(pullNumber) {
  const res = await call("GITHUB_LIST_PULL_REQUESTS_FILES", {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });
  const files = pick(res, "details", "files") ?? (Array.isArray(res) ? res : []);

  const anchors = new Map();
  for (const f of files) {
    const line = firstAddedLine(f?.patch);
    if (f?.filename && line != null) anchors.set(f.filename, line);
  }
  return anchors;
}

/** The new-file line number of the first `+` line in a unified diff. */
function firstAddedLine(patch) {
  if (!patch) return null;
  let lineNo = null;
  for (const row of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (hunk) {
      lineNo = Number(hunk[1]);
      continue;
    }
    if (lineNo == null) continue;
    if (row.startsWith("+")) return lineNo;
    if (row.startsWith("-") || row.startsWith("\\")) continue; // removal, or "No newline at end of file"
    lineNo += 1; // context
  }
  return null;
}

// ------------------------------------------------------------------ files

console.log(`\n=== files (${FILES.length}) ===`);
for (const file of FILES) {
  await putFile(file);
  console.log(`  ${file.path}`);
}

// ----------------------------------------------------------------- issues
//
// All of them, before any pull request, so the numbering works out. Comments
// are written before the issue is closed, so that a closing comment is the last
// thing in the thread rather than sitting after the close.

console.log(`\n=== issues (${ISSUES.length}) ===`);
for (const issue of ISSUES) {
  const created = await write("GITHUB_CREATE_AN_ISSUE", {
    owner,
    repo,
    title: issue.title,
    body: issue.body,
    labels: issue.labels,
  });
  const number = pick(created, "number");
  if (number !== issue.number) {
    throw new Error(
      `issue numbering drifted: expected #${issue.number}, GitHub assigned #${number}. ` +
        `The corpus text cross-references these numbers, so stopping here.`,
    );
  }

  for (const body of issue.comments) {
    await write("GITHUB_CREATE_AN_ISSUE_COMMENT", { owner, repo, issue_number: number, body });
  }

  if (issue.state === "closed") {
    await write("GITHUB_UPDATE_AN_ISSUE", {
      owner,
      repo,
      issue_number: number,
      state: "closed",
      state_reason: "completed",
    });
  }
  console.log(`  #${number} ${issue.state === "closed" ? "[closed]" : "[open]  "} ${issue.title}`);
}

// ---------------------------------------------------------- pull requests

console.log(`\n=== pull requests (${PULLS.length}) ===`);
for (const pr of PULLS) {
  // Branch from whatever main is now — the previous merge moved it.
  await write("GITHUB_CREATE_A_REFERENCE", {
    owner,
    repo,
    ref: `refs/heads/${pr.branch}`,
    sha: await headOf("main"),
  });

  let head;
  for (const file of pr.files) {
    head = (await putFile({ ...file, branch: pr.branch, author: pr.author })) ?? head;
  }

  // Draft pull requests are not available on private repositories for every
  // plan, and the failure is a 422 rather than anything descriptive. Fall back
  // to an ordinary open PR: the corpus says "draft" in the title and the body,
  // so the meaning survives even when the flag does not.
  let created;
  try {
    created = await write("GITHUB_CREATE_A_PULL_REQUEST", {
      owner,
      repo,
      title: pr.title,
      body: pr.body,
      head: pr.branch,
      base: "main",
      ...(pr.draft ? { draft: true } : {}),
    });
  } catch (err) {
    if (!pr.draft) throw err;
    console.log(`  (draft unavailable on this plan — opening #${pr.number} as a normal PR)`);
    created = await write("GITHUB_CREATE_A_PULL_REQUEST", {
      owner,
      repo,
      title: pr.title,
      body: pr.body,
      head: pr.branch,
      base: "main",
    });
  }

  const number = pick(created, "number");
  if (number !== pr.number) {
    throw new Error(
      `pull request numbering drifted: expected #${pr.number}, GitHub assigned #${number}.`,
    );
  }
  const headSha = pick(pick(created, "head") ?? {}, "sha") ?? head;

  // Anchored to a line read out of the diff — see reviewAnchors.
  const anchors = pr.reviewComments?.length ? await reviewAnchors(number) : new Map();
  for (const rc of pr.reviewComments ?? []) {
    await write("GITHUB_CREATE_A_REVIEW_COMMENT_FOR_A_PULL_REQUEST", {
      owner,
      repo,
      pull_number: number,
      body: rc.body,
      path: rc.path,
      commit_id: headSha,
      line: anchors.get(rc.path) ?? 1, // ?? 1 is unreachable in practice: the
      // file is in the PR by construction. Kept so a typo'd path fails as one
      // rejected comment rather than as a crash mid-run.
      side: "RIGHT",
    });
  }

  for (const body of pr.comments ?? []) {
    await write("GITHUB_CREATE_AN_ISSUE_COMMENT", { owner, repo, issue_number: number, body });
  }

  if (pr.merge) {
    // Mergeability is computed asynchronously; merging too soon answers 405
    // "Base branch was modified" or "not mergeable" on a PR that is perfectly
    // fine a second later.
    for (let attempt = 1; ; attempt++) {
      try {
        await write("GITHUB_MERGE_A_PULL_REQUEST", {
          owner,
          repo,
          pull_number: number,
          // Rebase, not squash. A squash creates one new commit authored by
          // the token account and dated now, which would throw away every
          // authored date on the branch — the exact thing the Git Data path
          // above exists to preserve. Rebase replays the commits onto main with
          // their author dates intact.
          merge_method: pr.mergeMethod ?? "rebase",
        });
        break;
      } catch (err) {
        if (attempt >= 4) throw err;
        await sleep(2500 * attempt);
      }
    }
  } else if (pr.close) {
    await write("GITHUB_UPDATE_A_PULL_REQUEST", { owner, repo, pull_number: number, state: "closed" });
  }

  const state = pr.merge ? "[merged]" : pr.close ? "[closed]" : "[open]  ";
  console.log(`  #${number} ${state} ${pr.title}`);
}

console.log(`\ndone. https://github.com/${owner}/${repo}`);
console.log(
  `\nVerify before deleting anything old:\n` +
    `  npm run composio:call -- GITHUB_LIST_REPOSITORY_ISSUES '{"owner":"${owner}","repo":"${repo}","state":"all"}'`,
);
