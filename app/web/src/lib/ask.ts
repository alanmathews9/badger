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
 * Found, not cited and not necessarily read. `OpenedItem` above is what was
 * opened in full and what the answer cited.
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
   * Whatever the model wrote immediately before this call — its account of why.
   *
   * Text arriving before a tool call is narration by definition, so it is kept
   * out of the answer area; keeping it here rather than discarding it means
   * real prose written mid-run does not vanish off the screen.
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
 * The one thing a failed run says, in red, under the step trail.
 *
 * Every internal failure string names components the reader has never heard
 * of. A new chat is the real remedy: a failed run leaves the conversation
 * holding an answerless turn that the next question carries back in.
 *
 * NOT used for a refusal the server explains itself — a spent budget or a rate
 * limit, where "try again in a new chat" would be wrong advice.
 */
const RUN_FAILED = "Badger failed to respond, try again in a new chat.";

/**
 * Stream one agent run.
 *
 * fetch + ReadableStream rather than EventSource, because a whole conversation
 * travels in the POST body. The response is still SSE.
 *
 * Returns a function that cancels the run — on screen. Aborting closes the
 * socket and frees the concurrency slot, but the run continues to its turn
 * limit: `query().abort()` is a no-op (docs/UPSTREAM.md finding 4).
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
    } else if (event === "error") fail(RUN_FAILED);
    // "warning" frames exist and are deliberately not surfaced.
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
      if (!controller.signal.aborted) fail(RUN_FAILED);
      return;
    }

    if (!response.ok || !response.body) {
      let message = RUN_FAILED;
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
      if (!finished) fail(RUN_FAILED);
    } catch {
      if (!controller.signal.aborted) fail(RUN_FAILED);
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
 * Skills tell the agent to end with **Sources** and **Coverage**. The sources
 * belong in the grid, built from verified citations rather than what the model
 * typed, and coverage is a footnote — inside the body they render twice.
 *
 * Anything unrecognised stays in the body: swallowing prose is worse than a
 * duplicated heading.
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

  // Only sections and no prose: keep the original rather than show nothing.
  return { body: body || source.trim(), coverage };
}

/**
 * Turn a tool call into the line the user reads.
 *
 * The tense follows the state: "Searching Drive" while it runs, "Searched
 * Drive" once done. This works only because the label is computed at RENDER
 * time from the tool name and arguments — a stored label freezes both its
 * tense and its wording into every conversation already saved.
 *
 * All ten tools. Mail and Drive are opened by opaque id, so the line says what
 * is being done rather than showing the id.
 *
 * A search does not name its query: it is a keyword-reduced echo of what the
 * reader just typed, and it is one click away in the step's arguments.
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
    // A skill the MODEL chose — a plain file read, identified by its path. No
    // tense: using a skill is a state, not an act that completes.
    case "read": {
      const slug = skillFromRead(args);
      return slug ? `Using ${skillDisplayName(slug)}` : t("Reading a file", "Read a file");
    }
    // The skill the USER chose, seeded by the composer. Same wording: to the
    // reader the two are the same event.
    case "skill":
      return `Using ${skillDisplayName(String(args.skill ?? ""))}`;
    default:
      return name;
  }
}

/**
 * The skill a `read` call is loading, if that is what it is doing.
 *
 * GAP has no skill concept at the tool layer — no skill tool, no event. What
 * it has is a system-prompt block telling the model to `read`
 * `skills/<name>/SKILL.md`, so loading a skill IS a file read and the path is
 * the whole signal.
 *
 * Anchored to `skills/` and `/SKILL.md` so an ordinary read, or a read of a
 * skill's `references/`, does not masquerade as a skill firing.
 */
export function skillFromRead(args: Record<string, unknown>): string | null {
  const path = typeof args.path === "string" ? args.path : "";
  return path.match(/(?:^|\/)skills\/([a-z0-9-]+)\/SKILL\.md$/)?.[1] ?? null;
}

