import { Fragment } from "react";

/**
 * Render a server-produced excerpt, turning <hi>…</hi> into bold.
 *
 * It used to be a <mark> with an amber background. On a page of results that
 * is a lot of colour for a fact the reader already knows — they typed the
 * query — and it fought the source marks and the state icons, which are the
 * two things on a row that carry information the reader does NOT have. Bold
 * says the same thing without competing. Glean does the same.
 *
 * The markers come from src/search.mjs, which knows what actually matched.
 * They are split on, never injected as HTML — the server is trusted to say
 * what matched, not to hand the browser markup to execute. A body containing
 * a literal "<hi>" is therefore harmless: it renders as text.
 */
export function Highlight({ text, tone = "strong" }: { text: string; tone?: "strong" | "inherit" }) {
  return (
    <>
      {text.split(/<hi>|<\/hi>/).map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className={tone === "inherit" ? "font-semibold" : "font-semibold text-stone-900"}>
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
