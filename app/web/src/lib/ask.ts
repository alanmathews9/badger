import type { SourceId } from "@/lib/api";

/** What a tool call opened or the answer cited, across all three sources. */
export type OpenedItem = {
  kind: "issue" | "pr" | "file" | "mail" | "doc";
  /** An id for GitHub; the subject or document name for mail and Drive. */
  ref: string;
  label: string;
  /** "issue #12, open" — recovered from tool output, absent for plain opens. */
  detail?: string;
  /** Address of the real thing, when the run gave the server enough to build
      one. Resolves only for someone with access to the underlying account —
      permissions stay enforced at the source. */
  url?: string;
};

/**
 * One document a search turned up, as the step that found it lists it.
 *
 * These are *found*, not cited and not necessarily read — they are what
 * Badger had in front of it. `OpenedItem` above is a different thing: what it
 * opened in full, and what the answer went on to cite.
 */
export type FoundDoc = {
  source: SourceId;
  kind: OpenedItem["kind"];
  ref: string;
  title: string;
  /** "issue · open", the sender, "spreadsheet" — whatever the row can say. */
  detail?: string;
};

/** One tool call, kept whole so the step trail can show its detail on demand. */
export type ToolStep = {
  /** The tool, and what it was called with. The line a reader sees is derived
      from these at render time rather than stored — see `describeTool`. */
  name: string;
  args: Record<string, unknown>;
  /**
   * Whatever the model wrote immediately before making this call — its own
   * account of why it is about to do this.
   *
   * It used to be thrown away. Text arriving before a tool call is narration
   * by definition (the model kept working after writing it), so the answer
   * area was cleared to stop a wall of "I will now search Gmail…" standing
   * where the answer belongs. But deleting it meant that a model which wrote
   * real prose and *then* called another tool had its words vanish from the
   * screen mid-run — text appearing, disappearing and reappearing, which
   * reads as a bug because it is one.
   *
   * Moving it here fixes both: the answer area still shows only the answer,
   * and the narration becomes the step's own explanation instead of loss.
   */
  narration?: string;
  /** The run's tool-call number — see `onTool`. Absent on the skill row,
      which is added here rather than emitted by the server. */
  index?: number;
  /** For a search: what it found. Arrives after the step, in its own frame. */
  found?: FoundDoc[];
};

export type Verification = {
  ok: boolean;
  checked: number;
  findings: { kind: string; value: string; detail: string }[];
};

