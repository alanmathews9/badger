import { Fragment } from "react";

/**
 * Render a server-produced excerpt, turning <hi>…</hi> into <mark>.
 *
 * The markers come from src/search.mjs, which knows what actually matched.
 * They are split on, never injected as HTML — the server is trusted to say
 * what matched, not to hand the browser markup to execute. A body containing
 * a literal "<hi>" is therefore harmless: it renders as text.
 */
export function Highlight({ text }: { text: string }) {
  return (
    <>
      {text.split(/<hi>|<\/hi>/).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-[3px] bg-amber-100 px-0.5 text-amber-900">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
