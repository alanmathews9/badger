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

/** Attach a `url` to each cited item that the run gave us enough to address. */
export function attachSourceUrls(items, opened, repo) {
  for (const item of items) {
    const url = sourceUrl(item, opened, repo);
    if (url) item.url = url;
  }
  return items;
}

function sourceUrl(item, opened, repo) {
  switch (item.kind) {
    case "issue":
      return repo && `https://github.com/${repo}/issues/${item.ref}`;
    case "pr":
      return repo && `https://github.com/${repo}/pull/${item.ref}`;
    case "file":
      return repo && `https://github.com/${repo}/blob/main/${item.ref}`;
    case "mail": {
      const thread = findOpened(opened, "mail", item.label);
      return thread && `https://mail.google.com/mail/u/0/#all/${thread.ref}`;
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
