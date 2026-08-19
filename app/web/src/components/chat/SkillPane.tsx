import { useState } from "react";
import { Upload, X } from "lucide-react";
import { createSkill } from "@/lib/ask";

/**
 * The add-skill side pane. The three fields are the framework's own SKILL.md
 * shape: the name; the description — the trigger, the only part the model
 * sees before deciding; and the steps, loaded once the trigger fires. Saving
 * writes a real SKILL.md into the agent's repo (the same mechanism its own
 * learning uses) and pre-fills the new slash command into the composer.
 */
export function SkillPane({ onClose }: { onClose: (slug: string | null) => void }) {
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
    else onClose(result.slug ?? null);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setSaving(true);
    setError(null);
    const result = await createSkill({ file: await file.text() });
    setSaving(false);
    if (result.error) setError(result.error);
    else onClose(result.slug ?? null);
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

          <div className="mt-1 flex items-center gap-3">
            <span className="h-px flex-1 bg-stone-100" />
            <span className="text-[11px] text-stone-400">or</span>
            <span className="h-px flex-1 bg-stone-100" />
          </div>

          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-stone-300 px-3 py-2.5 text-[12.5px] text-stone-600 hover:bg-stone-50">
            <Upload className="size-3.5" strokeWidth={2} />
            Upload your own SKILL.md
            <input
              type="file"
              accept=".md,text/markdown"
              className="hidden"
              onChange={(e) => upload(e.target.files?.[0])}
            />
          </label>
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
        <p className="mt-2 text-center text-[11px] text-stone-400">
          Lands in the agent's own repo — usable on the next question via /
        </p>
      </div>
    </div>
  );
}
