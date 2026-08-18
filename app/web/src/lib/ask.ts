/** What a tool call opened or the answer cited, across all three sources. */
export type OpenedItem = {
  kind: "issue" | "pr" | "file" | "mail" | "doc";
  /** An id for GitHub; the subject or document name for mail and Drive. */
  ref: string;
  label: string;
  /** "issue #12, open" — recovered from tool output, absent for plain opens. */
  detail?: string;
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

/**
 * Stream one agent run.
 *
 * EventSource rather than fetch+ReadableStream: the endpoint is a GET, the
 * browser handles reconnection semantics, and closing it aborts the run
 * server-side — the agent stops rather than burning tokens into a socket
 * nobody is reading.
 *
 * Returns a function that cancels the run.
 */
export function ask(question: string, handlers: AskHandlers, context?: string): () => void {
  const url =
    `/api/ask?q=${encodeURIComponent(question)}` +
    (context ? `&context=${encodeURIComponent(context)}` : "");
  const source = new EventSource(url);
  let finished = false;

  source.addEventListener("tool", (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    handlers.onTool(data.name, data.args ?? {});
  });

  source.addEventListener("delta", (e) => {
    handlers.onDelta(JSON.parse((e as MessageEvent).data).text ?? "");
  });

  source.addEventListener("done", (e) => {
    finished = true;
    handlers.onDone(JSON.parse((e as MessageEvent).data));
    source.close();
  });

  source.addEventListener("error", (e) => {
    // Two different things arrive here: an "error" event the server sent with
    // a message, and EventSource's own transport failure, which carries none.
    const data = (e as MessageEvent).data;
    if (data) {
      finished = true;
      handlers.onError(JSON.parse(data).message ?? "the agent failed");
    } else if (!finished) {
      handlers.onError("lost the connection to Badger");
    }
    source.close();
  });

  return () => {
    finished = true;
    source.close();
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
    default:
      return name;
  }
}
