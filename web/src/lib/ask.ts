/** What a tool call opened, so the answer can be measured against it. */
export type OpenedItem = { kind: "issue" | "pr" | "file"; ref: string; label: string };

export type Verification = {
  ok: boolean;
  checked: number;
  findings: { kind: string; value: string; detail: string }[];
};

export type AskResult = {
  answer: string;
  verification: Verification;
  toolCalls: string[];
  opened: OpenedItem[];
  cited: OpenedItem[];
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
export function ask(question: string, handlers: AskHandlers): () => void {
  const source = new EventSource(`/api/ask?q=${encodeURIComponent(question)}`);
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

/** Turn a tool call into the line the user reads while waiting. */
export function describeTool(name: string, args: Record<string, unknown>): string {
  const q = typeof args.query === "string" ? args.query.replace(/\s*in:[\w,]+/g, "").trim() : "";
  switch (name) {
    case "github_search":
      return q ? `Searching for “${q}”` : "Searching";
    case "github_issue":
      return `Reading issue #${args.number} and its comments`;
    case "github_pr":
      return `Reading PR #${args.number} and its review`;
    case "github_file":
      return `Opening ${args.path}`;
    case "github_commits":
      return "Reading recent commits";
    default:
      return name;
  }
}
