#!/usr/bin/env node
// Seed the Arkind corpus into the demo Google account: Drive folders, Google
// Docs, document comments, and Gmail threads.
//
// THIS SCRIPT IS WRITE-CAPABLE AND THE AGENT CANNOT REACH IT.
//
// Every tool named in WRITE_TOOLS below is deliberately absent from
// hooks/allowed-tools.txt and from the enable lists in tools/scripts/. The
// separation is the same one used to build the GitHub corpus: the corpus is
// created by a human running a script, and the agent only ever reads it.
//
// Note honestly what that separation is and is not. For GitHub the write path
// used a different credential entirely. For Google it cannot: Composio's
// managed Gmail auth grants `https://mail.google.com/` and Drive grants
// `.../drive`, and Google offers no narrower managed option — so the seeding
// session and the agent's session sit on the same OAuth grant, separated only
// by which tools each one enables. That is weaker, it is stated in the README,
// and it is why the agent's allowlist is by exact tool name.
//
//   node scripts/seed-google.mjs            # seed everything, refuses if present
//   node scripts/seed-google.mjs --drive    # Drive only
//   node scripts/seed-google.mjs --gmail    # Gmail only
//   node scripts/seed-google.mjs --force    # seed again even if it looks seeded
//   node scripts/seed-google.mjs --reset-gmail   # trash seeded mail, then stop
//
// --reset-gmail exists because a failed run leaves a partial mailbox and there
// is no way to make imports idempotent: every import creates a new message even
// when the Message-ID matches an existing one.
import { Composio, SessionPreset } from "@composio/core";
import { loadEnvFile } from "../tools/scripts/_env.mjs";
import { ROOT, FOLDERS, DOCS, SHEETS } from "./seed/corpus-drive.mjs";
import { THREADS } from "./seed/corpus-gmail.mjs";
import { P, addr } from "./seed/people.mjs";

loadEnvFile(new URL("../.env", import.meta.url));

const USER_ID = process.env.BADGER_USER_ID ?? "badger-demo-alan";

const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
const DO_DRIVE = !args.has("--gmail");
const DO_GMAIL = !args.has("--drive");

const RESET_GMAIL = args.has("--reset-gmail");
// Sheets were added after the documents were already seeded, so they need to
// be runnable on their own against an existing folder tree.
const SHEETS_ONLY = args.has("--sheets");

// There is deliberately no `googlesheets` entry here. Spreadsheets are created
// through Drive by asking it to convert a CSV on upload, so Sheets add no
// toolkit, no auth config and no connection — see seedSheets().
const WRITE_TOOLS = {
  gmail: [
    "GMAIL_IMPORT_MESSAGE",
    "GMAIL_ADD_LABEL_TO_EMAIL",
    "GMAIL_FETCH_EMAILS",
    "GMAIL_MOVE_TO_TRASH",
  ],
  googledrive: [
    "GOOGLEDRIVE_CREATE_FOLDER",
    "GOOGLEDRIVE_MOVE_FILE",
    "GOOGLEDRIVE_CREATE_COMMENT",
    "GOOGLEDRIVE_CREATE_REPLY",
    "GOOGLEDRIVE_FIND_FILE",
    "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT",
  ],
  googledocs: ["GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN"],
};

const composio = new Composio();
const session = await composio.create(USER_ID, {
  toolkits: Object.keys(WRITE_TOOLS),
  tools: Object.fromEntries(Object.entries(WRITE_TOOLS).map(([k, v]) => [k, { enable: v }])),
  sessionPreset: SessionPreset.DIRECT_TOOLS,
});

/** Execute, and fail loudly. A half-seeded corpus is worse than none. */
async function call(slug, params) {
  const res = await session.execute(slug, params);
  if (res?.error != null) {
    throw new Error(`${slug} failed: ${JSON.stringify(res.error).slice(0, 400)}`);
  }
  return res.data ?? {};
}

/**
 * Google's APIs return an id under a different key in almost every response
 * shape, and Composio wraps some of them again. Rather than hard-code one path
 * per tool, take the first plausible id.
 */