/**
 * Which tool calls get a line in the trail.
 *
 * The hidden set is the runtime's bookkeeping — task_tracker, skill_learner,
 * and the file and shell tools. None of it says anything about the answer, and
 * a twelve-turn run spent half its rows on it.
 *
 * Memory and skill reads are deliberately NOT hidden: they are the rows that
 * show this is a git repo whose skills and memory are files it reads. The
 * second is a `read`, which is why this takes arguments.
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
 * The collapsed trail's one-line summary — "Searched GitHub and Gmail, read 3
 * threads". From what the run did, not a step count.
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
  // The skill leads when there is one: it shaped every step after it.
  const skill = steps.find((s) => s.args.skill)?.args.skill;
  if (skill) parts.push(`Used ${skillDisplayName(String(skill))}`);
  if (searched.length) parts.push(`${skill ? "searched" : "Searched"} ${listOf(searched)}`);
  if (opened) parts.push(`read ${opened} ${opened === 1 ? "source" : "sources"}`);
  if (steps.some((s) => s.name === "memory")) parts.push("checked memory");

  // A run of steps with no phrase still needs a line; the count is the
  // fallback.
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

export async function createSkill(input: { file: string }): Promise<{ slug?: string; error?: string }> {
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

// ── The slash-command picker, shared ──────────────────────────────────────
//
// The chat composer and the home bar both let you name a skill by typing "/".
// These three live here so the two cannot drift on which skills are offered,
// how the filter narrows them, or how "/slug question" is split apart.

/**
 * Which skills the picker offers.
 *
 * Not all of them: some are procedures the agent should reach for on its own,
 * and a full menu invites picking a skill as a category.
 */
export function pickableSkills(skills: SkillInfo[], filter = ""): SkillInfo[] {
  const f = filter.toLowerCase();
  return skills
    .filter((s) => ["recent-activity", "find-expert"].includes(s.slug) || s.origin === "custom")
    .filter((s) => s.slug.includes(f) || skillDisplayName(s.slug).toLowerCase().includes(f));
}

/**
 * The half-typed slug after a leading "/", or null.
 *
 * Null once a command is already settled — the token has become a chip and
 * what follows is the question, not more of the command.
 */
export function slashFilter(draft: string, command: string | null): string | null {
  if (command) return null;
  const m = draft.match(/^\/(\S*)$/);
  return m ? m[1] : null;
}

/**
 * Split a draft into the question and the skill it names, or null if there is
 * nothing sendable.
 *
 * Two ways a skill can be named and both are honoured: picked from the menu,
 * which arrives as `command`, or typed by hand as "/slug the question". A
 * hand-typed slug counts only if it is a real one — otherwise "/foo bar" would
 * send "bar" and silently drop what the person thought they had asked for.
 */
export function parseSkillCommand(
  draft: string,
  command: string | null,
  skills: SkillInfo[],
): { question: string; skill: string | null } | null {
  let next = draft.trim();
  if (!next) return null;
  let skill = command;
  const typed = next.match(/^\/([a-z0-9-]+)\s+([\s\S]+)$/);
  if (!skill && typed && skills.some((s) => s.slug === typed[1])) {
    skill = typed[1];
    next = typed[2].trim();
  }
  // Still a bare command with no question behind it: nothing to send.
  if (!next || next.startsWith("/")) return null;
  return { question: next, skill };
}

/** One skill with its raw SKILL.md, for the manage page. */
export type SkillFile = SkillInfo & { content: string };

export async function fetchSkill(slug: string): Promise<SkillFile | null> {
  const res = await fetch(`/api/skills/${encodeURIComponent(slug)}`);
  return res.ok ? await res.json() : null;
}

/**
 * Overwrite a skill's file.
 *
 * The whole SKILL.md, because that is what the editor holds. Sending fields
 * and letting the server stitch them into the existing frontmatter was the
 * earlier design, and it meant the server owned `license`, `allowed-tools` and
 * `metadata` on every save while the pane never showed them.
 */
export async function saveSkill(slug: string, content: string): Promise<{ error?: string }> {
  const res = await fetch(`/api/skills/${encodeURIComponent(slug)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? {} : { error: data.error ?? "could not save the skill" };
}

export async function removeSkill(slug: string): Promise<{ error?: string }> {
  const res = await fetch(`/api/skills/${encodeURIComponent(slug)}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  return res.ok ? {} : { error: data.error ?? "could not delete the skill" };
}

// `parseSkill` used to live here, splitting a file into "the trigger", "the
// steps" and the counters so the pane could show three tidy sections. It went
// with the editor: the pane shows the file now, whole, which is both simpler
// and more honest — the runtime reads the file, so that is what you should
// see.

/**
 * Hand the file to the browser as a download.
 *
 * A blob URL rather than a link to the API: the endpoint answers JSON, and
 * this way the saved file is the SKILL.md itself rather than a JSON wrapper
 * around it. Available for built-in skills too — it is the whole escape hatch
 * for them, since they cannot be edited in place. Take a copy, change it,
 * upload it under your own name.
 */
export function downloadSkill(slug: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}.SKILL.md`;
  a.click();
  // Revoked on the next tick, not immediately. A blob URL torn down in the
  // same statement as the click races whatever the browser does to start the
  // save, and the failure mode is a download that silently produces nothing.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
