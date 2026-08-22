import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { SkillPane } from "@/components/chat/SkillPane";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { downloadSkill, fetchSkill, fetchSkills, removeSkill, type SkillInfo } from "@/lib/ask";

/**
 * Every skill the agent has, as a table.
 *
 * This page is the framework's thesis made clickable. Badger's skills are not
 * rows in a database — they are SKILL.md files in the agent's own git
 * repository, four written by hand and the rest written by the agent itself
 * after a question it expects to see again. Being able to open one and read it
 * is the difference between "the agent has skills" as a claim and as something
 * a reader can check.
 *
 * **A table, because origin is a COLUMN and not a category.** It was two
 * grouped lists, which forced the reader to hold "which section am I in" while
 * scanning, and made a third origin a third section. As a column it is one
 * cell, sorts with everything else, and leaves room for the two facts that
 * were missing: what the skill is for, and when it last changed.
 *
 * `Updated` is the last COMMIT touching the file, from git rather than the
 * file's mtime — see `commitDates` in skills-store. In repo mode every mtime
 * is the clone's, which would have printed one identical date on every row.
 *
 * The name is the slug, because the slug is what you type after "/" — a
 * prettier label would just give every skill two names.
 */
export function SkillsScreen() {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  /** `null` = closed, `""` = the new-skill form, a slug = that skill open. */
  const [open, setOpen] = useState<string | null>(null);
  /** The skill a delete has been offered for, and not yet answered. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchSkills()
      .then(setSkills)
      .catch(() => setSkills([]));
  }, []);
  useEffect(load, [load]);

  // Built in first, always: they are the tested procedures and the ones a
  // reader should meet first. Then by name, so the order does not move as the
  // agent learns.
  const rows = useMemo(() => {
    if (!skills) return null;
    const rank = (s: SkillInfo) => (s.origin === "handwritten" ? 0 : s.origin === "custom" ? 1 : 2);
    return [...skills].sort((a, b) => rank(a) - rank(b) || a.slug.localeCompare(b.slug));
  }, [skills]);

  const remove = async (slug: string) => {
    setBusy(true);
    await removeSkill(slug);
    setBusy(false);
    setConfirming(null);
    load();
  };

  const download = async (slug: string) => {
    const skill = await fetchSkill(slug);
    if (skill) downloadSkill(slug, skill.content);
  };

  return (
    <div className="flex h-dvh flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 px-6">
        <h1 className="text-[15px] font-semibold">Skills</h1>
        <button
          onClick={() => setOpen("")}
          className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-stone-900 px-3 text-[12.5px] font-medium text-stone-50"
        >
          <Plus className="size-3.5" strokeWidth={2.2} />
          New skill
        </button>
      </header>

      {/* The header and the body share one gutter, and the table is not
          capped. A max-width put the table's right edge somewhere the header's
          button was not, which reads as uneven padding — and a table is the
          one thing on a page that is allowed to fill the width it is given. */}
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="rounded-xl border border-stone-200">
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-stone-200 text-[10.5px] tracking-[0.06em] text-stone-400 uppercase [&>th]:bg-stone-50/60 [&>th:first-child]:rounded-tl-xl [&>th:last-child]:rounded-tr-xl">
                <th className="w-[220px] py-2.5 pl-4 text-left font-medium">Name</th>
                <th className="w-[130px] py-2.5 text-left font-medium">Type</th>
                <th className="py-2.5 text-left font-medium">Description</th>
                <th className="w-[120px] py-2.5 text-left font-medium">Updated</th>
                <th className="w-[52px]" />
              </tr>
            </thead>
            <tbody>
              {rows === null
                ? [0, 1, 2, 3].map((i) => (
                    <tr key={i} className="border-b border-stone-100 last:border-b-0">
                      <td colSpan={5} className="py-3.5 pl-4">
                        <div className="h-3.5 w-56 animate-pulse rounded bg-stone-200/70" />
                      </td>
                    </tr>
                  ))
                : rows.map((s) => (
                    <Row
                      key={s.slug}
                      skill={s}
                      onOpen={() => setOpen(s.slug)}
                      onDownload={() => download(s.slug)}
                      onDelete={() => setConfirming(s.slug)}
                    />
                  ))}
            </tbody>
          </table>
        </div>
      </main>

      {open !== null && (
        <>
          <div className="fixed inset-0 z-10 bg-stone-900/25" onClick={() => setOpen(null)} />
          <SkillPane slug={open || undefined} onClose={() => setOpen(null)} onChanged={load} />
        </>
      )}

      {confirming && (
        <>
          <div className="fixed inset-0 z-20 bg-stone-900/25" onClick={() => setConfirming(null)} />
          <div className="fixed top-1/2 left-1/2 z-30 w-[min(420px,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200 bg-white p-5 shadow-xl">
            <p className="text-[13.5px] font-medium text-stone-900">
              Delete <span className="font-mono">{confirming}</span>?
            </p>
            <p className="mt-1.5 text-[12.5px]/[1.6] text-stone-500">
              The SKILL.md is removed from the agent's repository.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => remove(confirming)}
                disabled={busy}
                className="inline-flex h-9 items-center justify-center rounded-md bg-red-700 px-4 text-[13px] font-medium text-white hover:bg-red-800 disabled:opacity-40"
              >
                {busy ? "Deleting…" : "Delete skill"}
              </button>
              <button
                onClick={() => setConfirming(null)}
                className="text-[12.5px] text-stone-500 hover:text-stone-900"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Row({
  skill,
  onOpen,
  onDownload,
  onDelete,
}: {
  skill: SkillInfo;
  onOpen: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b border-stone-100 transition-colors last:border-b-0 hover:bg-stone-50 [&:last-child>td:first-child]:rounded-bl-xl [&:last-child>td:last-child]:rounded-br-xl"
    >
      <td className="py-3 pl-4">
        <div className="truncate pr-3 font-mono text-[13px]">{skill.slug}</div>
      </td>
      <td className="py-3">
        <TypeTag origin={skill.origin} />
      </td>
      <td className="py-3">
        <div className="truncate pr-4 text-[12.5px] text-stone-500">
          {skill.description || "—"}
        </div>
      </td>
      <td className="py-3 text-[12px] text-stone-500">{updatedLabel(skill.updatedAt)}</td>
      <td className="py-3 pr-2">
        <RowMenu onDownload={onDownload} onDelete={onDelete} />
      </td>
    </tr>
  );
}

/** The last commit date, in the shape a person reads. */
function updatedLabel(updatedAt: string): string {
  if (!updatedAt) return "—";
  const at = new Date(updatedAt);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Where a skill came from.
 *
 * Which is which is the most interesting fact on this screen — a procedure
 * someone wrote and tested, and one the agent decided to keep, are not the
 * same kind of thing. "Learned" did not say who did the learning, and the
 * answer is the surprising part, so the tag says it and the tooltip explains
 * it.
 */
function TypeTag({ origin }: { origin: SkillInfo["origin"] }) {
  if (origin === "handwritten") {
    return (
      <span className="inline-flex rounded-full border border-stone-200 px-1.5 py-px text-[10px] text-stone-500">
        Built in
      </span>
    );
  }
  if (origin === "custom") {
    return (
      <span className="inline-flex rounded-full border border-stone-200 px-1.5 py-px text-[10px] text-stone-500">
        Added
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] text-emerald-700">
          Self-learned
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={6} className="max-w-[300px]">
        Badger wrote this one itself, after a question it expects to see again, so the next
        question like it is answered better.
      </TooltipContent>
    </Tooltip>
  );
}

const MENU_HEIGHT = 76;

/** Download or delete, without opening the skill first. */
function RowMenu({ onDownload, onDelete }: { onDownload: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const toggle = () => {
    if (!open) {
      const bottom = box.current?.getBoundingClientRect().bottom ?? 0;
      setUp(bottom + MENU_HEIGHT > window.innerHeight);
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // Every handler in here stops the event: the whole row opens the skill, and
  // a menu that opened the pane behind itself would be its own bug.
  const pick = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    close();
    fn();
  };

  return (
    <div
      ref={box}
      className="relative flex justify-end"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={toggle}
        aria-label="Skill options"
        className="inline-flex size-7 items-center justify-center rounded-md text-stone-400 hover:bg-stone-200/60 hover:text-stone-900"
      >
        <MoreHorizontal className="size-4" strokeWidth={2} />
      </button>
      {open && (
        <div
          className={`absolute right-0 z-20 w-[170px] overflow-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-lg ${up ? "bottom-8" : "top-8"}`}
        >
          <button
            onClick={pick(onDownload)}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] text-stone-700 hover:bg-stone-50"
          >
            <Download className="size-3.5" strokeWidth={2} />
            Download
          </button>
          <button
            onClick={pick(onDelete)}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] text-red-700 hover:bg-stone-50"
          >
            <Trash2 className="size-3.5" strokeWidth={2} />
            Delete skill
          </button>
        </div>
      )}
    </div>
  );
}
