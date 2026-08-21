import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ExternalLink, Plus, Search, X } from "lucide-react";
import {
  createAgent,
  fetchAgent,
  fetchSkills,
  fetchToolCatalog,
  removeAgent,
  saveAgent,
  type AgentSpec,
  type SkillInfo,
  type ToolInfo,
} from "@/lib/ask";
import { AGENT_COLOR_NAMES, AgentMark, agentColorClass } from "./icons";
import { cn } from "@/lib/utils";
import { useDismiss } from "@/lib/useDismiss";

/** The one model every agent runs on. Shown, not chosen. */
const MODEL = "google-vertex:gemini-2.5-flash";

/** Everything the editor owns except the name, which the page header holds. */
export type Definition = Omit<AgentSpec, "slug">;

const BLANK: Definition = {
  role: "",
  goal: "",
  color: "clay",
  instructions: "",
  tools: [],
  skills: [],
  memory: true,
  // Kept in the spec and off the screen. The runtime has no structured-output
  // mode, so JSON is an instruction rather than a guarantee — a control for it
  // would promise enforcement the server cannot give.
  outputFormat: "text",
};

/**
 * The agent being edited: what is on screen, and whether it differs from disk.
 *
 * A hook rather than state inside the form, because Save and Delete live in
 * the PAGE HEADER now. The header needs `dirty` to know whether Save is live,
 * and the form needs the fields — so the state belongs above both of them.
 */
export function useAgentDraft({
  slug,
  cloneFrom,
  name,
}: {
  slug?: string;
  cloneFrom?: string;
  name: string;
}) {
  const isNew = !slug;
  const [spec, setSpec] = useState<Definition>(BLANK);
  /** The last thing written to or read from disk. `dirty` is measured here. */
  const [baseline, setBaseline] = useState<Definition>(BLANK);
  const [loading, setLoading] = useState(!isNew || !!cloneFrom);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The agent to read the fields from: the one being edited, or the one being
  // cloned. A clone loads the same way an edit does and diverges only in
  // where the save goes.
  const source = slug ?? cloneFrom;
  useEffect(() => {
    if (!source) {
      setSpec(BLANK);
      setBaseline(BLANK);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    fetchAgent(source).then((a) => {
      if (!live) return;
      setLoading(false);
      if (!a) return setError("that agent could not be loaded");
      const loaded: Definition = {
        role: a.role,
        goal: a.goal,
        color: a.color || "clay",
        instructions: a.instructions,
        tools: a.tools ?? [],
        skills: a.skills ?? [],
        memory: a.memory,
        outputFormat: a.outputFormat,
      };
      setSpec(loaded);
      setBaseline(loaded);
    });
    return () => {
      live = false;
    };
  }, [source]);

  const set = useCallback(
    <K extends keyof Definition>(key: K, value: Definition[K]) =>
      setSpec((s) => ({ ...s, [key]: value })),
    [],
  );

  const toggle = useCallback(
    (key: "tools" | "skills", value: string) =>
      setSpec((s) => ({
        ...s,
        [key]: s[key].includes(value) ? s[key].filter((v) => v !== value) : [...s[key], value],
      })),
    [],
  );

  const complete = Boolean(name.trim() && spec.role.trim() && spec.goal.trim());
  // A rename counts: the name is a field of the agent even though it is drawn
  // as the page's title.
  const changed = JSON.stringify(spec) !== JSON.stringify(baseline) || (!isNew && name !== slug);
  const savable = complete && !busy && (isNew || changed);

  const save = async (): Promise<string | null> => {
    setBusy(true);
    setError(null);
    const full: AgentSpec = { ...spec, slug: name };
    const result = isNew ? await createAgent(full) : await saveAgent(slug, full);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return null;
    }
    setBaseline(spec);
    return name;
  };

  const remove = async (): Promise<boolean> => {
    if (!slug) return false;
    setBusy(true);
    setError(null);
    const result = await removeAgent(slug);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return false;
    }
    return true;
  };

  return { isNew, spec, set, toggle, loading, error, busy, savable, save, remove };
}

export type AgentDraft = ReturnType<typeof useAgentDraft>;

/**
 * The Build tab: an agent's definition.
 *
 * Wide rather than a sheet, because an agent is not one file: it is a role, a
 * goal, a procedure, a set of tools and a set of skills, and the tools and
 * skills have to stay visible while the instructions are written.
 *
 * Left is the definition, right is what the agent is made of. Saving writes a
 * real `agents/<slug>/` folder into Badger's own repo.
 *
 * Neither the NAME nor the actions are in here — both are in the page header,
 * because the name is what the agent is called everywhere else on the page and
 * two copies of it could disagree.
 */
