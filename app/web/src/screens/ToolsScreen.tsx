import { useState } from "react";
import { Settings2 } from "lucide-react";
import { BRAND_LOGOS } from "@/components/BrandLogos";
import { ManageConnections } from "@/components/ManageConnections";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SourcesResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * What Badger can reach.
 *
 * Connecting is the real Composio flow, and it lives behind Manage rather than
 * on the card: a card should say what the state is, not carry the whole
 * lifecycle. State is a dot — green connected, grey not — because the word
 * "Connected" beside a green dot says the same thing twice.
 *
 * Unbuilt integrations render disabled with a "coming soon" tooltip rather
 * than hidden: the roadmap is part of the pitch, and a missing card reads as
 * an oversight rather than a decision.
 */

const CATALOGUE = [
  { id: "github", name: "GitHub", description: "Issues, pull requests, files and commits." },
  { id: "drive", name: "Google Drive", description: "Docs, sheets and slides." },
  { id: "gmail", name: "Gmail", description: "Threads and attachments." },
];

export function ToolsScreen({
  sources,
  onRefresh,
}: {
  sources: SourcesResponse;
  onRefresh: () => void;
}) {
  const [managing, setManaging] = useState(false);

  return (
    <div className="flex h-dvh flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 px-4">
        <h1 className="text-[15px] font-semibold">Tools</h1>
        <span className="font-mono text-[11px] text-stone-500">
          {sources.mode === "own"
            ? sources.repo ?? "choose a repository"
            : sources.mode === "demo"
              ? "shared demo corpus"
              : "nothing connected"}
        </span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="grid max-w-[1100px] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CATALOGUE.map((tool) => {
            const source = sources.sources.find((s) => s.id === tool.id);
            const isGithub = tool.id === "github";
            const connected = Boolean(source?.connected);
            const Logo = BRAND_LOGOS[tool.id];

            const card = (
              <div
                className={cn(
                  "flex h-full flex-col rounded-xl border border-stone-200 p-4",
                  isGithub ? "bg-white" : "bg-stone-50/60",
                )}
              >
                <div className="flex items-start justify-between">
                  <span
                    className={cn(
                      "inline-flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-white",
                      !isGithub && "opacity-45 grayscale",
                    )}
                  >
                    <Logo size={22} />
                  </span>
                  <span
                    className={cn(
                      "mt-1 size-2 rounded-full",
                      connected ? "bg-emerald-500" : "bg-stone-300",
                    )}
                    title={connected ? "Connected" : "Not connected"}
                  />
                </div>

                <h2
                  className={cn(
                    "mt-3 text-[15px] font-semibold",
                    isGithub ? "text-stone-900" : "text-stone-500",
                  )}
                >
                  {tool.name}
                </h2>
                <p
                  className={cn(
                    "mt-1.5 flex-1 text-[12.5px]/[1.6]",
                    isGithub ? "text-stone-600" : "text-stone-400",
                  )}
                >
                  {tool.description}
                </p>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-stone-100 pt-3">
                  <span className="truncate font-mono text-[10.5px] text-stone-500">
                    {isGithub
                      ? sources.mode === "own"
                        ? sources.repo ?? "no repository chosen"
                        : sources.mode === "demo"
                          ? "demo corpus"
                          : "not connected"
                      : "not connected"}
                  </span>
                  {isGithub && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setManaging(true)}
                      className="h-7 shrink-0 gap-1.5 px-2.5 text-[11.5px]"
                    >
                      <Settings2 className="size-3" />
                      Manage
                    </Button>
                  )}
                </div>
              </div>
            );

            return isGithub ? (
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
      </main>

      <ManageConnections open={managing} onOpenChange={setManaging} onChanged={onRefresh} />
    </div>
  );
}
