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
export function Markdown({ text, tone = "light" }: { text: string; tone?: "light" | "dark" }) {
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
                <li key={j}>{inline(line.replace(/^\s*[*-]\s+/, ""), tone)}</li>
              ))}
            </ul>
          );
        }

        const heading = block.match(/^(#{1,3})\s+(.*)$/);
        if (heading) {
          return (
            <p key={i} className="mt-4 font-semibold first:mt-0">
              {inline(heading[2], tone)}
            </p>
          );
        }

        return (
          <p key={i} className="mt-3 first:mt-0">
            {inline(block, tone)}
          </p>
        );
      })}
    </>
  );
}

/** Bold, inline code and links, in one pass. */
function inline(text: string, tone: "light" | "dark"): ReactNode {
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
              : tone === "dark"
                ? "rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[12px] text-amber-400"
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
          className={tone === "dark" ? "text-amber-400 underline" : "text-amber-700 underline"}
        >
          {link[1]}
        </a>
      );
    }

    return <Fragment key={i}>{part}</Fragment>;
  });
}
