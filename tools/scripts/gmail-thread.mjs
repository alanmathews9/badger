#!/usr/bin/env node
// gmail_thread — read a whole mail exchange, oldest first.
//
// The equivalent of github_issue: search finds a message, this reads the
// argument around it. On this corpus a single message is almost never the
// answer — what Halden were told and what Arkind concluded are four messages
// apart in the same thread.
import { exec, run, clip, contextFrom } from "./_google.mjs";
import { indexDocs, indexServes } from "./_index-tool.mjs";

run(async (args) => {
  const { thread_id, full } = args;
  if (!thread_id) return "ERROR: `thread_id` is required. Get one from gmail_search.";

  // Index first. The crawl stores one document per MESSAGE with its thread id
  // in meta, so a thread is those messages in date order — the same text the
  // live call returns, assembled locally.
  if (indexServes({ user: args._badger_user })) {
    const hit = indexDocs((d) => d.source === "gmail" && d.meta?.threadId === String(thread_id));
    if (hit) {
      const msgs = [...hit.rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return (
        hit.note +
        `thread ${thread_id} — ${msgs.length} message(s)\n` +
        `subject: ${msgs[0].title}\n\n` +
        msgs
          .map(
            (m, i) =>
              `[${i + 1}] ${m.meta?.sender ?? m.author} — ${m.date}\n` +
              `subject: ${m.title}\n${clip(m.body ?? "", 2500)}`,
          )
          .join("\n\n")
      );
    }
  }

  const { userId } = contextFrom(args);
  const data = await exec(
    "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
    { thread_id: String(thread_id), user_id: "me" },
    userId,
  );

  const messages = data.messages ?? [];
  if (!messages.length) return `Thread ${thread_id} has no messages, or does not exist.`;

  // Gmail returns thread messages in arrival order already, but the corpus was
  // imported rather than delivered, so sort explicitly on the header date.
  const sorted = [...messages].sort((a, b) =>
    String(a.messageTimestamp ?? "").localeCompare(String(b.messageTimestamp ?? "")),
  );

  const subject = sorted[0]?.subject ?? "(no subject)";
  const perMessage = full ? 4000 : 1200;

  const parts = sorted.map((m, i) => {
    const when = String(m.messageTimestamp ?? "").slice(0, 16).replace("T", " ");
    const body = String(m.messageText ?? "").replace(/\r/g, "").trim();
    return (
      `--- message ${i + 1} of ${sorted.length} ---\n` +
      `from: ${m.sender || "unknown"}\n` +
      `to:   ${m.to || "unknown"}\n` +
      `date: ${when}\n\n` +
      clip(body, perMessage)
    );
  });

  return (
    `thread ${thread_id} — "${subject}"\n` +
    `${sorted.length} messages, ${String(sorted[0]?.messageTimestamp ?? "").slice(0, 10)} to ` +
    `${String(sorted.at(-1)?.messageTimestamp ?? "").slice(0, 10)}\n\n` +
    parts.join("\n\n") +
    (full ? "" : "\n\n(messages clipped — call again with full: true if you need the complete text)")
  );
});
