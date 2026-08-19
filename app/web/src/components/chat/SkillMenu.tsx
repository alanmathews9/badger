import { FileText, Plus, SlidersHorizontal } from "lucide-react";
import type { SkillInfo } from "@/lib/ask";

/**
 * The compact skills menu — opened by the plus, or by typing "/". Sized to
 * its content rather than the composer's width. Picking an item sets the
 * slash command on the input.
 */
export function SkillMenu({
  skills,
  highlight,
  onPick,
  onAdd,
  onManage,
}: {
  skills: SkillInfo[];
  highlight: number;
  onPick: (slug: string) => void;
  onAdd: () => void;
  /** Open the manage page. There are two footer rows now, which is why every
      caller's keyboard wrap-around counts `skills.length + 2`. */
  onManage: () => void;
}) {
  return (
    <div className="absolute bottom-full left-0 z-10 mb-2 w-72 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg">
      {skills.map((s, i) => (
        <button
          key={s.slug}
          onClick={() => onPick(s.slug)}
          className={
            "flex w-full items-start gap-2.5 px-3.5 py-2 text-left hover:bg-stone-50 " +
            (i === highlight ? "bg-stone-100" : "")
          }
        >
          <FileText className="mt-0.5 size-3.5 shrink-0 text-stone-400" strokeWidth={1.9} />
          <span className="min-w-0">
            <span className="block font-mono text-[12.5px] font-medium text-stone-900">
              {s.slug}
            </span>
            {s.description && (
              <span className="block truncate text-[11.5px] text-stone-500">{s.description}</span>
            )}
          </span>
        </button>
      ))}
      <button
        onClick={onAdd}
        className={
          "flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[12.5px] text-stone-600 hover:bg-stone-50 " +
          (skills.length > 0 ? "border-t border-stone-100 " : "") +
          (highlight === skills.length ? "bg-stone-100" : "")
        }
      >
        <Plus className="size-3.5" strokeWidth={2} />
        Add your own skill
      </button>
      <button
        onClick={onManage}
        className={
          "flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[12.5px] text-stone-600 hover:bg-stone-50 " +
          (highlight === skills.length + 1 ? "bg-stone-100" : "")
        }
      >
        <SlidersHorizontal className="size-3.5" strokeWidth={2} />
        Manage skills
      </button>
    </div>
  );
}
