import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { SkillPane } from "@/components/chat/SkillPane";
import { fetchSkills, type SkillInfo } from "@/lib/ask";

/**
 * Every skill the agent has.
 *
 * This page is the framework's thesis made clickable. Badger's skills are not
 * rows in a database — they are SKILL.md files in the agent's own git
 * repository, four written by hand and the rest written by the agent itself
 * after a question it expects to see again. Being able to open one and read it
 * is the difference between "the agent has skills" as a claim and as something
 * a reader can check.
 *
 * **A list, and almost nothing else.** It was grouped by origin with a
 * description under every name, and that is three kinds of noise for a page
 * whose whole job is "which skills exist, and let me open one". The origin is
 * now a quiet tag on the row that has it; the description belongs in the pane,
 * where there is room to read it; and the name is the slug, because the slug
 * is what you type after "/" and inventing a prettier label for it just gives
 * every skill two names.
 */
export function SkillsScreen() {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  /** `null` = closed, `""` = the new-skill form, a slug = that skill open. */
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchSkills()
      .then(setSkills)
      .catch(() => setSkills([]));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="flex h-dvh flex-col bg-white">
      <header className="shrink-0 px-6 pt-8 pb-4">
        <div className="mx-auto flex w-full max-w-[720px] items-center gap-4">
          <h1 className="text-[19px] font-semibold tracking-[-0.01em]">Skills</h1>
          <button
            onClick={() => setOpen("")}
            className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-stone-900 px-3 text-[12.5px] font-medium text-stone-50"
          >
            <Plus className="size-3.5" strokeWidth={2.2} />
            New skill
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-16">
        <div className="mx-auto w-full max-w-[720px]">
          {skills === null ? (
            <div className="flex animate-pulse flex-col">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="border-t border-stone-100 py-4">
                  <div className="h-4 w-40 rounded bg-stone-200/70" />
                </div>
              ))}
            </div>
          ) : (
            <ul className="flex flex-col">
              {skills.map((s) => (
                <li key={s.slug}>
                  <button
                    onClick={() => setOpen(s.slug)}
                    className="flex w-full items-center gap-2.5 border-t border-stone-100 py-3.5 text-left transition-colors hover:bg-stone-50"
                  >
                    <span className="truncate font-mono text-[13.5px]">{s.slug}</span>
                    {/* Where a skill came from, said on the row.
                        
                        "Built in" was the only badge, so a skill the agent
                        taught itself and one that shipped in the image looked
                        identical — and which is which is the single most
                        interesting fact on this screen. `origin` has carried
                        all three values since the store was written; only
                        two of them were being drawn. */}
                    {s.origin === "handwritten" && (
                      <span className="shrink-0 rounded-full border border-stone-200 px-1.5 py-px text-[10px] text-stone-400">
                        Built in
                      </span>
                    )}
                    {s.origin === "learned" && (
                      <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] text-emerald-700">
                        Learned
                      </span>
                    )}
                    {s.origin === "custom" && (
                      <span className="shrink-0 rounded-full border border-stone-200 px-1.5 py-px text-[10px] text-stone-500">
                        Added
                      </span>
                    )}
                    <ChevronRight
                      className="ml-auto size-4 shrink-0 text-stone-300"
                      strokeWidth={2}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {open !== null && (
        <>
          <div className="fixed inset-0 z-10 bg-stone-900/25" onClick={() => setOpen(null)} />
          <SkillPane
            slug={open || undefined}
            onClose={() => setOpen(null)}
            onChanged={load}
          />
        </>
      )}
    </div>
  );
}
