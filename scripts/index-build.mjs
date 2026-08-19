#!/usr/bin/env node
// Build the local search index — `npm run index`, and `npm run index status`.
//
// Crawls everything the connected sources hold, through the SAME allowlisted
// read-only Composio slugs the agent's tools use — no new permissions, so any
// Composio key that can run Badger's tools can build its index. The result is
// one JSON file under .gitagent/index/ (gitignored runtime state; delete the
// directory and the copy is gone).
//
// Deliberately explicit about cost: every phase prints what it fetched and how
// many API calls it spent, and the final table compares what was STORED against
// what the live APIs REPORTED during the crawl — the corpus rule, applied here:
// verify against the source's own numbers, never against an exit code.
//
// A full build is a few hundred read calls and a couple of minutes, almost all
// of it Gmail/Drive body fetches. Run it deliberately; nothing rebuilds this
// implicitly.
import { exec as gh, asList, REPO_SLUG } from "../tools/scripts/_github.mjs";
import { exec as goog, exportText, isWorkspaceFile, kindOf } from "../tools/scripts/_google.mjs";
import { loadIndex, saveIndex, indexStatus, INDEX_FILE } from "../tools/scripts/_index.mjs";
import { pushIndex, dbConfigured } from "../tools/scripts/_index-db.mjs";
import { fileURLToPath } from "node:url";

// GitHub is optional: with no BADGER_GITHUB_REPO the crawl covers Gmail and
// Drive and says GitHub was skipped, rather than failing the whole build.
const [OWNER, REPO] = (REPO_SLUG ?? "/").split("/");
let apiCalls = 0;
const counted = async (fn) => { apiCalls += 1; return await fn(); };

