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

/** One tool call, kept whole so the step trail can show its detail on demand. */
export type ToolStep = {
  /** The plain-language line: "Searching Drive for “offboarding process”". */
  label: string;
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
  onTool: (name: string, args: Record<string, unknown>) => void;
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
    if (event === "tool") handlers.onTool(data.name, data.args ?? {});
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
 * Turn a tool call into the line the user reads while waiting.
 *
 * All ten tools, not the five GitHub ones. The five Google tools fell through
 * to `default`, so while Badger searched the mailbox the status line read the
 * literal slug `gmail_search`.
 *
 * Mail and Drive are opened by opaque id, so there is nothing readable to name
 * — the line says what is being done rather than showing a raw id.
 */
export function describeTool(name: string, args: Record<string, unknown>): string {
  const q = typeof args.query === "string" ? args.query.replace(/\s*in:[\w,]+/g, "").trim() : "";
  const searching = (where: string) => (q ? `Searching ${where} for “${q}”` : `Searching ${where}`);

  switch (name) {
    case "github_search":
      return searching("GitHub");
    case "github_issue":
      return `Reading issue #${args.number} and its comments`;
    case "github_pr":
      return `Reading PR #${args.number} and its review`;
    case "github_file":
      return `Opening ${args.path}`;
    case "github_commits":
      return "Reading recent commits";
    case "gmail_search":
      return searching("Gmail");
    case "gmail_thread":
      return "Reading a mail thread";
    case "drive_search":
      return searching("Drive");
    case "drive_file":
      return "Reading a document";
    case "drive_comments":
      return "Reading the comments on a document";
    // The learning loop and the runtime's own tools, phrased as what the
    // agent is doing rather than as internal slugs.
    case "task_tracker":
      return args.action === "end" ? "Wrapping up" : "Noting the task";
    case "skill_learner":
      return "Reflecting on what worked";
    case "memory":
      return args.action === "save" ? "Saving to memory" : "Checking memory";
    case "read":
      return "Reading a file";
    case "write":
    case "edit":
      return "Writing a file";
    case "cli":
      return "Running a command";
    default:
      return name;
  }
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
