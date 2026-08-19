import { useCallback, useEffect, useState } from "react";
import { Download, MoreHorizontal, Trash2, Upload, X } from "lucide-react";
import {
  createSkill,
  downloadSkill,
  fetchSkill,
  parseSkill,
  removeSkill,
  saveSkill,
  type SkillFile,
  type SkillParts,
} from "@/lib/ask";

/**
 * The skill side pane, in its two jobs.
 *
 * **New** — the three fields are the framework's own SKILL.md shape: the name;
 * the description, which is the trigger and the only part the model sees
 * before deciding; and the steps, loaded once the trigger fires. Saving writes
 * a real SKILL.md into the agent's repo, the same mechanism its own learning
 * uses.
 *
 * **Open** — the raw SKILL.md in a text area, which is a deliberate choice
 * rather than laziness. The built-in skills use YAML block scalars and carry
 * frontmatter the form has no box for (`learned_from`, `added_at`), so
 * round-tripping one through three fields would silently drop whatever the
 * form did not know about. The file is what the runtime loads; the editor
 * edits the file.
 *
 * One pane for both, because they are the same act at different times — this
 * is what the agent will read before its next answer, and you are writing it.
 */
export function SkillPane({
  slug,
  onClose,
  onChanged,
}: {
  /** Open an existing skill. Absent means the new-skill form. */
  slug?: string;
  onClose: (slug: string | null) => void;
  /** A skill was written or removed — the list behind the pane is now stale. */
  onChanged?: () => void;
}) {
  if (slug) return <OpenSkill slug={slug} onClose={onClose} onChanged={onChanged} />;
  return <NewSkill onClose={onClose} onChanged={onChanged} />;
}

