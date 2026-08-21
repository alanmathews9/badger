import { Bot, FileText, Plus, SlidersHorizontal } from "lucide-react";
import type { AgentInfo, SkillInfo } from "@/lib/ask";

/**
 * The compact skills menu — opened by the plus, or by typing "/". Sized to
 * its content rather than the composer's width. Picking an item sets the
 * slash command on the input.
 *
 * Agents sit under their own heading below the skills. A skill shapes how
 * Badger answers; an agent answers instead of Badger, which is why the two are
 * separated rather than listed together.
 *
 * Rows are numbered skills first, then agents, then the two footers, and every
 * caller's keyboard wrap-around counts `skills.length + agents.length + 2`.
 */
export function SkillMenu({
  skills,
  agents = [],
  highlight,
  onPick,
  onPickAgent,
  onAdd,
  onManage,
}: {
  skills: SkillInfo[];
  agents?: AgentInfo[];
  highlight: number;
  onPick: (slug: string) => void;
  onPickAgent?: (slug: string) => void;
  onAdd: () => void;
  onManage: () => void;
}) {
  const footerAt = skills.length + agents.length;

  return (
    <div className="absolute bottom-full left-0 z-10 mb-2 max-h-[380px] w-72 overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-lg">
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

      {agents.length > 0 && (
        <div className="border-t border-stone-100 px-3.5 pt-2 pb-1 text-[10.5px] tracking-wide text-stone-400 uppercase">
          Agents
        </div>
      )}
      {agents.map((a, i) => (
        <button
          key={a.slug}
          onClick={() => onPickAgent?.(a.slug)}
          className={
            "flex w-full items-start gap-2.5 px-3.5 py-2 text-left hover:bg-stone-50 " +
            (skills.length + i === highlight ? "bg-stone-100" : "")
          }
        >
          <Bot className="mt-0.5 size-3.5 shrink-0 text-stone-400" strokeWidth={1.9} />
          <span className="min-w-0">
            <span className="block font-mono text-[12.5px] font-medium text-stone-900">
              {a.slug}
            </span>
            {a.role && (
              <span className="block truncate text-[11.5px] text-stone-500">{a.role}</span>
            )}
          </span>
        </button>
      ))}

      <button
        onClick={onAdd}
        className={
          "flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[12.5px] text-stone-600 hover:bg-stone-50 " +
          (footerAt > 0 ? "border-t border-stone-100 " : "") +
          (highlight === footerAt ? "bg-stone-100" : "")
        }
      >
        <Plus className="size-3.5" strokeWidth={2} />
        Add your own skill
      </button>
      <button
        onClick={onManage}
        className={
          "flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[12.5px] text-stone-600 hover:bg-stone-50 " +
          (highlight === footerAt + 1 ? "bg-stone-100" : "")
        }
      >
        <SlidersHorizontal className="size-3.5" strokeWidth={2} />
        Manage skills
      </button>
    </div>
  );
}