export type AskResult = {
  answer: string;
  verification: Verification;
  toolCalls: string[];
  /** Sources the answer cites, titled from the tool output that found them. */
  cited: OpenedItem[];
  /** Threads opened in full. */
  opened: OpenedItem[];
  /** Opened and then not cited — the honesty signal. */
  uncited: OpenedItem[];
  tookMs: number;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type AskHandlers = {
  /** `index` is the run's own tool-call counter, and it counts calls the
      trail hides too — so it is the only safe key for matching a later
      results frame to its step. Array position is not: hidden steps and the
      picked-skill row both shift it. */
  onTool: (name: string, args: Record<string, unknown>, index: number) => void;
  /** The documents step `index` found. Always arrives after that step's call. */
  onResults: (index: number, results: FoundDoc[]) => void;
  onDelta: (text: string) => void;
  onDone: (result: AskResult) => void;
  onError: (message: string) => void;
};

/** One completed exchange, as the server wants it re-sent: plain text only. */
export type Turn = { question: string; answer: string };

/**
 * Stream one agent run.
 *
 * fetch + ReadableStream rather than EventSource: the endpoint is a POST now,
 * because a whole conversation travels in the body and would not reliably fit
 * in a URL. The response is still SSE — the small parser below understands
 * exactly the frames our own server sends. Aborting the fetch closes the
 * socket, which the server treats as "stop the agent" — the run aborts rather
 * than burning tokens into a socket nobody is reading.
 *
 * Returns a function that cancels the run.
 */
export function ask(
  question: string,
  handlers: AskHandlers,
  history: Turn[] = [],
  skill: string | null = null,
): () => void {
  const controller = new AbortController();
  let finished = false;

  const fail = (message: string) => {
    if (finished) return;
    finished = true;
    handlers.onError(message);
  };

  const dispatch = (frame: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    const data = JSON.parse(dataLines.join("\n"));
    if (event === "tool") handlers.onTool(data.name, data.args ?? {}, data.index ?? -1);
    else if (event === "results") handlers.onResults(data.index ?? -1, data.results ?? []);
    else if (event === "delta") handlers.onDelta(data.text ?? "");
    else if (event === "done") {
      finished = true;
      handlers.onDone(data);
    } else if (event === "error") fail(data.message ?? "the agent failed");
    // "warning" frames exist and are deliberately not surfaced here, same as
    // the EventSource version never listened for them.
  };

  (async () => {
    let response: Response;
    try {
      response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, history, ...(skill ? { skill } : {}) }),
        signal: controller.signal,
      });
    } catch {
      if (!controller.signal.aborted) fail("lost the connection to Badger");
      return;
    }

    if (!response.ok || !response.body) {
      let message = "the agent failed";
      try {
        message = (await response.json()).error ?? message;
      } catch {
        // a non-JSON error page keeps the generic message
      }
      return fail(message);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let at: number;
        while ((at = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          if (frame.trim()) dispatch(frame);
        }
      }
      if (!finished) fail("lost the connection to Badger");
    } catch {
      if (!controller.signal.aborted) fail("lost the connection to Badger");
    }
  })();

  return () => {
    finished = true;
    controller.abort();
  };
}

/**
 * Split the agent's own trailing sections off the prose.
 *
 * Badger's skills tell it to end an answer with a **Sources** list and a
 * **Coverage** note. Both are worth keeping, but not inside the body: the
 * sources belong in the grid, which is built from verified citations rather
 * than from whatever the model typed, and coverage is a footnote. Rendering
 * all three would show the same links twice.
 *
 * Anything unrecognised is left in the body — a missing section is normal,
 * and swallowing prose would be much worse than a duplicated heading.
 */
export function splitAnswer(text: string): { body: string; coverage: string | null } {
  const source = String(text ?? "");
  const at = (heading: string) => {
    const match = source.match(new RegExp(`^\\s*\\*\\*${heading}\\b.*?\\*\\*:?`, "im"));
    return match?.index ?? -1;
  };

  const sourcesAt = at("Sources");
  const coverageAt = at("Coverage");

  const cut = [sourcesAt, coverageAt].filter((i) => i >= 0);
  const body = cut.length ? source.slice(0, Math.min(...cut)).trim() : source.trim();

  const coverage =
    coverageAt >= 0
      ? source
          .slice(coverageAt)
          .replace(/^\s*\*\*Coverage\b.*?\*\*:?/i, "")
          .trim() || null
      : null;

  // If the split leaves nothing, the model wrote only sections. Keep the
  // original rather than showing an empty answer.
  return { body: body || source.trim(), coverage };
}

/**
 * Turn a tool call into the line the user reads.
 *
 * **The tense follows the state.** The running step is happening now, so it
 * reads "Searching Drive"; a step that has finished reads "Searched Drive".
 * An earlier version used past tense throughout, on the argument that rows
 * persist so most rows a reader ever sees are finished ones — true of every
 * row except the one they are actually watching.
 *
 * That only works because the label is computed at RENDER time from the tool
 * name and arguments, rather than being computed once and stored on the step.
 * A stored label freezes whatever tense it had when the call was made, and it
 * freezes the wording too: conversations saved before this file last changed
 * still carried "Searching Gmail for “…”" long after the query came out of
 * the label. Deriving it from data that does not change fixes both, including
 * for conversations already in the database.
 *
 * All ten tools, not the five GitHub ones. The five Google tools fell through
 * to `default`, so while Badger searched the mailbox the status line read the
 * literal slug `gmail_search`.
 *
 * Mail and Drive are opened by opaque id, so there is nothing readable to name
 * — the line says what is being done rather than showing a raw id.
 *
 * **A search does not name its query.** It used to — `Searched Gmail for
 * “brightsmile march”` — and the query is the least useful thing on the row:
 * it is a keyword-reduced version of the question the reader just typed, so
 * it reads as the machine repeating them back, and it made the one row that
 * carries a result card the widest and noisiest in the trail. The query is
 * still one click away in the step's own arguments, where someone auditing
 * the work will look for it.
 */