/** Map over items with bounded concurrency — polite to three rate limits. */
async function pMap(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const day = (s) => String(s ?? "").slice(0, 10);
const flat = (s) => String(s ?? "").replace(/\r/g, "").trim();

// ── GitHub ────────────────────────────────────────────────────────────────

async function crawlGitHub() {
  const docs = [];
  const live = {};
  if (!REPO_SLUG) {
    console.log("  github: skipped — BADGER_GITHUB_REPO is not set");
    return { docs, live, skipped: true };
  }

  // One search call enumerates every issue and PR (verified: 30 of 30 in one
  // page). The search API allows 30 requests/minute; this is the only search
  // call in the whole build.
  const search = await counted(() =>
    gh("GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS", { q: `repo:${OWNER}/${REPO}`, per_page: 100 }),
  );
  const items = asList(search);
  live.issuesAndPrs = search.total_count ?? items.length;
  console.log(`  github: ${items.length} issues+PRs enumerated (API says ${live.issuesAndPrs})`);

  // Conversation comments fold into their issue's body: that is where this
  // corpus keeps its real answers, and folding them in is what lets BM25 see
  // them and the highlighter locate them — the thing GitHub's own search
  // reports as an unlocatable "matched somewhere in the discussion".
  let commentTotal = 0;
  await pMap(items, 5, async (item) => {
    const isPr = Boolean(item.pull_request);
    const data = await counted(() =>
      gh("GITHUB_LIST_ISSUE_COMMENTS", { owner: OWNER, repo: REPO, issue_number: item.number, per_page: 100 }),
    );
    const comments = asList(data);
    commentTotal += comments.length;

    let reviewComments = [];
    if (isPr) {
      const rc = await counted(() =>
        gh("GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST", { owner: OWNER, repo: REPO, pull_number: item.number, per_page: 100 }),
      );
      reviewComments = asList(rc);
      commentTotal += reviewComments.length;
    }

    const thread = [...comments, ...reviewComments]
      .map((c) => `— ${c.user?.login ?? "unknown"} (${day(c.created_at)}): ${flat(c.body)}`)
      .join("\n");

    const state = isPr && item.pull_request?.merged_at ? "merged" : (item.state ?? "");
    docs.push({
      id: `${isPr ? "pr" : "issue"}-${item.number}`,
      source: "github",
      type: isPr ? "pr" : "issue",
      title: item.title ?? "",
      body: [flat(item.body), thread].filter(Boolean).join("\n\n"),
      author: item.user?.login ?? "unknown",
      date: day(item.updated_at ?? item.created_at),
      url: item.html_url ?? "",
      meta: { number: item.number, state, comments: comments.length + reviewComments.length },
      vector: null,
    });
  });
  console.log(`  github: ${commentTotal} comments folded into their threads`);

  // Files, by walking the tree — code search does not serve private repos, so
  // enumeration by path is the only route, exactly as github_file works.
  const files = [];
  async function walk(path) {
    const data = await counted(() =>
      gh("GITHUB_GET_REPOSITORY_CONTENT", { owner: OWNER, repo: REPO, path }),
    );
    const payload = data.content ?? data;
    const entries = Array.isArray(payload) ? payload : [payload];
    for (const e of entries) {
      if (e.type === "dir") await walk(e.path);
      else if (e.type === "file") files.push(e.path);
    }
  }
  await walk("");
  live.files = files.length;

  await pMap(files, 5, async (path) => {
    const data = await counted(() =>
      gh("GITHUB_GET_REPOSITORY_CONTENT", { owner: OWNER, repo: REPO, path }),
    );
    const payload = data.content ?? data;
    const text = payload.content
      ? Buffer.from(String(payload.content), payload.encoding === "base64" ? "base64" : "utf8").toString("utf8")
      : "";
    docs.push({
      id: `ghfile-${path}`,
      source: "github",
      type: "file",
      title: path,
      body: flat(text),
      author: "",
      date: "",
      url: payload.html_url ?? "",
      meta: { path },
      vector: null,
    });
  });
  console.log(`  github: ${files.length} files read`);

  const commitData = await counted(() =>
    gh("GITHUB_LIST_COMMITS", { owner: OWNER, repo: REPO, per_page: 100 }),
  );
  const commits = asList(commitData);
  live.commits = commits.length;
  for (const c of commits) {
    const msg = flat(c.commit?.message);
    docs.push({
      id: `commit-${(c.sha ?? "").slice(0, 7)}`,
      source: "github",
      type: "commit",
      title: msg.split("\n")[0],
      body: msg,
      author: c.commit?.author?.name ?? c.author?.login ?? "unknown",
      date: day(c.commit?.author?.date),
      url: c.html_url ?? "",
      meta: { sha: c.sha },
      vector: null,
    });
  }
  console.log(`  github: ${commits.length} commits on main`);

  return { docs, live };
}

// ── Gmail ─────────────────────────────────────────────────────────────────

async function crawlGmail() {
  // One call returns the whole mailbox with bodies (verified: 58 messages,
  // empty nextPageToken). Paginate anyway — a real mailbox is bigger.
  const docs = [];
  let pageToken;
  let estimate = 0;
  do {
    const data = await counted(() =>
      goog("GMAIL_FETCH_EMAILS", {
        query: "", max_results: 100, include_payload: true, user_id: "me",
        ...(pageToken ? { page_token: pageToken } : {}),
      }),
    );
    estimate = data.resultSizeEstimate ?? estimate;
    for (const m of data.messages ?? []) {
      docs.push({
        id: `mail-${m.messageId}`,
        source: "gmail",
        type: "mail",
        title: m.subject || "(no subject)",
        body: flat(m.messageText),
        author: String(m.sender ?? "").replace(/\s*<[^>]*>/, "").trim() || "unknown",
        date: day(m.messageTimestamp),
        url: m.display_url ?? "",
        meta: { threadId: m.threadId ?? null, sender: m.sender ?? "", to: m.to ?? "" },
        vector: null,
      });
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  console.log(`  gmail: ${docs.length} messages in ${new Set(docs.map((d) => d.meta.threadId)).size} threads`);
  return { docs, live: { messages: docs.length, estimate } };
}

// ── Drive ─────────────────────────────────────────────────────────────────

async function crawlDrive() {
  const data = await counted(() =>
    goog("GOOGLEDRIVE_FIND_FILE", { query: "trashed = false", page_size: 100 }),
  );
  const all = data.files ?? [];
  const files = all.filter((f) => !String(f.mimeType ?? "").includes("folder"));
  console.log(`  drive: ${all.length} entries listed, ${files.length} files (${all.length - files.length} folders skipped)`);

  let commentThreads = 0;
  const docs = await pMap(files, 4, async (f) => {
    // Body: two hops per file (export returns a signed URL, then a download).
    let body = "";
    if (isWorkspaceFile(f.mimeType)) {
      try {
        body = flat(await counted(() => exportText(f.id, f.mimeType)));
        apiCalls += 1; // the download hop
      } catch (err) {
        console.log(`  drive: could not export ${f.name}: ${err.message}`);
      }
    }

    // The margins. Same fold as GitHub comments, same reason: the tidy
    // document and the argument about it must be one searchable text.
    let margins = "";
    try {
      const cd = await counted(() => goog("GOOGLEDRIVE_LIST_COMMENTS", { file_id: f.id, fields: "*" }));
      const comments = (cd.comments ?? []).filter((c) => !c.deleted);
      commentThreads += comments.length;
      margins = comments
        .map((c) => {
          const head = `— ${c.author?.displayName ?? "comment"} (${day(c.createdTime)}): ${flat(c.content)}`;
          const replies = (c.replies ?? []).filter((r) => !r.deleted)
            .map((r) => `  ↳ ${r.author?.displayName ?? ""} (${day(r.createdTime)}): ${flat(r.content)}`);
          return [head, ...replies].join("\n");
        })
        .join("\n");
    } catch (err) {
      console.log(`  drive: could not list comments on ${f.name}: ${err.message}`);
    }

    return {
      id: `drive-${f.id}`,
      source: "drive",
      type: kindOf(f.mimeType),
      title: f.name ?? "(unnamed)",
      body: [body, margins].filter(Boolean).join("\n\n"),
      author: "",
      date: day(f.modifiedTime),
      url: f.webViewLink ?? "",
      meta: { fileId: f.id, mimeType: f.mimeType ?? "" },
      vector: null,
    };
  });
  console.log(`  drive: ${commentThreads} comment threads folded in`);

  return { docs, live: { files: files.length, commentThreads } };
}

function countsOf(docs) {
  const of = (source, type) => docs.filter((d) => d.source === source && (!type || d.type === type)).length;
  return {
    github: { issues: of("github", "issue"), prs: of("github", "pr"), files: of("github", "file"), commits: of("github", "commit") },
    gmail: { messages: of("gmail") },
    drive: { files: of("drive") },
  };
}

// ── Incremental refresh ───────────────────────────────────────────────────
//
// "What changed since the last build?" per source, upserted into the store —
// a ~10–20 call tick instead of a 173-call rebuild, which is what makes a
// short cadence affordable (Onyx's own layering, sized down). Two honest
// limits, stated rather than hidden: deletions are invisible to it (none of
// the three sources offers a deleted-since query our allowlist reaches), and
// GitHub's `updated:` qualifier has day precision, so same-day items are
// re-fetched and deduped by id. The daily full rebuild is the sweep that
// catches what this cannot.

async function refreshGitHub(since) {
  const docs = [];
  if (!REPO_SLUG) return docs;
  const sinceDay = since.slice(0, 10);

  const search = await counted(() =>
    gh("GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS", {
      q: `repo:${OWNER}/${REPO} updated:>=${sinceDay}`,
      per_page: 100,
    }),
  );
  const items = asList(search);
  for (const item of items) {
    const isPr = Boolean(item.pull_request);
    const data = await counted(() =>
      gh("GITHUB_LIST_ISSUE_COMMENTS", { owner: OWNER, repo: REPO, issue_number: item.number, per_page: 100 }),
    );
    const comments = asList(data);
    let reviewComments = [];
    if (isPr) {
      const rc = await counted(() =>
        gh("GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST", { owner: OWNER, repo: REPO, pull_number: item.number, per_page: 100 }),
      );
      reviewComments = asList(rc);
    }
    const thread = [...comments, ...reviewComments]
      .map((c) => `— ${c.user?.login ?? "unknown"} (${day(c.created_at)}): ${flat(c.body)}`)
      .join("\n");
    docs.push({
      id: `${isPr ? "pr" : "issue"}-${item.number}`,
      source: "github",
      type: isPr ? "pr" : "issue",
      title: item.title ?? "",
      body: [flat(item.body), thread].filter(Boolean).join("\n\n"),
      author: item.user?.login ?? "unknown",
      date: day(item.updated_at ?? item.created_at),
      url: item.html_url ?? "",
      meta: {
        number: item.number,
        state: isPr && item.pull_request?.merged_at ? "merged" : (item.state ?? ""),
        comments: comments.length + reviewComments.length,
      },
      vector: null,
    });
  }

  const commitData = await counted(() =>
    gh("GITHUB_LIST_COMMITS", { owner: OWNER, repo: REPO, per_page: 100, since }),
  );
  const commits = asList(commitData);
  for (const c of commits) {
    const msg = flat(c.commit?.message);
    docs.push({
      id: `commit-${(c.sha ?? "").slice(0, 7)}`,
      source: "github",
      type: "commit",
      title: msg.split("\n")[0],
      body: msg,
      author: c.commit?.author?.name ?? c.author?.login ?? "unknown",
      date: day(c.commit?.author?.date),
      url: c.html_url ?? "",
      meta: { sha: c.sha },
      vector: null,
    });
  }

  // New commits mean file contents changed; re-fetch the paths those commits
  // touched... which LIST_COMMITS does not report. Re-reading the whole tree
  // (~30 calls) only when commits actually landed is the affordable middle.
  let filesReread = 0;
  if (commits.length) {
    const files = [];
    async function walk(path) {
      const data = await counted(() => gh("GITHUB_GET_REPOSITORY_CONTENT", { owner: OWNER, repo: REPO, path }));
      const payload = data.content ?? data;
      for (const e of Array.isArray(payload) ? payload : [payload]) {
        if (e.type === "dir") await walk(e.path);
        else if (e.type === "file") files.push(e.path);
      }
    }
    await walk("");
    await pMap(files, 5, async (path) => {
      const data = await counted(() => gh("GITHUB_GET_REPOSITORY_CONTENT", { owner: OWNER, repo: REPO, path }));
      const payload = data.content ?? data;
      const text = payload.content
        ? Buffer.from(String(payload.content), payload.encoding === "base64" ? "base64" : "utf8").toString("utf8")
        : "";
      docs.push({
        id: `ghfile-${path}`, source: "github", type: "file", title: path,
        body: flat(text), author: "", date: "", url: payload.html_url ?? "",
        meta: { path }, vector: null,
      });
    });
    filesReread = files.length;
  }

  console.log(`  github: ${items.length} issues/PRs updated, ${commits.length} new commits, ${filesReread} files re-read`);
  return docs;
}

async function refreshGmail(since) {
  // Gmail's after: takes epoch seconds, which keeps full precision — the
  // date form would re-fetch a whole day every tick.
  const epoch = Math.floor(Date.parse(since) / 1000);
  const data = await counted(() =>
    goog("GMAIL_FETCH_EMAILS", { query: `after:${epoch}`, max_results: 100, include_payload: true, user_id: "me" }),
  );
  const docs = (data.messages ?? []).map((m) => ({
    id: `mail-${m.messageId}`, source: "gmail", type: "mail",
    title: m.subject || "(no subject)",
    body: flat(m.messageText),
    author: String(m.sender ?? "").replace(/\s*<[^>]*>/, "").trim() || "unknown",
    date: day(m.messageTimestamp),
    url: m.display_url ?? "",
    meta: { threadId: m.threadId ?? null, sender: m.sender ?? "", to: m.to ?? "" },
    vector: null,
  }));
  console.log(`  gmail: ${docs.length} new messages`);
  return docs;
}

async function refreshDrive(since) {
  const data = await counted(() =>
    goog("GOOGLEDRIVE_FIND_FILE", { query: `modifiedTime > '${since}' and trashed = false`, page_size: 100 }),
  );
  const files = (data.files ?? []).filter((f) => !String(f.mimeType ?? "").includes("folder"));
  const docs = await pMap(files, 4, async (f) => {
    let body = "";
    if (isWorkspaceFile(f.mimeType)) {
      try {
        body = flat(await counted(() => exportText(f.id, f.mimeType)));
        apiCalls += 1;
      } catch (err) {
        console.log(`  drive: could not export ${f.name}: ${err.message}`);
      }
    }
    let margins = "";
    try {
      const cd = await counted(() => goog("GOOGLEDRIVE_LIST_COMMENTS", { file_id: f.id, fields: "*" }));
      margins = (cd.comments ?? []).filter((c) => !c.deleted)
        .map((c) => {
          const head = `— ${c.author?.displayName ?? "comment"} (${day(c.createdTime)}): ${flat(c.content)}`;
          const replies = (c.replies ?? []).filter((r) => !r.deleted)
            .map((r) => `  ↳ ${r.author?.displayName ?? ""} (${day(r.createdTime)}): ${flat(r.content)}`);
          return [head, ...replies].join("\n");
        }).join("\n");
    } catch (err) {
      console.log(`  drive: could not list comments on ${f.name}: ${err.message}`);
    }
    return {
      id: `drive-${f.id}`, source: "drive", type: kindOf(f.mimeType),
      title: f.name ?? "(unnamed)",
      body: [body, margins].filter(Boolean).join("\n\n"),
      author: "", date: day(f.modifiedTime), url: f.webViewLink ?? "",
      meta: { fileId: f.id, mimeType: f.mimeType ?? "" }, vector: null,
    };
  });
  console.log(`  drive: ${docs.length} files changed`);
  return docs;
}

async function refresh() {
  const index = loadIndex();
  if (!index) {
    console.log("No index to refresh — running a full build instead.");
    return false;
  }
  const since = index.refreshedAt ?? index.builtAt;
  console.log(`Refreshing the index — changes since ${since}…`);
  const startedAt = Date.now();

  const [ghDocs, gmDocs, drDocs] = await Promise.all([
    refreshGitHub(since), refreshGmail(since), refreshDrive(since),
  ]);
  const changed = [...ghDocs, ...gmDocs, ...drDocs];

  // Upsert: replace by id, append the new. Deletions survive until the next
  // full rebuild, and status says when that was.
  const byId = new Map(index.docs.map((d) => [d.id, d]));
  let updated = 0, added = 0;
  for (const doc of changed) {
    byId.has(doc.id) ? updated++ : added++;
    byId.set(doc.id, doc);
  }

  index.docs = [...byId.values()];
  index.counts = countsOf(index.docs);
  index.refreshedAt = new Date().toISOString();
  saveIndex(index);
  await store(index);

  console.log(
    `\n${updated} updated, ${added} added, ${index.docs.length} docs total — ` +
    `${apiCalls} API calls, ${((Date.now() - startedAt) / 1000).toFixed(0)}s. ` +
    `Full rebuild (the deletion sweep) last ran ${index.builtAt}.`,
  );
  return true;
}

/**
 * Write the index to Postgres as well as to disk, when a database is
 * configured. The file is what gets read — by the server's searcher and by
 * every agent tool subprocess — and Postgres is what lets that file be
 * recreated in one query after a container dies, instead of by crawling three
 * APIs again.
 *
 * A database failure is reported and does not fail the build: the index on
 * disk is complete and usable, and taking the build down over its backup
 * would be the tail wagging the dog.
 */
async function store(index) {
  if (!dbConfigured()) {
    console.log("\n  no DATABASE_URL — index written to disk only");
    return;
  }
  try {
    const { docs } = await pushIndex(index);
    console.log(`\n  stored ${docs} docs in Postgres`);
  } catch (err) {
    console.error(`\n  WARNING: could not store the index in Postgres: ${err.message}`);
    console.error("  The index on disk is fine. A cold start will rebuild by crawling instead.");
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const cmd = process.argv[2];

  if (cmd === "status") {
    const s = indexStatus();
    if (!s.exists) {
      console.log("No index. Search runs live and federated until `npm run index` builds one.");
      return;
    }
    const hours = (s.ageMs / 3_600_000).toFixed(1);
    console.log(`index at ${fileURLToPath(INDEX_FILE)}`);
    console.log(`built ${s.builtAt}, refreshed ${s.refreshedAt} (${hours}h ago) — ${s.docs} docs`);
    console.log(JSON.stringify(s.counts, null, 2));
    return;
  }
  if (cmd === "refresh") {
    if (await refresh()) return;
    // fall through to a full build when there is nothing to refresh
  } else if (cmd && cmd !== "build") {
    console.error(`unknown command "${cmd}" — use \`npm run index\` or \`npm run index status\``);
    process.exit(2);
  }

  console.log(
    `Building the local index from ${REPO_SLUG ?? "(no GitHub repo configured)"}, the connected mailbox, and Drive…`,
  );
  const startedAt = Date.now();

  // The three sources are independent providers; crawl them concurrently.
  const [github, gmail, drive] = await Promise.all([crawlGitHub(), crawlGmail(), crawlDrive()]);

  const docs = [...github.docs, ...gmail.docs, ...drive.docs];
  const counts = countsOf(docs);

  const buildMs = Date.now() - startedAt;
  const index = {
    version: 1,
    builtAt: new Date().toISOString(),
    repo: REPO_SLUG,
    buildMs,
    apiCalls,
    counts,
    docs,
  };
  const bytes = saveIndex(index);
  await store(index);

  // Stored vs what the live APIs reported during the crawl. A mismatch is a
  // build defect; say so and fail, rather than leaving a quietly partial index
  // that search would then trust.
  const checks = [
    ...(github.skipped
      ? []
      : [
          ["github issues+PRs", counts.github.issues + counts.github.prs, github.live.issuesAndPrs],
          ["github files", counts.github.files, github.live.files],
          ["github commits", counts.github.commits, github.live.commits],
        ]),
    ["gmail messages", counts.gmail.messages, gmail.live.messages],
    ["drive files", counts.drive.files, drive.live.files],
  ];
  console.log("\nstored vs live:");
  let ok = true;
  for (const [name, stored, live] of checks) {
    const pass = stored === live && stored > 0;
    ok &&= pass;
    console.log(`  ${pass ? "✓" : "✗"} ${name}: stored ${stored}, live ${live}`);
  }

  console.log(`\n${docs.length} docs, ${(bytes / 1024).toFixed(0)}KB, ${apiCalls} API calls, ${(buildMs / 1000).toFixed(0)}s`);
  if (!ok) {
    console.error("Count mismatch — the index was written but should not be trusted. Investigate before using it.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`index build failed: ${err.message}`);
  process.exit(1);
});
