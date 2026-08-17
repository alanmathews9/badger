import { MessagesSquare, Search, Wrench } from "lucide-react";
import { BadgerBadge } from "./BadgerMark";
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

export type Mode = "search" | "chat" | "tools";

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
}: {
  mode: Mode;
  onModeChange: (next: Mode) => void;
  digs: Dig[];
  onPickDig: (query: string) => void;
  budget: { answersRemaining: number; answersToday: number } | null;
}) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-1 py-1.5 group-data-[collapsible=icon]:px-0">
          <BadgerBadge size={26} />
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">badger</div>
          </div>
          <SidebarTrigger className="shrink-0 text-stone-500 group-data-[collapsible=icon]:hidden" />
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
                  <span className="ml-auto shrink-0 group-data-[collapsible=icon]:hidden">
                    <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
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

        <div className="flex items-center gap-2.5 px-1 group-data-[collapsible=icon]:px-0">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-200 text-[10px] font-medium">
            AM
          </span>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-[12.5px] font-medium">Demo session</div>
            <div className="truncate font-mono text-[10px] text-stone-500">read-only</div>
          </div>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