export function describeTool(
  name: string,
  args: Record<string, unknown>,
  live = false,
): string {
  /** "Searching Drive" while it is happening, "Searched Drive" once it has. */
  const t = (now: string, done: string) => (live ? now : done);

  switch (name) {
    case "github_search":
      return t("Searching GitHub", "Searched GitHub");
    case "github_issue":
      return t(`Reading issue #${args.number}`, `Read issue #${args.number}`);
    case "github_pr":
      return t(`Reading PR #${args.number}`, `Read PR #${args.number}`);
    case "github_file":
      return t(`Opening ${args.path}`, `Opened ${args.path}`);
    case "github_commits":
      return t("Reading recent commits", "Read recent commits");
    case "gmail_search":
      return t("Searching Gmail", "Searched Gmail");
    case "gmail_thread":
      return t("Reading a mail thread", "Read a mail thread");
    case "drive_search":
      return t("Searching Drive", "Searched Drive");
    case "drive_file":
      return t("Reading a document", "Read a document");
    case "drive_comments":
      return t(
        "Reading the comments on a document",
        "Read the comments on a document",
      );
    case "memory":
      return args.action === "save"
        ? t("Saving to memory", "Saved to memory")
        : t("Recalling memory", "Recalled memory");
    // A skill the MODEL chose. See `skillFromRead` — this is a plain file
    // read, and the path is what makes it a skill. No tense: using a skill is
    // a state that holds for the rest of the run, not an act that completes.
    case "read": {
      const slug = skillFromRead(args);
      return slug ? `Using ${skillDisplayName(slug)}` : t("Reading a file", "Read a file");
    }
    // The skill the USER chose, seeded by the composer rather than emitted by
    // the runtime. Same wording, so the two are indistinguishable on screen —
    // which is right, because to the reader they are the same event.
    case "skill":
      return `Using ${skillDisplayName(String(args.skill ?? ""))}`;
    default:
      return name;
  }
}

/**
 * The skill a `read` call is loading, if that is what it is doing.
 *
 * **This is how a self-chosen skill becomes visible, and it took reading the
 * runtime to find.** GAP has no skill concept at the tool layer: no skill
 * tool, no skill event, nothing to subscribe to. What it has is a block in
 * the system prompt — `formatSkillsForPrompt` in the runtime's `skills.js` —
 * instructing the model to "load its full instructions using the `read` tool:
 * `skills/<name>/SKILL.md`". So loading a skill IS a file read, and the path
 * is the entire signal.
 *
 * Which means the earlier note in this project — that the runtime cannot tell
 * us which skill is in play, so only a hand-picked one can ever be shown —
 * was wrong. It can, as long as you look at the argument rather than the tool
 * name.
 *
 * Anchored to `skills/` and `/SKILL.md` so an ordinary read of some other
 * file, or of a skill's `references/`, does not masquerade as a skill firing.
 */
export function skillFromRead(args: Record<string, unknown>): string | null {
  const path = typeof args.path === "string" ? args.path : "";
  return path.match(/(?:^|\/)skills\/([a-z0-9-]+)\/SKILL\.md$/)?.[1] ?? null;
}

