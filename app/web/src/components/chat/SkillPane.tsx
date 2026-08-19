import { useEffect, useState } from "react";
import { Download, MoreHorizontal, Trash2, Upload, X } from "lucide-react";
import { createSkill, downloadSkill, fetchSkill, removeSkill, type SkillFile } from "@/lib/ask";

/**
 * The skill side pane, in its two jobs.
 *
 * **New** — the three fields are the framework's own SKILL.md shape: the name;
 * the description, which is the trigger and the only part the model sees
 * before deciding; and the steps, loaded once the trigger fires. Saving writes
 * a real SKILL.md into the agent's repo, the same mechanism its own learning
 * uses.
 *
 * **Open** — the SKILL.md, whole, and read-only. An editor was tried and
 * pulled: splitting the file into "the trigger" and "the steps" meant two
 * boxes that hid `license`, `allowed-tools` and `metadata` while silently
 * owning them on save, and it turned one artefact into two half-views of
 * itself. The runtime reads the file, so the file is what you should see.
 * Changing one means downloading it, editing it and uploading it back — the
 * same loop, with nothing in the middle that can quietly drop a field.
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
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await createSkill({ name, description, instructions });
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
          <div>
            <div className={label}>
              What should Badger do? <span className={hint}>— the steps once the trigger fires</span>
            </div>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={"1. Answer as a short summary a customer could read.\n2. Never name internal staff or internal disagreements.\n3. Lead with what the customer gets and when."}
              rows={7}
              className={field + " resize-y"}
            />
          </div>
          {error && <p className="text-[12px] text-amber-700">{error}</p>}
        </div>
      </div>

      <div className="shrink-0 border-t border-stone-100 px-4 py-3">
        <button
          onClick={save}
          disabled={saving || !name.trim() || !description.trim() || !instructions.trim()}
          className="inline-flex h-8 w-full items-center justify-center rounded-md bg-stone-900 text-xs font-medium text-stone-50 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save skill"}
        </button>
      </div>
    </div>
  );
}


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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Delete asks once, in the pane. A native confirm() blocks every event
      after it and looks like nothing else here. */
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let live = true;
    setSkill(null);
    setError(null);
    setConfirming(false);
    fetchSkill(slug).then((s) => {
      if (!live) return;
      if (s) setSkill(s);
      else setError("that skill could not be loaded");
    });
    return () => {
      live = false;
    };
  }, [slug]);

  const remove = async () => {
    setBusy(true);
    setError(null);
    const result = await removeSkill(slug);
    setBusy(false);
    if (result.error) return setError(result.error);
    onChanged?.();
    onClose(null);
  };

  return (
    <div className="fixed inset-y-0 right-0 z-20 flex w-[560px] max-w-full flex-col border-l border-stone-200 bg-white shadow-xl">
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
        {error ? (
          <p className="text-[12.5px] text-amber-700">{error}</p>
        ) : !skill ? (
          <div className="flex animate-pulse flex-col gap-2">
            {[60, 90, 40, 75, 55].map((w, i) => (
              <div key={i} className="h-3.5 rounded bg-stone-200/70" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : (
          /* The file, exactly as the runtime will read it — frontmatter,
             counters and all. `whitespace-pre-wrap` rather than a textarea:
             this is something to read, and a textarea would invite an edit
             that has nowhere to go. */
          <pre className="font-mono text-[12px]/[1.65] whitespace-pre-wrap text-stone-800">
            {skill.content}
          </pre>
        )}
      </div>

      {confirming && (
        <div className="shrink-0 border-t border-stone-100 px-4 py-3">
          <p className="text-[12.5px] text-stone-700">
            Delete <span className="font-mono">{slug}</span>? The file is removed from the agent's
            repository.
          </p>
          <div className="mt-2.5 flex items-center gap-3">
            <button
              onClick={remove}
              disabled={busy}
              className="inline-flex h-9 flex-1 items-center justify-center rounded-md bg-red-700 text-[13px] font-medium text-white hover:bg-red-800 disabled:opacity-40"
            >
              {busy ? "Deleting…" : "Delete skill"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="text-[12.5px] text-stone-500 hover:text-stone-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
