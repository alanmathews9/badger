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
 * One entry per thing a reader would actually look for, which is why files and
 * commits are separate rather than one "Code": they answer different questions
 * — what does this file say, versus what changed and when — and the index
 * carries both kinds distinctly.
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
 * Exported because the source rail nests Drive by type and has to agree with
 * the dropdown exactly — two controls offering "Documents" and "Docs" for the
 * same set would read as two different filters.
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
 * **These filter the results already on screen, not the corpus.** Glean's
 * equivalents re-query; ours narrow the twenty rows the search returned, and
 * the menus only offer values those rows actually contain — a "Past week" that
 * nothing matches is not offered, and neither is an author nobody wrote. That
 * is the honest version of the feature at this size, and it is genuinely
 * useful for the thing it is for: a mixed list of twenty hits from three
 * systems is hard to scan, and "just the mail, from Priya" is one click.
 *
 * Making them re-query would mean teaching /api/search a filter grammar and
 * three source-specific translations of it — GitHub's qualifiers, Gmail's
 * syntax and Drive's `modifiedTime` — which is a feature, not a tidy-up.
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
  // Only offer what is actually there. A menu full of options that all lead to
  // an empty list is worse than no menu.
  const kinds = KINDS.filter((k) => rows.some((r) => k.id.includes(r.kind)));
  const authors = [...new Set(rows.map((r) => r.author).filter(Boolean))].sort();
  const windows = WINDOWS.filter(
    (w) =>
      w.days == null ||
      rows.some((r) => {
        const at = new Date(r.updatedAt).getTime();
        return !Number.isNaN(at) && Date.now() - at <= w.days! * 86_400_000;
      }),
  );

  if (kinds.length < 2 && authors.length < 2) return null;

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
      {kinds.length > 1 && (
        <Menu
          label={filters.kind ?? "Any type"}
          active={filters.kind != null}
          value={filters.kind ?? ""}
          options={[
            { value: "", label: "Any type" },
            ...kinds.map((k) => ({ value: k.label, label: k.label })),
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
 * It was a native `<select>` hidden behind a styled span, which was quick and
 * looked it: the browser's own menu ignores the app's type, spacing and
 * radius, and on macOS it renders as a system popup nothing else here
 * resembles. This is the shadcn/Radix menu the rest of the app already uses,
 * so a filter looks like the sidebar and the skill picker do.
 *
 * Single-choice, with a tick on the current value rather than a radio column —
 * these are one-of-N and the tick says so without a second bit of chrome.
 */
function Menu({
  label,
  active,
  options,
  value,
  onPick,
}: {
  label: string;
  active: boolean;
  options: { value: string; label: string }[];
  value: string;
  onPick: (value: string) => void;
}) {
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
        {label}
        <ChevronDown className="size-3.5 text-stone-400" strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {options.map((option, i) => (
          <div key={option.value}>
            {/* The "any" option is a reset rather than a peer of the others,
                so it sits above a rule. */}
            {i === 1 && <DropdownMenuSeparator />}
            <DropdownMenuCheckItem
              checked={option.value === value}
              onSelect={() => onPick(option.value)}
            >
              {option.label}
            </DropdownMenuCheckItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