function NewSkill({
  onClose,
  onChanged,
}: {
  onClose: (slug: string | null) => void;
  onChanged?: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    // No steps here on purpose. The name and the trigger are all this form
    // asks for; `onClose(slug)` hands the new skill straight to the editor,
    // where the steps get a full-width box instead of a cramped one. The
    // description is the only part the model reads before deciding, so it is
    // the only part that has to exist at creation.
    const result = await createSkill({ name, description });
    setSaving(false);
    if (result.error) setError(result.error);
    else {
      onChanged?.();
      onClose(result.slug ?? null);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setSaving(true);
    setError(null);
    const result = await createSkill({ file: await file.text() });
    setSaving(false);
    if (result.error) setError(result.error);
    else {
      onChanged?.();
      onClose(result.slug ?? null);
    }
  };

  const field =
    "mt-1 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] placeholder:text-stone-400 focus:border-stone-400 focus:outline-none";
  const label = "text-[11px] font-medium text-stone-500";
  const hint = "font-normal text-stone-400";

  return (
    <div className="fixed inset-y-0 right-0 z-20 flex w-[380px] max-w-full flex-col border-l border-stone-200 bg-white shadow-xl">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-stone-100 px-4">
        <span className="text-[13.5px] font-semibold">New skill</span>
        <button
          onClick={() => onClose(null)}
          aria-label="Close"
          className="inline-flex size-7 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100"
        >
          <X className="size-4" strokeWidth={2} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3.5">
          {/* Upload first, and large. A SKILL.md someone already has is the
              richest thing this pane can accept — it arrives complete, with
              its own frontmatter — where the form below can only ever produce
              a name and a trigger. Putting it under a divider at the bottom
              had it reading as the fallback, which is backwards. */}
          <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed border-stone-300 px-3 py-6 text-center hover:border-stone-400 hover:bg-stone-50">
            <Upload className="size-4 text-stone-500" strokeWidth={1.9} />
            <span className="text-[13px] font-medium text-stone-800">Upload a SKILL.md</span>
            <span className="text-[11.5px] text-stone-500">
              Saved exactly as written, frontmatter and all
            </span>
            <input
              type="file"
              accept=".md,text/markdown"
              className="hidden"
              onChange={(e) => upload(e.target.files?.[0])}
            />
          </label>

          <div className="my-0.5 flex items-center gap-3">
            <span className="h-px flex-1 bg-stone-100" />
            <span className="text-[11px] text-stone-400">or start from scratch</span>
            <span className="h-px flex-1 bg-stone-100" />
          </div>

          <div>
            <div className={label}>Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Summarise for a customer"
              className={field}
            />
          </div>
          <div>
            <div className={label}>
              When should Badger use it? <span className={hint}>— the trigger it reads to decide</span>
            </div>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. When an answer will be sent to a customer"
              className={field}
            />
          </div>
          {error && <p className="text-[12px] text-amber-700">{error}</p>}
        </div>
      </div>

      <div className="shrink-0 border-t border-stone-100 px-4 py-3">
        <button
          onClick={save}
          disabled={saving || !name.trim() || !description.trim()}
          className="inline-flex h-8 items-center justify-center rounded-md bg-stone-900 px-4 text-xs font-medium text-stone-50 disabled:opacity-40"
        >
          {saving ? "Creating…" : "Create and write steps"}
        </button>
      </div>
    </div>
  );
}

/**
 * An existing skill: what it does, whether it has been working, and — unless
 * it is built in — an editor for the two parts a person writes.
 *
 * **Only the descriptive half is shown.** `license`, `allowed-tools` and
 * `metadata` are real and the runtime needs them, but they are its business,
 * not the reader's; a save merges the description and the steps back into the
 * file server-side, so everything hidden here survives untouched.
 *
 * **The built-in four are read-only**, and that is what keeps editing simple
 * rather than being a restriction for its own sake. They carry counters the
 * agent's own learning loop maintains, and a hand edit to those has no good
 * meaning. Download is the escape hatch: take a copy, change it, upload it
 * under your own name.
 */
function OpenSkill({
  slug,
  onClose,
  onChanged,
}: {
  slug: string;
  onClose: (slug: string | null) => void;
  onChanged?: () => void;
}) {
  const [skill, setSkill] = useState<SkillFile | null>(null);
  const [parts, setParts] = useState<SkillParts | null>(null);
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Delete asks once, in the pane, rather than through a browser confirm() —
      a native dialog blocks every subsequent event and looks like nothing else
      here. */
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const s = await fetchSkill(slug);
    if (!s) return setError("that skill could not be loaded");
    const p = parseSkill(s.content);
    setSkill(s);
    setParts(p);
    setDescription(p.description);
    setInstructions(p.instructions);
  }, [slug]);

  useEffect(() => {
    setSkill(null);
    setError(null);
    setConfirming(false);
    load();
  }, [load]);

  const editable = skill != null && skill.origin !== "handwritten";
  const dirty =
    parts != null && (description !== parts.description || instructions !== parts.instructions);

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await saveSkill(slug, { description, instructions });
    setSaving(false);
    if (result.error) return setError(result.error);
    await load();
    onChanged?.();
  };

  const remove = async () => {
    setSaving(true);
    setError(null);
    const result = await removeSkill(slug);
    setSaving(false);
    if (result.error) return setError(result.error);
    onChanged?.();
    onClose(null);
  };

  const field =
    "mt-1.5 w-full rounded-md border border-stone-200 px-2.5 py-2 text-[13px] focus:border-stone-400 focus:outline-none disabled:bg-stone-50 disabled:text-stone-600";
  const label = "text-[11px] font-medium text-stone-500";

  return (
    <div className="fixed inset-y-0 right-0 z-20 flex w-[520px] max-w-full flex-col border-l border-stone-200 bg-white shadow-xl">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-stone-100 px-4">
        <span className="truncate font-mono text-[13.5px] font-medium">{slug}</span>
        {skill?.origin === "handwritten" && (
          <span className="shrink-0 rounded-full border border-stone-200 px-1.5 py-px text-[10px] text-stone-400">
            Built in
          </span>
        )}

        <div className="relative ml-auto flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More"
            className="inline-flex size-7 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100"
          >
            <MoreHorizontal className="size-4" strokeWidth={2} />
          </button>
          {menuOpen && skill && (
            <div className="absolute top-full right-0 z-10 mt-1 w-52 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
              <button
                onClick={() => {
                  downloadSkill(slug, skill.content);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[12.5px] text-stone-700 hover:bg-stone-50"
              >
                <Download className="size-3.5" strokeWidth={2} />
                Download SKILL.md
              </button>
              {editable && (
                <button
                  onClick={() => {
                    setConfirming(true);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[12.5px] text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="size-3.5" strokeWidth={2} />
                  Delete skill
                </button>
              )}
            </div>
          )}
          <button
            onClick={() => onClose(null)}
            aria-label="Close"
            className="inline-flex size-7 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!skill && !error ? (
          <div className="flex animate-pulse flex-col gap-2">
            {[60, 90, 40].map((w, i) => (
              <div key={i} className="h-3.5 rounded bg-stone-200/70" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <div className={label}>When should Badger use it?</div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={!editable}
                rows={3}
                className={field + " resize-y"}
              />
            </div>

            <div>
              <div className={label}>What should Badger do?</div>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                disabled={!editable}
                placeholder="1. …"
                rows={16}
                className={field + " resize-y font-mono text-[12px]/[1.6]"}
              />
            </div>

            {/* The agent's own tally, and the most interesting thing on the
                page: whether this procedure has earned its place. Absent
                until it has actually been run. */}
            {parts?.usage && (
              <div className="flex gap-5 border-t border-stone-100 pt-3 text-[12px]">
                <Stat label="Used" value={parts.usage.used} />
                <Stat label="Worked" value={parts.usage.ok} />
                <Stat label="Failed" value={parts.usage.failed} />
              </div>
            )}

            {error && <p className="text-[12px] text-amber-700">{error}</p>}
          </div>
        )}
      </div>

      {/* The confirm lives in the FOOTER, not in the scrolling body. It was
          in the body, under a sixteen-row textarea, so the big red button
          opened below the fold and behind this bar — a destructive action you
          had to go looking for. The footer is where the actions already are
          and it cannot be scrolled away from. */}
      {editable && (
        <div className="shrink-0 border-t border-stone-100 px-4 py-3">
          {confirming ? (
            <div>
              <p className="text-[12.5px] text-stone-700">
                Delete <span className="font-mono">{slug}</span>? The file is removed from the
                agent's repository.
              </p>
              <div className="mt-2.5 flex items-center gap-3">
                <button
                  onClick={remove}
                  disabled={saving}
                  className="inline-flex h-9 flex-1 items-center justify-center rounded-md bg-red-700 text-[13px] font-medium text-white hover:bg-red-800 disabled:opacity-40"
                >
                  {saving ? "Deleting…" : "Delete skill"}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="text-[12.5px] text-stone-500 hover:text-stone-900"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="inline-flex h-8 items-center justify-center rounded-md bg-stone-900 px-4 text-xs font-medium text-stone-50 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-medium">{value}</span>
      <span className="text-stone-500">{label.toLowerCase()}</span>
    </span>
  );
}
