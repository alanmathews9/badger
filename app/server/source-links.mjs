// Recover a link to the real thing behind each cited source.
//
// GitHub citations carry their reference (an issue number, a path), so the
// address is a template away. Mail and documents are cited by subject and by
// name — the format RULES.md asks for — so their ids live on the opened item
// that produced them, matched with the same forgiving comparison the
// verifier uses. Anything unrecoverable is left without a url: the UI
// renders plain text, which beats a dead link.
//
// The links resolve only for someone with access to the private repository
// and the demo Google account. That is what "the actual source" means here —
// permissions stay enforced at the source, exactly as federation promises.
import { mentions } from "./verify-citations.mjs";

/**
 * Attach a `url` to each cited item that the run gave us enough to address.
 *
 * `mailbox` is the address of the connected Gmail account. Without it, mail
 * citations get no link at all — see the note on the mail case below.
 */
export function attachSourceUrls(items, opened, repo, { mailbox = null } = {}) {
  for (const item of items) {
    const url = sourceUrl(item, opened, repo, mailbox);
    if (url) item.url = url;
  }
  return items;
}

function sourceUrl(item, opened, repo, mailbox) {
  switch (item.kind) {
    case "issue":
      return repo && `https://github.com/${repo}/issues/${item.ref}`;
    case "pr":
      return repo && `https://github.com/${repo}/pull/${item.ref}`;
    case "file":
      return repo && `https://github.com/${repo}/blob/main/${item.ref}`;
    case "mail": {
      const thread = findOpened(opened, "mail", item.label);
      if (!thread) return null;
      // `/mail/u/0/` — which is what this used to emit, and what Onyx still
      // emits (`_build_document_link` in their gmail connector) — addresses a
      // mailbox by its POSITION in whatever Google accounts the reader happens
      // to be signed into. Position 0 is the reader's first account, which is
      // almost never the mailbox we indexed. The link does not fail; it opens
      // someone else's inbox, or a "no such conversation" page, and looks like
      // our data is wrong.
      //
      // `authuser=<address>` addresses it by identity instead. A reader signed
      // into that account lands on the thread whatever position it occupies;
      // one who is not gets Google's account chooser, which is an honest
      // outcome rather than a silently wrong one.
      //
      // With no mailbox known we emit NO link. A citation with no address
      // renders as plain text, and plain text beats a link that lies.
      if (!mailbox) return null;
      return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(mailbox)}#all/${thread.ref}`;
    }
    case "doc": {
      const doc = findOpened(opened, "doc", item.label);
      if (!doc) return null;
      const path = doc.detail === "spreadsheet" ? "spreadsheets" : "document";
      return `https://docs.google.com/${path}/d/${doc.ref}`;
    }
    default:
      return null;
  }
}

/**
 * The opened item this citation came from. An opened item whose label is
 * still its raw id (labelOpened recovered no name) cannot match a citation
 * by name — mentions() comparing a title against an id only matches by
 * coincidence, and a coincidence would link the wrong document.
 */
function findOpened(opened, kind, label) {
  return opened.find((o) => o.kind === kind && o.ref !== o.label && mentions(o.label, label));
}
