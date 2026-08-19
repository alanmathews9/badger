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
/**
 * The answer renders as plain prose. No inline citation markers of any kind.
 *
 * Two versions of that came and went. A superscript number said nothing a
 * reader could use without travelling to the bottom of the answer and back.
 * A named chip fixed that and introduced a worse problem: the chip's label is
 * the source's title, and the token it replaced is *also* the title, so any
 * answer that lists its sources by name printed every one of them twice —
 * once as a pill and once as the sentence it came from. Seen on a real answer
 * listing seven closed issues.
 *
 * The claim-to-source bond now lives entirely in the Sources line under the
 * answer. That loses which sentence rests on which source; the alternative
 * lost the ability to read the answer at all.
 */
export function Markdown({ text }: { text: string }) {
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
                <li key={j}>{inline(line.replace(/^\s*[*-]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }

        const heading = block.match(/^(#{1,3})\s+(.*)$/);
        if (heading) {
          return (
            <p key={i} className="mt-4 font-semibold first:mt-0">
              {inline(heading[2])}
            </p>
          );
        }

        return (
          <p key={i} className="mt-3 first:mt-0">
            {inline(block)}
          </p>
        );
      })}
    </>
  );
}

/** Bold, inline code and links, in one pass. */
function inline(text: string): ReactNode {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

  return text.split(pattern).map((part, i) => {
    if (!part) return null;

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


