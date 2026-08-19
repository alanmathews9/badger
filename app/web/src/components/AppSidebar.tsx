import { MessagesSquare, Search, Wrench } from "lucide-react";
import { BadgerBadge } from "./BadgerMark";
import { BRAND_LOGOS } from "./BrandLogos";
import {
  Sidebar,
  SidebarTrigger,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { Dig } from "@/lib/recentDigs";
import type { SourceId, SourcesResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

export type Mode = "search" | "chat" | "tools";

/** Fixed order, so the marks do not reshuffle when a source reconnects. */
const SOURCE_ORDER: SourceId[] = ["github", "drive", "gmail"];

/**
 * The left rail.
 *
 * Two destinations, not one: Search is the fast keyword pass, Chat is the
 * agent. They were fused before — one Dig ran both — which made it impossible
 * to say which half was slow or which half you were looking at.
 *
 * The usage meter at the bottom reports the real answer budget from
 * /api/health rather than being decoration. It is the one number that decides
 * whether the next question will work, so it belongs where it is always
 * visible.
 */
export function AppSidebar({
  mode,
  onModeChange,
  digs,
  onPickDig,
  budget,
  sources,
}: {
  sources?: SourcesResponse;
  mode: Mode;
  onModeChange: (next: Mode) => void;
  digs: Dig[];
  onPickDig: (query: string) => void;
  budget: { answersRemaining: number; answersToday: number } | null;
}) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* Collapsed, the rail is too narrow to hold the mark and the toggle
            side by side — they stack instead, so the toggle stays inside the
            rail and reachable. It used to be hidden when collapsed, which
            left no way at all to reopen the sidebar. */}
        <div className="flex items-center gap-2.5 px-1 py-1.5 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1.5 group-data-[collapsible=icon]:px-0">
          <BadgerBadge size={26} />
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">badger</div>
          </div>
          <SidebarTrigger className="shrink-0 rounded-full text-stone-500 group-data-[collapsible=icon]:border group-data-[collapsible=icon]:border-stone-200 group-data-[collapsible=icon]:bg-white" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={mode === "search"}
                  onClick={() => onModeChange("search")}
                  tooltip="Search"
                >
                  <Search />
                  <span>Search</span>
                  <span className="ml-auto font-mono text-[10.5px] text-stone-400 group-data-[collapsible=icon]:hidden">
                    ⌘K
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={mode === "chat"}
                  onClick={() => onModeChange("chat")}
                  tooltip="Chat"
                >
                  <MessagesSquare />
                  <span>Chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={mode === "tools"}
                  onClick={() => onModeChange("tools")}
                  tooltip="Tools"
                >
                  <Wrench />
                  <span>Tools</span>
                  {/*
                    The three marks, rather than a status dot.
                
                    A dot says "something is connected" and this one said it
                    unconditionally — it was a hard-coded emerald circle that
                    stayed green whether or not anything was reachable. The marks
                    say *which* sources, which is the thing worth knowing at a
                    glance, and they are driven by /api/sources so a source that
                    drops out fades instead of lying.
                
                    Kept deliberately quiet: 13px, dimmed, and behind the label.
                    This is a status indicator that happens to be legible, not a
                    row of logos competing with the navigation.
                  */}
                  <span className="ml-auto flex shrink-0 items-center gap-1 group-data-[collapsible=icon]:hidden">
                    {SOURCE_ORDER.map((id) => {
                      const Logo = BRAND_LOGOS[id];
                      const live = sources?.sources.find((s) => s.id === id)?.connected ?? false;
                      return (
                        <Logo
                          key={id}
                          size={13}
                          className={cn(
                            "transition-opacity",
                            live ? "opacity-60" : "opacity-20 grayscale",
                          )}
                        />
                      );
                    })}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>


        {digs.length > 0 && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Recent digs</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {digs.slice(0, 6).map((dig) => (
                  <SidebarMenuItem key={dig.query}>
                    <SidebarMenuButton
                      onClick={() => onPickDig(dig.query)}
                      className="text-stone-600"
                    >
                      <span className="truncate">{dig.query}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="gap-3">
        {budget && (
          <div className="rounded-lg border border-sidebar-border bg-white px-3 py-2.5 group-data-[collapsible=icon]:hidden">
            <div className="flex items-baseline justify-between">
              <span className="text-[11.5px] font-medium text-stone-700">Answers today</span>
              <span className="font-mono text-[11px] text-stone-500">
                {budget.answersToday}/{budget.answersToday + budget.answersRemaining}
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-stone-200">
              <div
                className="h-full rounded-full bg-stone-900 transition-[width]"
                style={{
                  width: `${Math.min(100, (budget.answersToday / Math.max(1, budget.answersToday + budget.answersRemaining)) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-1.5 text-[10.5px] leading-snug text-stone-500">
              Search always works. The daily cap applies to written answers.
            </p>
          </div>
        )}

      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