export function AgentForm({ draft }: { draft: AgentDraft }) {
  const { spec, set, toggle, loading } = draft;
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  useEffect(() => {
    fetchToolCatalog().then(setTools).catch(() => setTools([]));
    fetchSkills().then(setSkills).catch(() => setSkills([]));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 animate-pulse flex-col gap-3 p-6">
        {[40, 70, 55].map((w, i) => (
          <div key={i} className="h-4 rounded bg-stone-200/70" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
        <Field label="Role">
          {/* The mark sits at the end of the role line: it is the visual form
              of the same sentence, and it is chosen once alongside it. */}
          <div className="flex items-center gap-2">
            <input
              value={spec.role}
              onChange={(e) => set("role", e.target.value)}
              placeholder="e.g. Customer support researcher"
              maxLength={200}
              className="h-9 min-w-0 flex-1 rounded-md border border-stone-200 px-2.5 text-[13px] focus:border-stone-400 focus:outline-none"
            />
            <ColorPicker value={spec.color} onPick={(color) => set("color", color)} />
          </div>
        </Field>

        <Field label="Goal">
          <input
            value={spec.goal}
            onChange={(e) => set("goal", e.target.value)}
            placeholder="e.g. Answer what a customer was told, and whether policy agrees"
            maxLength={200}
            className="h-9 w-full rounded-md border border-stone-200 px-2.5 text-[13px] focus:border-stone-400 focus:outline-none"
          />
        </Field>

        <Field grow label="Instructions">
          <textarea
            value={spec.instructions}
            onChange={(e) => set("instructions", e.target.value)}
            placeholder="Write in plain English how this agent should work: what it should search first, what it should always check, and how to answer."
            maxLength={20000}
            spellCheck={false}
            className="min-h-[220px] w-full flex-1 resize-none rounded-md border border-stone-200 p-3 text-[13px]/[1.7] placeholder:text-stone-400 focus:border-stone-400 focus:outline-none"
          />
        </Field>
      </div>

      <div className="w-[330px] shrink-0 overflow-y-auto border-l border-stone-100 bg-stone-50/60 px-5 py-5">
        <Section title="Model">
          <p className="font-mono text-[11.5px] break-all text-stone-600">{MODEL}</p>
        </Section>

        <AddPicker
          title="Tools"
          items={tools.map((t) => ({ value: t.name, label: t.name, hint: t.description }))}
          selected={spec.tools}
          onToggle={(v) => toggle("tools", v)}
          placeholder="Search tools"
          empty="No tools found."
          configure={{ label: "Configure more tools", href: "/tools" }}
        />

        <AddPicker
          title="Skills"
          items={skills.map((s) => ({ value: s.slug, label: s.slug, hint: s.description }))}
          selected={spec.skills}
          onToggle={(v) => toggle("skills", v)}
          placeholder="Search skills"
          empty="No skills found."
          configure={{ label: "Manage skills", href: "/skills" }}
        />

        <Section title="Features">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={spec.memory}
              onChange={(e) => set("memory", e.target.checked)}
              className="mt-0.5 size-3.5 accent-stone-900"
            />
            <span className="min-w-0">
              <span className="block text-[12.5px] font-medium text-stone-800">Memory</span>
              <span className="block text-[11.5px]/[1.5] text-stone-500">
                Retains what it learns between questions.
              </span>
            </span>
          </label>
        </Section>
      </div>
    </div>
  );
}


/** The agent's mark, and a row of colours to change it. */
function ColorPicker({ value, onPick }: { value: string; onPick: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const box = useDismiss(open, close);

  return (
    <div ref={box} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Agent colour"
        title="Agent colour"
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-200 pr-1.5 pl-1.5 hover:border-stone-300"
      >
        <AgentMark color={value} size={22} />
        <ChevronDown className="size-3 text-stone-400" strokeWidth={2.2} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1.5 flex gap-1.5 rounded-lg border border-stone-200 bg-white p-2 shadow-lg">
          {AGENT_COLOR_NAMES.map((name) => (
            <button
              key={name}
              onClick={() => {
                onPick(name);
                setOpen(false);
              }}
              aria-label={name}
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-[28%]",
                agentColorClass(name),
              )}
            >
              {name === value && <Check className="size-3.5" strokeWidth={3} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  grow = false,
  children,
}: {
  label: string;
  /** Take the leftover height. Instructions is the only field that should. */
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-h-0 flex-col", grow && "flex-1")}>
      <span className="mb-1.5 text-[12.5px] font-medium text-stone-800">{label}</span>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-stone-200/70 py-4 first:pt-0 last:border-b-0">
      {/* The same 24px heading band AddPicker uses, so every section title in
          the rail sits on one line whether or not it carries a control. */}
      <div className="flex h-6 items-center">
        <span className="text-[12.5px] font-medium text-stone-800">{title}</span>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/**
 * A section of the rail: what is chosen, and a `+` to change it.
 *
 * The `+` sits at the right end of the section's own heading rather than
 * among the chips. Among them it moved every time one was added or removed,
 * and with nothing chosen it was a lone button under a heading — which reads
 * as the section's content rather than as its control.
 *
 * The list itself is not open all the time. That put two scrolling boxes of
 * ten and four rows into a rail that also has to show the rest of the agent.
 * What matters at rest is the handful that are selected; the catalogue is a
 * decision you make once.
 *
 * Nothing chosen shows nothing. The `+` already says the row is empty and can
 * be filled, so a line of prose underneath it only added height.
 */
function AddPicker({
  title,
  items,
  selected,
  onToggle,
  placeholder,
  empty,
  configure,
}: {
  title: string;
  items: { value: string; label: string; hint?: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  placeholder: string;
  empty: string;
  configure: { label: string; href: string };
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const close = useCallback(() => setOpen(false), []);
  const box = useDismiss(open, close);
  const search = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return items;
    return items.filter(
      (i) => i.label.toLowerCase().includes(f) || (i.hint ?? "").toLowerCase().includes(f),
    );
  }, [items, filter]);

  return (
    <div ref={box} className="relative border-b border-stone-200/70 py-4 first:pt-0 last:border-b-0">
      {/* The WHOLE heading opens the picker, not just the `+`. A title with a
          control at the far end of it reads as one target, and a six-pixel
          square is a small thing to ask someone to hit. The `+` is a span
          rather than a button — nested buttons are invalid, and it is the
          affordance here, not a second control. */}
      <button
        onClick={() => {
          setFilter("");
          setOpen((o) => !o);
        }}
        className="group flex h-6 w-full items-center text-left"
      >
        <span className="text-[12.5px] font-medium text-stone-800">{title}</span>
        <span
          aria-hidden="true"
          className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-dashed border-stone-300 text-stone-500 group-hover:border-stone-400 group-hover:text-stone-900"
        >
          <Plus className="size-3.5" strokeWidth={2.2} />
        </span>
      </button>

      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {selected.map((v) => (
            <button
              key={v}
              onClick={() => onToggle(v)}
              title={`Remove ${v}`}
              className="group inline-flex max-w-full items-center gap-1 rounded-md border border-stone-200 bg-white py-1 pr-1 pl-2 font-mono text-[11.5px] text-stone-700 hover:border-stone-300"
            >
              <span className="truncate">{v}</span>
              <X
                className="size-3 shrink-0 text-stone-400 group-hover:text-stone-700"
                strokeWidth={2.2}
              />
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute top-9 right-0 z-10 w-[300px] overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-stone-100 px-2.5">
            <Search className="size-3 shrink-0 text-stone-400" strokeWidth={2} />
            <input
              ref={search}
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={placeholder}
              className="h-8 w-full bg-transparent text-[12px] placeholder:text-stone-400 focus:outline-none"
            />
          </div>
          <div className="max-h-[240px] overflow-y-auto py-1">
            {shown.length === 0 ? (
              <p className="px-2.5 py-2 text-[11.5px] text-stone-500">{empty}</p>
            ) : (
              shown.map((i) => (
                <label
                  key={i.value}
                  className="flex cursor-pointer items-start gap-2 px-2.5 py-1.5 hover:bg-stone-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(i.value)}
                    onChange={() => {
                      onToggle(i.value);
                      // Back to the filter, so picking several in a row is
                      // typing rather than typing-then-reaching-for-the-mouse.
                      search.current?.focus();
                    }}
                    className="mt-0.5 size-3.5 shrink-0 accent-stone-900"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[11.5px] text-stone-800">
                      {i.label}
                    </span>
                    {i.hint && (
                      <span className="block truncate text-[11px] text-stone-500">{i.hint}</span>
                    )}
                  </span>
                </label>
              ))
            )}
          </div>
          {/* A NEW TAB, deliberately. Following it in place would throw away
              the agent being edited, unsaved fields and all — and the reason
              to go is to look something up and come back. */}
          <a
            href={configure.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 border-t border-stone-100 px-2.5 py-2 text-[11.5px] text-stone-600 hover:bg-stone-50 hover:text-stone-900"
          >
            {configure.label}
            <ExternalLink className="size-3 text-stone-400" strokeWidth={2} />
          </a>
        </div>
      )}
    </div>
  );
}
