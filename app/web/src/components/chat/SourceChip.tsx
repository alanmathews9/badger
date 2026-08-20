import { BRAND_LOGOS, DriveMark } from "@/components/BrandLogos";
import type { SourceId } from "@/lib/api";
import type { FoundDoc, OpenedItem } from "@/lib/ask";

/**
 * Which system an item came from. GitHub is the default, not the only one.
 * Shared by every surface that draws a source mark, so a new kind is added in
 * one place rather than in three.
 */
export const SOURCE_OF: Record<OpenedItem["kind"], SourceId> = {
  issue: "github",
  pr: "github",
  file: "github",
  mail: "gmail",
  doc: "drive",
};

/**
 * One document a search found, as a row inside that step's result card.
 *
 * Deliberately quieter than the Sources line under the answer: these are what
 * Badger *had*, not what the answer stands on. The distinction is the honesty
 * signal this project already keeps as "opened but not cited", and flattening
 * the two registers would lose it.
 */
export function FoundRow({ doc }: { doc: FoundDoc }) {
  const Logo = BRAND_LOGOS[doc.source];
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px]">
      {/* Drive says which kind it is, the way the results list already does —
          a Docs page, a Sheets grid, a folder. `badge={false}` because at 12px
          the Drive triangle tucked into the corner is a smudge, and the row
          already sits under a "Searched Drive" heading saying where it came
          from. Anything Drive cannot name still falls back to the triangle. */}
      {doc.source === "drive" ? (
        <DriveMark kind={doc.kind} size={13} badge={false} />
      ) : (
        <Logo size={12} className="shrink-0" />
      )}
      {doc.kind === "issue" || doc.kind === "pr" ? (
        <span className="shrink-0 font-mono text-[11.5px] text-stone-400">#{doc.ref}</span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-stone-700">{doc.title}</span>
      {doc.detail && (
        <span className="hidden shrink-0 text-[11px] text-stone-400 sm:inline">{doc.detail}</span>
      )}
    </div>
  );
}
