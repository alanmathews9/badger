import type { AskResult, ToolStep } from "@/lib/ask";

export type AnswerState = {
  running: boolean;
  /** Every tool call this run made, kept whole — the trail stays on screen. */
  steps: ToolStep[];
  text: string;
  result: AskResult | null;
  error: string | null;
  /**
   * The run was stopped by the user, rather than failing.
   *
   * Separate from `error` because they deserve different weight: a failure is
   * something Badger did wrong and should be visible, an interruption is
   * something the reader chose and should be quiet. Both leave a turn with no
   * answer, so without this flag one had to be styled as the other.
   */
  stopped?: boolean;
};

/**
 * `AnswerCard` used to live here — the inverse block that streamed the agent's
 * answer above the search results. It was deleted when the agent came off the
 * search path: search is retrieval only now, and nothing rendered it any more.
 *
 * `tsc` does not catch an exported component that no importer uses, so this
 * kind of orphan survives a clean build. Worth checking by hand after removing
 * a screen.
 *
 * `VerificationBadge` has now gone the same way. It reported "N citations,
 * all retrieved" inside the expanded step trail — a panel almost nobody
 * opens, so the claim was made where it could not be read. The check itself
 * is untouched and still runs on every answer: `verifyCitations` marks any
 * citation it cannot find in a tool result as `[UNVERIFIED]` inline, which is
 * where it actually changes what a reader believes.
 *
 * The file keeps its name for the one thing still in use: the answer state
 * Chat drives.
 */
