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

        // A pipe table: a header row, a |---|---| separator, then rows. Without
        // this the whole block fell through to the paragraph branch below and
        // printed as a wall of pipes with the newlines collapsed — which is
        // what any answer comparing things across columns produced, and the
        // model reaches for a table unprompted whenever it is comparing.
        const table = parseTable(lines);
        if (table) {
          return (
            <div key={i} className="mt-3 -mx-1 overflow-x-auto px-1">
              <table className="w-full border-collapse text-left text-[13.5px]">
                <thead>
                  <tr>
                    {table.header.map((cell, j) => (
                      <th
                        key={j}
                        className="border-b border-stone-300 py-1.5 pr-4 align-bottom font-medium text-stone-900 last:pr-0"
                      >
                        {inline(cell)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, j) => (
                    <tr key={j}>
                      {row.map((cell, k) => (
                        <td
                          key={k}
                          className="border-b border-stone-100 py-1.5 pr-4 align-top text-stone-700 last:pr-0"
                        >
                          {inline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

/**
 * A pipe table, or null if these lines are not one.
 *
 * Deliberately strict: a header, a separator row of dashes, and at least one
 * body row. Anything looser and a sentence containing a stray pipe becomes a
 * one-column table. Ragged rows are padded rather than dropped — a model that
 * miscounts a cell should cost the reader an empty box, not the whole table.
 */
function parseTable(lines: string[]): { header: string[]; rows: string[][] } | null {
  if (lines.length < 3) return null;
  if (!lines.every((l) => l.trim().startsWith("|"))) return null;
  if (!/^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(lines[1])) return null;

  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const header = cells(lines[0]);
  const rows = lines.slice(2).map((l) => {
    const row = cells(l);
    while (row.length < header.length) row.push("");
    return row.slice(0, header.length);
  });
  return rows.length ? { header, rows } : null;
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


