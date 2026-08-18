import { Fragment, type ReactNode } from "react";

/**
 * A deliberately small Markdown renderer: paragraphs, bullets, bold, inline
 * code and links. Nothing else.
 *
 * Badger's answers use exactly that much, and a full library would parse and
 * render far more than the agent can emit — including raw HTML, which is the
 * one thing a model-authored string must never be able to inject. Everything
 * here is built from React elements, so nothing is ever set as innerHTML.
 *
 * The `[UNVERIFIED]` tag that verification adds is inline code, so it renders
 * through the code branch and stands out on its own.
 */
/** A source the answer cites, and the number its card carries. */
export type Citation = { token: string; index: number };

export function Markdown({ text, citations = [] }: { text: string; citations?: Citation[] }) {
  const blocks = String(text ?? "").split(/\n{2,}/);

  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const isList = lines.every((l) => /^\s*[*-]\s+/.test(l)) && lines.length > 0;

        if (isList) {
          return (
            <ul key={i} className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
              {lines.map((line, j) => (
                <li key={j}>{inline(line.replace(/^\s*[*-]\s+/, ""), citations)}</li>
              ))}
            </ul>
          );
        }

        const heading = block.match(/^(#{1,3})\s+(.*)$/);
        if (heading) {
          return (
            <p key={i} className="mt-4 font-semibold first:mt-0">
              {inline(heading[2], citations)}
            </p>
          );
        }

        return (
          <p key={i} className="mt-3 first:mt-0">
            {inline(block, citations)}
          </p>
        );
      })}
    </>
  );
}

/** Bold, inline code, links and citation markers, in one pass. */
function inline(text: string, citations: Citation[] = []): ReactNode {
  // Citation tokens are matched last in the alternation, so a "#2" inside a
  // code span or a link is consumed by those branches first and never gets a
  // marker attached to it.
  const refs = citations.map((c) => escapeRe(c.token)).join("|");
  const pattern = new RegExp(
    `(\\*\\*[^*]+\\*\\*|\`[^\`]+\`|\\[[^\\]]+\\]\\([^)\\s]+\\)${refs ? `|${refs}` : ""})`,
    "g",
  );

  return text.split(pattern).map((part, i) => {
    if (!part) return null;

    const citation = citations.find((c) => c.token === part);
    if (citation) {
      return (
        <span key={i}>
          {part}
          <a
            href={`#source-${citation.index}`}
            className="ml-0.5 align-super text-[11px] font-semibold text-amber-700 no-underline"
          >
            {citation.index}
          </a>
        </span>
      );
    }

    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      const body = part.slice(1, -1);
      // The verification tag is the one piece of inline code that is a warning
      // rather than a symbol, so it gets the warning colours.
      const unverified = body.includes("UNVERIFIED");
      return (
        <code
          key={i}
          className={
            unverified
              ? "rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-amber-900"
              : "rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[12px] text-stone-800"
          }
        >
          {body}
        </code>
      );
    }

    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="text-amber-700 underline"
        >
          {link[1]}
        </a>
      );
    }

    return <Fragment key={i}>{part}</Fragment>;
  });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
