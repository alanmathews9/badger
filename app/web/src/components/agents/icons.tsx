import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The colours an agent can be drawn in.
 *
 * COLOUR RATHER THAN GLYPH. Every agent is the same thing — a bot with its own
 * instructions — so a different picture for each says less than a different
 * colour does: the mark is a label you learn once and then recognise at a
 * glance, and sixteen glyphs made that harder rather than easier.
 *
 * A fixed set rather than a free value: the mark appears beside every answer
 * the agent writes, and an arbitrary colour there can be made to look like the
 * product's own chrome. The names are what the manifest stores
 * (`metadata.color`); the server checks only their shape, so this list is the
 * one place that decides which exist, and a manifest naming one we dropped
 * falls back to the first rather than rendering nothing.
 *
 * Written as whole class strings because Tailwind scans for literals — a
 * `bg-${name}` built at runtime is a class that never gets generated.
 */
export const AGENT_COLORS: Record<string, string> = {
  clay: "bg-[#c96442] text-white",
  amber: "bg-[#c08a2e] text-white",
  moss: "bg-[#4f7a52] text-white",
  teal: "bg-[#3d7d7b] text-white",
  ocean: "bg-[#3c6398] text-white",
  violet: "bg-[#6f5aa8] text-white",
  plum: "bg-[#964f75] text-white",
  slate: "bg-[#4a4a44] text-white",
};

export const AGENT_COLOR_NAMES = Object.keys(AGENT_COLORS);

export const DEFAULT_AGENT_COLOR = AGENT_COLOR_NAMES[0];

/** The classes for one colour, falling back to the default for a name we dropped. */
export function agentColorClass(color?: string | null): string {
  return AGENT_COLORS[color ?? ""] ?? AGENT_COLORS[DEFAULT_AGENT_COLOR];
}

/**
 * An agent's mark: the bot glyph on its own colour.
 *
 * `size` is the square's edge in pixels. The glyph is drawn at 60% of it, so
 * the mark keeps the same proportions at every size it is used — 20px beside
 * an answer, 28px on a card, 34px over an empty Playground.
 */
export function AgentMark({
  color,
  size = 28,
  className,
}: {
  color?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[28%]",
        agentColorClass(color),
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Bot style={{ width: size * 0.6, height: size * 0.6 }} strokeWidth={1.9} />
    </span>
  );
}
