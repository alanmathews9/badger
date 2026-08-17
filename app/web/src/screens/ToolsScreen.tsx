import { Check } from "lucide-react";
import { BRAND_LOGOS } from "@/components/BrandLogos";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Source } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * What Badger can reach, and what it cannot yet.
 *
 * This replaced a "Sources" list in the sidebar. The rail could show a name and
 * a dot; it had no room to say what a connection actually grants, which is the
 * part that matters when the credential behind it is the thing a reviewer will
 * ask about. It is also where the connect flow will live once per-user
 * connections exist.
 *
 * Unbuilt integrations are rendered disabled with a "coming soon" tooltip
 * rather than hidden. The roadmap is part of the pitch, and a missing card
 * reads as an oversight rather than a decision.
 */

type ToolCard = {
  id: string;
  name: string;
  description: string;
  /** Read-only operations the agent can actually call. */
  operations: number | null;
};

const CATALOGUE: ToolCard[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Issues, pull requests, files and commits.",
    operations: 5,
  },
  {
    id: "drive",
    name: "Google Drive",
    description: "Docs, sheets and slides.",
    operations: null,
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Threads and attachments.",
    operations: null,
  },
];

export function ToolsScreen({ sources }: { sources: Source[] }) {
  const connected = (id: string) => sources.find((s) => s.id === id)?.connected ?? false;
  const detail = (id: string) => sources.find((s) => s.id === id)?.detail ?? "";
  const connectedCount = CATALOGUE.filter((t) => connected(t.id)).length;

  return (
    <div className="flex h-dvh flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 px-4">
        <h1 className="text-[15px] font-semibold">Tools</h1>
        <span className="font-mono text-[11px] text-stone-500">
          {connectedCount} of {CATALOGUE.length} connected
        </span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-[1100px]">

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CATALOGUE.map((tool) => {
              const isConnected = connected(tool.id);
              const Logo = BRAND_LOGOS[tool.id];
              const card = (
                <div
                  className={cn(
                    "flex h-full flex-col rounded-xl border border-stone-200 p-4 transition-colors",
                    isConnected ? "bg-white hover:border-stone-300" : "bg-stone-50/60",
                  )}
                >
                  <div className="flex items-start justify-between">
                    <span
                      className={cn(
                        "inline-flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-white",
                        !isConnected && "opacity-45 grayscale",
                      )}
                    >
                      <Logo size={22} />
                    </span>
                    {isConnected ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700">
                        <Check className="size-3" strokeWidth={2.5} />
                        Connected
                      </span>
                    ) : (
                      <span className="rounded-full border border-stone-200 px-2 py-0.5 font-mono text-[10px] text-stone-400">
                        soon
                      </span>
                    )}
                  </div>

                  <h2
                    className={cn(
                      "mt-3 text-[15px] font-semibold",
                      isConnected ? "text-stone-900" : "text-stone-500",
                    )}
                  >
                    {tool.name}
                  </h2>
                  <p
                    className={cn(
                      "mt-1.5 flex-1 text-[12.5px]/[1.6]",
                      isConnected ? "text-stone-600" : "text-stone-400",
                    )}
                  >
                    {tool.description}
                  </p>

                  <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3">
                    <span className="rounded-md bg-stone-100 px-2 py-1 text-[10.5px] font-medium text-stone-600">
                      Composio
                    </span>
                    <span className="truncate font-mono text-[10.5px] text-stone-500">
                      {isConnected
                        ? `${tool.operations} read-only tools · ${detail(tool.id)}`
                        : "not connected"}
                    </span>
                  </div>
                </div>
              );

              return isConnected ? (
                <div key={tool.id}>{card}</div>
              ) : (
                <Tooltip key={tool.id}>
                  <TooltipTrigger asChild>
                    <div className="cursor-not-allowed">{card}</div>
                  </TooltipTrigger>
                  <TooltipContent>Coming soon</TooltipContent>
                </Tooltip>
              );
            })}
          </div>

        </div>
      </main>
    </div>
  );
}
