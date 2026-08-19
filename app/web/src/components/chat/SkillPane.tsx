import { useEffect, useState } from "react";
import { Download, MoreHorizontal, Trash2, Upload, X } from "lucide-react";
import {
  createSkill,
  downloadSkill,
  fetchSkill,
  removeSkill,
  saveSkill,
  type SkillFile,
} from "@/lib/ask";

/**
 * What a new skill starts as.
 *
 * The headings are not decoration. `## When to Use` is the single strongest
 * convention across the framework authors' own published agents — always the
 * first body heading — and here it is also load-bearing: `skill-match.mjs`
 * reads the quoted questions out of that section to decide when a skill
 * fires. The quoted phrases in `description:` are the other half of the same
 * mechanism, matched first.
 *
 * A skill written without either can only ever be invoked by hand with "/".
 * That is what the three-field form used to produce — a name, a prose trigger
 * and some numbered steps — and nothing in that form could have told you.
 * Pre-filling the shape is how the box teaches it.
 *
 * `license`, `allowed-tools` and `metadata` are deliberately absent. They are
 * valid keys and the shipped four carry them, but nothing here needs a person
 * to supply them, and every field in a scaffold that can be left wrong is a
 * field that will be.
 */
const TEMPLATE = `---
name: my-skill
description: When Badger should use this, with the phrases that should trigger it in quotes: "who owns", "who should I ask".
---

# Title

## When to Use

The situation this is for. List example questions in quotes — these are what
Badger matches a real question against:

"Who owns the payments webhook?"
"Who should I ask about billing?"

## Steps

1.
2.
3.
`;

/**
 * The skill side pane, in its two jobs.
 *
 * **New** — the three fields are the framework's own SKILL.md shape: the name;
 * the description, which is the trigger and the only part the model sees
 * before deciding; and the steps, loaded once the trigger fires. Saving writes
 * a real SKILL.md into the agent's repo, the same mechanism its own learning
 * uses.
 *
 * **Open** — the SKILL.md, whole, in the same box you write a new one in.
 *
 * An editor was tried and pulled once, and it is worth being clear about what
 * was wrong with it, because this is not a reversal. That version split the
 * file into "the trigger" and "the steps": two boxes that hid `license`,
 * `allowed-tools` and `metadata` while silently owning them on save. The
 * problem was the split, not the editing. One box holding the whole file
 * cannot drop a field it never took apart.
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
  const [content, setContent] = useState(TEMPLATE);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    // The same call an upload makes, because by the time it is sent there is
    // no difference: one box holding one file. Splitting a name, a trigger and
    // some steps across three inputs and assembling markdown from them was
    // machinery that existed only to produce this string.
    const result = await createSkill({ file: content });
    setSaving(false);
    if (result.error) return setError(result.error);
    onChanged?.();
    onClose(result.slug ?? null);
  };

  // A file loads INTO the box rather than saving straight past it, so an
  // upload is reviewable before it lands and there is exactly one save path.
  // Still saved as written unless you change something.
  const load = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setContent(await file.text());
  };

  return (
    <div className="fixed inset-y-0 right-0 z-20 flex w-[560px] max-w-full flex-col border-l border-stone-200 bg-white shadow-xl">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-stone-100 px-4">
        <span className="text-[13.5px] font-semibold">New skill</span>
        <label className="ml-auto inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-stone-200 px-2.5 text-[12px] text-stone-600 hover:bg-stone-50">
          <Upload className="size-3.5" strokeWidth={2} />
          Load a SKILL.md
          <input
            type="file"
            accept=".md,text/markdown"
            className="hidden"
            onChange={(e) => load(e.target.files?.[0])}
          />
        </label>
        <button
          onClick={() => onClose(null)}
          aria-label="Close"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100"
        >
          <X className="size-4" strokeWidth={2} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
        <p className="mb-2 shrink-0 text-[11.5px] text-stone-500">
          This is the file. The name in the frontmatter becomes the slug you type after
          <span className="font-mono"> /</span>.
        </p>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="min-h-0 w-full flex-1 resize-none rounded-md border border-stone-200 p-3 font-mono text-[12px]/[1.65] focus:border-stone-400 focus:outline-none"
        />
        {error && <p className="mt-2 shrink-0 text-[12px] text-amber-700">{error}</p>}
      </div>

      <div className="shrink-0 border-t border-stone-100 px-4 py-3">
        <button
          onClick={save}
          disabled={saving || !content.trim()}
          className="inline-flex h-8 items-center justify-center rounded-md bg-stone-900 px-4 text-xs font-medium text-stone-50 disabled:opacity-40"
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
  const [draft, setDraft] = useState("");
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
      if (!s) return setError("that skill could not be loaded");
      setSkill(s);
      setDraft(s.content);
    });
    return () => {
      live = false;
    };
  }, [slug]);

  const dirty = skill != null && draft !== skill.content;

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await saveSkill(slug, draft);
    setBusy(false);
    if (result.error) return setError(result.error);
    // Re-read rather than assume: the server carries the provenance line back
    // into the frontmatter, so what is on disk is not always what was sent.
    const fresh = await fetchSkill(slug);
    if (fresh) {
      setSkill(fresh);
      setDraft(fresh.content);
    }
    onChanged?.();
  };

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

      <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
        {!skill && !error ? (
          <div className="flex animate-pulse flex-col gap-2">
            {[60, 90, 40, 75, 55].map((w, i) => (
              <div key={i} className="h-3.5 rounded bg-stone-200/70" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : (
          /* The file, exactly as the runtime will read it — frontmatter,
             counters and all — and editable in place. */
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="min-h-0 w-full flex-1 resize-none rounded-md border border-stone-200 p-3 font-mono text-[12px]/[1.65] focus:border-stone-400 focus:outline-none"
          />
        )}
        {error && <p className="mt-2 shrink-0 text-[12px] text-amber-700">{error}</p>}
      </div>

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
        ) : (
          <button
            onClick={save}
            disabled={busy || !dirty}
            className="inline-flex h-8 items-center justify-center rounded-md bg-stone-900 px-4 text-xs font-medium text-stone-50 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        )}
      </div>
    </div>
  );
}