/**
 * Which tool calls get a line in the trail.
 *
 * Every step is written in the past tense above, including the one currently
 * running. That looks wrong for about a second and is right for the rest of
 * the conversation: rows now persist rather than being overwritten, so almost
 * every row a reader ever looks at is a finished one. Claude's own trail does
 * the same ("Loaded plugins skill" while it is loading).
 *
 * The hidden set is the runtime's bookkeeping — `task_tracker` writing down
 * what it is about to do, `skill_learner` reflecting afterwards, and the file
 * and shell tools, which a read-only agent should never reach anyway. None of
 * it tells the reader anything about the answer, and a twelve-turn run spent
 * half its rows on it.
 *
 * Two runtime tools are deliberately NOT in that set. "Recalled memory" and
 * "Using Find an expert" are the rows that show what Badger actually is — a
 * git repo whose skills and memory are files it reads — and they are the rows
 * Claude shows too. The second is a `read`, which is why this takes arguments.
 */
const HIDDEN_TOOLS = new Set(["task_tracker", "skill_learner", "write", "edit", "cli"]);

/**
 * `read` is the exception, and it has to be decided on the arguments rather
 * than the name: a read of `skills/<name>/SKILL.md` is the agent picking a
 * skill and is the most interesting row in the trail, while every other read
 * is the runtime shuffling files about.
 */
export function isStepVisible(name: string, args: Record<string, unknown> = {}): boolean {
  if (name === "read") return skillFromRead(args) !== null;
  return !HIDDEN_TOOLS.has(name);
}

/**
 * The one-line summary the collapsed trail carries — "Searched GitHub and
 * Gmail, read 3 threads". Built from what the run did rather than from a
 * count, because "Worked through 9 steps" says nothing about the answer.
 */
export function summariseSteps(steps: ToolStep[]): string {
  if (steps.length === 0) return "Answered without searching";

  const searched = [
    ...new Set(
      steps
        .filter((s) => s.name.endsWith("_search"))
        .map((s) => ({ github_search: "GitHub", gmail_search: "Gmail", drive_search: "Drive" })[s.name])
        .filter(Boolean) as string[],
    ),
  ];
  const opened = steps.filter((s) =>
    ["github_issue", "github_pr", "github_file", "gmail_thread", "drive_file"].includes(s.name),
  ).length;

  const parts: string[] = [];
  // The skill leads, when there is one. It is the thing that shaped every
  // step after it, and it is the one row that says this is a GAP agent
  // rather than a search box with a model attached.
  const skill = steps.find((s) => s.args.skill)?.args.skill;
  if (skill) parts.push(`Used ${skillDisplayName(String(skill))}`);
  if (searched.length) parts.push(`${skill ? "searched" : "Searched"} ${listOf(searched)}`);
  if (opened) parts.push(`read ${opened} ${opened === 1 ? "source" : "sources"}`);
  if (steps.some((s) => s.name === "memory")) parts.push("checked memory");

  // A run made entirely of steps this summary has no phrase for still needs a
  // line, and the count is the honest fallback.
  if (parts.length === 0) {
    return `Worked through ${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
  }
  return parts.join(", ");
}

/** "GitHub", "GitHub and Gmail", "GitHub, Gmail and Drive". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** A skill as the server lists it, for the picker. */
export type SkillInfo = {
  slug: string;
  name: string;
  description: string;
  origin: "handwritten" | "learned" | "custom";
};

export async function fetchSkills(): Promise<SkillInfo[]> {
  const res = await fetch("/api/skills");
  if (!res.ok) return [];
  return (await res.json()).skills ?? [];
}

export async function createSkill(
  input: { name: string; description: string; instructions: string } | { file: string },
): Promise<{ slug?: string; error?: string }> {
  const res = await fetch("/api/skills", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { slug: data.slug } : { error: data.error ?? "could not save the skill" };
}

/** The plain name a person sees for a skill slug. */
export function skillDisplayName(slug: string): string {
  const named: Record<string, string> = {
    "recent-activity": "Recent activity",
    "find-expert": "Find an expert",
    "trace-decision": "Explain a decision",
    "onboard-to-project": "Catch me up",
  };
  return named[slug] ?? slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}
