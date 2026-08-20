import { ChevronDown } from "lucide-react";
import type { SearchRow } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * What a row is, in the words a person would use.
 *
 * Files and commits are separate rather than one "Code": they answer different
 * questions, and the index carries both kinds distinctly.
 */
export const KINDS: { id: SearchRow["kind"][]; label: string }[] = [
  { id: ["issue"], label: "Issues" },
  { id: ["pr"], label: "Pull requests" },
  { id: ["file"], label: "Files" },
  { id: ["commit"], label: "Commits" },
  { id: ["mail"], label: "Mail" },
  { id: ["doc"], label: "Documents" },
  { id: ["sheet"], label: "Spreadsheets" },
  { id: ["folder"], label: "Folders" },
  { id: ["pdf"], label: "PDFs" },
];

/**
 * Which type group a row belongs to, in the same words the dropdown uses.
 *
 * Exported because the source rail nests Drive by type and must agree with the
 * dropdown exactly: "Documents" and "Docs" would read as two filters.
 */
export function kindGroupOf(row: SearchRow): string | null {
  return KINDS.find((k) => k.id.includes(row.kind))?.label ?? null;
}

const WINDOWS: { days: number | null; label: string }[] = [
  { days: null, label: "Anytime" },
  { days: 7, label: "Past week" },
  { days: 30, label: "Past month" },
  { days: 180, label: "Past 6 months" },
];

export type Filters = { kind: string | null; days: number | null; author: string | null };

export const NO_FILTERS: Filters = { kind: null, days: null, author: null };

/** Does a row survive the current filters? */
export function passes(row: SearchRow, filters: Filters): boolean {
  if (filters.kind) {
    const group = KINDS.find((k) => k.label === filters.kind);
    if (group && !group.id.includes(row.kind)) return false;
  }
  if (filters.days != null) {
    const at = new Date(row.updatedAt).getTime();
    if (Number.isNaN(at) || Date.now() - at > filters.days * 86_400_000) return false;
  }
  if (filters.author && row.author !== filters.author) return false;
  return true;
}

/**
 * Time, type and author, as three dropdowns under the search box.
 *
 * These filter the results ALREADY ON SCREEN, not the corpus, and the menus
 * only offer values those rows contain. Re-querying would mean a filter
 * grammar in /api/search plus three source-specific translations of it —
 * GitHub's qualifiers, Gmail's syntax and Drive's `modifiedTime`.
 */
export function SearchFilters({
  rows,
  filters,
  onChange,
}: {
  rows: SearchRow[];
  filters: Filters;
  onChange: (next: Filters) => void;
}) {
  // Every kind the corpus can hold, zeros included: an absent category cannot
  // be told apart from one the product does not have. A zero is information.
  // Zeros are disabled, so nothing offers a dead end.
  const countOf = (k: (typeof KINDS)[number]) =>
    rows.filter((r) => k.id.includes(r.kind)).length;
  const kinds = KINDS.map((k) => ({ ...k, count: countOf(k) }));
  const present = kinds.filter((k) => k.count > 0);
  const authors = [...new Set(rows.map((r) => r.author).filter(Boolean))].sort();
  const windows = WINDOWS.filter(
    (w) =>
      w.days == null ||
      rows.some((r) => {
        const at = new Date(r.updatedAt).getTime();
        return !Number.isNaN(at) && Date.now() - at <= w.days! * 86_400_000;
      }),
  );

  // Nothing to offer. The controls stay on screen so the header does not
  // change shape, but disabled: three menus whose only entry is their own
  // default are a dead control dressed as a feature.
  if (present.length < 2 && authors.length < 2) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Menu label="Anytime" disabled />
        <Menu label="Any type" disabled />
        <Menu label="Anyone" disabled />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {windows.length > 1 && (
        <Menu
          label={WINDOWS.find((w) => w.days === filters.days)?.label ?? "Anytime"}
          active={filters.days != null}
          value={String(filters.days)}
          options={windows.map((w) => ({ value: String(w.days), label: w.label }))}
          onPick={(value) => onChange({ ...filters, days: value === "null" ? null : Number(value) })}
        />
      )}
      {present.length > 1 && (
        <Menu
          label={filters.kind ?? "Any type"}
          active={filters.kind != null}
          value={filters.kind ?? ""}
          options={[
            { value: "", label: "Any type" },
            ...kinds.map((k) => ({
              value: k.label,
              label: k.label,
              count: k.count,
              disabled: k.count === 0,
            })),
          ]}
          onPick={(value) => onChange({ ...filters, kind: value || null })}
        />
      )}
      {authors.length > 1 && (
        <Menu
          label={filters.author ?? "Anyone"}
          active={filters.author != null}
          value={filters.author ?? ""}
          options={[
            { value: "", label: "Anyone" },
            ...authors.map((a) => ({ value: a, label: a })),
          ]}
          onPick={(value) => onChange({ ...filters, author: value || null })}
        />
      )}
      {(filters.kind || filters.days != null || filters.author) && (
        <button
          onClick={() => onChange(NO_FILTERS)}
          className="px-1.5 text-[12.5px] text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-stone-800"
        >
          Clear
        </button>
      )}
    </div>
  );
}

/**
 * One filter, as a dropdown.
 *
 * The shadcn/Radix menu the rest of the app uses, not a native `<select>`,
 * whose popup ignores the app's type, spacing and radius.
 *
 * Single-choice, with a tick on the current value rather than a radio column.
 */
function Menu({
  label,
  active = false,
  options,
  value,
  onPick,
  disabled = false,
}: {
  label: string;
  active?: boolean;
  options?: { value: string; label: string; count?: number; disabled?: boolean }[];
  value?: string;
  onPick?: (value: string) => void;
  /** On screen for the shape of the row, with nothing behind it to pick. */
  disabled?: boolean;
}) {
  const trigger = (
    <>
      {label}
      <ChevronDown className="size-3.5 text-stone-400" strokeWidth={2} />
    </>
  );

  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className="inline-flex h-8 cursor-default items-center gap-1.5 rounded-lg border border-stone-200 px-3 text-[12.5px] text-stone-400 opacity-60 select-none"
      >
        {trigger}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-stone-300",
          active
            ? "border-stone-300 bg-stone-100 font-medium text-stone-900"
            : "border-stone-200 text-stone-600 hover:bg-stone-50",
        )}
      >
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {(options ?? []).map((option, i) => (
          <div key={option.value}>
            {/* The "any" option is a reset rather than a peer of the others,
                so it sits above a rule. */}
            {i === 1 && <DropdownMenuSeparator />}
            <DropdownMenuCheckItem
              checked={option.value === value}
              disabled={option.disabled}
              onSelect={() => {
                if (!option.disabled) onPick?.(option.value);
              }}
            >
              <span className="flex w-full items-center justify-between gap-6">
                <span>{option.label}</span>
                {option.count != null && (
                  <span className="font-mono text-[11px] text-stone-400 tabular-nums">
                    {option.count}
                  </span>
                )}
              </span>
            </DropdownMenuCheckItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