function idOf(data, ...preferred) {
  for (const k of [...preferred, "id", "fileId", "documentId", "file_id", "document_id"]) {
    const v = data?.[k] ?? data?.file?.[k] ?? data?.data?.[k] ?? data?.response_data?.[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- drive

async function seedDrive() {
  console.log(`\n=== Drive ===`);

  const existing = await call("GOOGLEDRIVE_FIND_FILE", {
    query: `name = '${ROOT}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  });
  const found = (existing.files ?? []).length;
  if (found && !FORCE) {
    console.log(`"${ROOT}" already exists — skipping Drive. Use --force to seed again.`);
    return;
  }

  const rootData = await call("GOOGLEDRIVE_CREATE_FOLDER", { folder_name: ROOT });
  const rootId = idOf(rootData);
  if (!rootId) throw new Error(`no folder id in response: ${JSON.stringify(rootData).slice(0, 300)}`);
  console.log(`folder  ${ROOT}  ${rootId}`);

  // Folder path -> id. Parents are created before children because FOLDERS is
  // declared parents-first.
  const folderId = new Map([["", rootId]]);
  for (const path of FOLDERS) {
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const name = path.slice(path.lastIndexOf("/") + 1);
    const data = await call("GOOGLEDRIVE_CREATE_FOLDER", {
      folder_name: name,
      parent_id: folderId.get(parent),
    });
    const id = idOf(data);
    folderId.set(path, id);
    console.log(`folder  ${ROOT}/${path}  ${id}`);
  }

  for (const doc of DOCS) {
    const data = await call("GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN", {
      title: doc.title,
      markdown_text: doc.md,
    });
    const fileId = idOf(data, "documentId");
    if (!fileId) throw new Error(`no document id: ${JSON.stringify(data).slice(0, 300)}`);

    // Docs are created in My Drive root; move them into place. `root` is the
    // Drive API's own alias for the top-level folder.
    await call("GOOGLEDRIVE_MOVE_FILE", {
      file_id: fileId,
      add_parents: folderId.get(doc.folder),
      remove_parents: "root",
    });
    console.log(`doc     ${doc.folder}/${doc.title}  ${fileId}`);

    for (const c of doc.comments ?? []) {
      const comment = await call("GOOGLEDRIVE_CREATE_COMMENT", {
        file_id: fileId,
        // Drive comments carry no author of our choosing — the API attributes
        // every comment to the authenticated account. The speaker is therefore
        // named in the text, exactly as the GitHub corpus does it.
        content: `${c.author}: ${c.content}`,
      });
      const commentId = idOf(comment, "commentId");
      for (const reply of c.replies ?? []) {
        await call("GOOGLEDRIVE_CREATE_REPLY", {
          file_id: fileId,
          comment_id: commentId,
          content: reply,
        });
      }
      console.log(`comment ${doc.title}  (+${(c.replies ?? []).length} replies)`);
    }
    await sleep(250); // Docs API is rate limited per minute; this stays under it.
  }
}

// --------------------------------------------------------------- sheets

/** Escape a value for a Drive query string, where the delimiter is a quote. */
const q = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Resolve "Clients/Verity" to a folder id by walking the tree from ROOT. */
async function resolveFolder(path) {
  let parentId = null;
  for (const name of [ROOT, ...path.split("/")]) {
    const clause = parentId ? ` and '${parentId}' in parents` : "";
    const res = await call("GOOGLEDRIVE_FIND_FILE", {
      query:
        `name = '${q(name)}' and mimeType = 'application/vnd.google-apps.folder'` +
        ` and trashed = false${clause}`,
    });
    const hit = (res.files ?? [])[0];
    if (!hit) throw new Error(`folder not found: ${ROOT}/${path} (missing "${name}")`);
    parentId = hit.id;
  }
  return parentId;
}

/**
 * Spreadsheets, without a Google Sheets integration.
 *
 * Drive converts an upload when the declared mime type is a Google Workspace
 * type, so handing CREATE_FILE_FROM_TEXT a CSV body with the spreadsheet mime
 * type produces a real Sheet. Declaring `text/csv` instead stores an ordinary
 * file that GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE then refuses to read —
 * measured, and the reason this function is explicit about the mime type.
 */
async function seedSheets() {
  console.log(`\n=== Sheets ===`);
  for (const sheet of SHEETS) {
    const existing = await call("GOOGLEDRIVE_FIND_FILE", {
      query: `name = '${q(sheet.title)}' and trashed = false`,
    });
    if ((existing.files ?? []).length && !FORCE) {
      console.log(`sheet   ${sheet.title} — already present, skipping`);
      continue;
    }
    const data = await call("GOOGLEDRIVE_CREATE_FILE_FROM_TEXT", {
      file_name: sheet.title,
      text_content: sheet.csv,
      mime_type: "application/vnd.google-apps.spreadsheet",
      parent_id: await resolveFolder(sheet.folder),
    });
    console.log(`sheet   ${sheet.folder}/${sheet.title}  ${idOf(data)}`);
    await sleep(250);
  }
}

// ---------------------------------------------------------------- gmail

/** One RFC 2822 message, base64url encoded as GMAIL_IMPORT_MESSAGE wants. */
function mime({ from, to, cc, date, subject, body, messageId, inReplyTo, references }) {
  const headers = [
    `Message-ID: ${messageId}`,
    `Date: ${date}`,
    `From: ${addr(from)}`,
    `To: ${to.map(addr).join(", ")}`,
    ...(cc?.length ? [`Cc: ${cc.map(addr).join(", ")}`] : []),
    `Subject: ${subject}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${references.join(" ")}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}\r\n`, "utf8").toString("base64url");
}

async function seedGmail() {
  console.log(`\n=== Gmail ===`);

  const probe = await call("GMAIL_FETCH_EMAILS", {
    query: `subject:"${THREADS[0].subject}"`,
    max_results: 1,
  });
  if ((probe.messages ?? []).length && !FORCE) {
    console.log("mail already seeded — skipping. Use --force to seed again.");
    return;
  }

  for (const thread of THREADS) {
    const references = [];
    let first = null;

    for (const [i, m] of thread.messages.entries()) {
      const messageId = `<${thread.id}-${i + 1}@arkind.dev>`;
      const raw = mime({
        ...m,
        // Gmail groups on In-Reply-To/References, but a matching subject keeps
        // the thread readable to a human scanning the list.
        subject: i === 0 ? thread.subject : `Re: ${thread.subject}`,
        messageId,
        inReplyTo: first,
        references: [...references],
      });
      if (!first) first = messageId;
      references.push(messageId);

      const res = await call("GMAIL_IMPORT_MESSAGE", {
        raw,
        never_mark_spam: true,
        // Without this, Gmail stamps every message with the import time and
        // the whole six-month timeline collapses into today.
        internal_date_source: "dateHeader",
      });
      const gmailId = idOf(res);

      // Imported mail carries no labels at all, so it exists but appears in no
      // view. Incoming mail gets INBOX.
      //
      // Priya's own messages get nothing: SENT is a Gmail system label and the
      // API refuses to add it ("Cannot modify immutable label(s): SENT"), which
      // is correct — only actually sending a message earns it. Unlabelled is
      // the better of the two available lies: the message still lives in All
      // Mail and still shows inside the thread, whereas labelling her replies
      // INBOX would put her own words in her inbox.
      if (m.from.email !== P.priya.email) {
        await call("GMAIL_ADD_LABEL_TO_EMAIL", { message_id: gmailId, add_label_ids: ["INBOX"] });
      }
      await sleep(200);
    }
    console.log(`thread  ${thread.subject}  (${thread.messages.length} messages)`);
  }
}

/**
 * Trash every seeded message.
 *
 * Scoped by sender domain rather than by a broad query, so nothing Google
 * itself sent to the account (security alerts, and anything a future connector
 * generates) is touched.
 */
async function resetGmail() {
  console.log("\n=== reset ===");
  let trashed = 0;
  for (const domain of ["arkind.dev", "haldenlogistics.nl"]) {
    // One page at a time: trashing changes the result set under the cursor, so
    // re-query from the start until a query returns nothing.
    for (;;) {
      const res = await call("GMAIL_FETCH_EMAILS", { query: `from:${domain}`, max_results: 50 });
      const msgs = res.messages ?? [];
      if (!msgs.length) break;
      for (const m of msgs) {
        await call("GMAIL_MOVE_TO_TRASH", { message_id: m.messageId ?? m.id });
        trashed++;
      }
    }
  }
  console.log(`trashed ${trashed} messages from the seeded domains.`);
}

if (RESET_GMAIL) {
  await resetGmail();
} else if (SHEETS_ONLY) {
  await seedSheets();
} else {
  if (DO_DRIVE) {
    await seedDrive();
    await seedSheets();
  }
  if (DO_GMAIL) await seedGmail();
}
console.log("\ndone.");
