import { MessagesSquare, Search, Wrench } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
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
import type { SearchEntry } from "@/lib/history";
import type { SourceId, SourcesResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Fixed order, so the marks do not reshuffle when a source reconnects. */
const SOURCE_ORDER: SourceId[] = ["github", "drive", "gmail"];

/**
 * The left rail.
 *
 * Three destinations, and they are **real links** rather than buttons that set
 * state. That is not decoration: an `onClick` that flips a variable cannot be
 * middle-clicked into a new tab, cannot be copied out of the address bar, and
 * leaves the back button pointing out of the application. `NavLink` also
 * decides "active" from the current path, so the highlight cannot drift out of
 * step with what is on screen — the class of bug this project keeps finding in
 * status displays that were never seen wrong.
 *
 * The usage meter at the bottom reports the real answer budget from
 * /api/health rather than being decoration. It is the one number that decides
 * whether the next question will work, so it belongs where it is always
 * visible.
 */
export function AppSidebar({
  searches,
  budget,
  sources,
}: {
  sources?: SourcesResponse;
  searches: SearchEntry[];
  budget: { answersRemaining: number; answersToday: number } | null;
}) {
  const { pathname } = useLocation();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* Collapsed, the rail is too narrow to hold the mark and the toggle
            side by side — they stack instead, so the toggle stays inside the
            rail and reachable. It used to be hidden when collapsed, which
            left no way at all to reopen the sidebar.

            Two files rather than one component, and each is the right shape
            for its slot: `logo.svg` is the full lockup — mark plus wordmark,
            drawn in `currentColor` ink on transparent — so the rail needs no
            separate text label beside it. Collapsed there is no room for a
            240x64 lockup, so the square `favicon.svg` tile stands in; it is
            the same mark, and reusing the favicon means the tab icon and the
            rail icon can never drift apart. */}
        <div className="flex items-center gap-2.5 px-1 py-1.5 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1.5 group-data-[collapsible=icon]:px-0">
          <img
            src="/logo.svg"
            alt="Badger"
            className="h-9 w-auto shrink-0 group-data-[collapsible=icon]:hidden"
          />
          <img
            src="/favicon.svg"
            alt="Badger"
            className="hidden size-[26px] shrink-0 rounded-lg group-data-[collapsible=icon]:block"
          />
          <SidebarTrigger className="ml-auto shrink-0 rounded-full text-stone-500 group-data-[collapsible=icon]:mx-0 group-data-[collapsible=icon]:border group-data-[collapsible=icon]:border-stone-200 group-data-[collapsible=icon]:bg-white" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                {/* Active on every /search URL, so a results page keeps the
                    rail highlighted the same way the empty box does. */}
                <SidebarMenuButton asChild isActive={pathname.startsWith("/search")} tooltip="Search">
                  <NavLink to="/search">
                    <Search />
                    <span>Search</span>
                    <span className="ml-auto font-mono text-[10.5px] text-stone-400 group-data-[collapsible=icon]:hidden">
                      ⌘K
                    </span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                {/* /chat and /chat/<id> are the same destination. */}
                <SidebarMenuButton asChild isActive={pathname.startsWith("/chat")} tooltip="Chat">
                  <NavLink to="/chat">
                    <MessagesSquare />
                    <span>Chat</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.startsWith("/tools")} tooltip="Tools">
                  <NavLink to="/tools">
                    <Wrench />
                    <span>Tools</span>
                    {/*
                      The three marks, rather than a status dot.

                      A dot says "something is connected" and this one said it
                      unconditionally — it was a hard-coded emerald circle that
                      stayed green whether or not anything was reachable. The
                      marks say *which* sources, which is the thing worth
                      knowing at a glance, and they are driven by /api/sources
                      so a source that drops out fades instead of lying.

                      Kept deliberately quiet: 13px, dimmed, and behind the
                      label. A status indicator that happens to be legible, not
                      a row of logos competing with the navigation.
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
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {searches.length > 0 && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Recent digs</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {searches.slice(0, 6).map((entry) => (
                  <SidebarMenuItem key={entry.query}>
                    {/* A past search is a URL, so it can be opened in a tab or
                        bookmarked like any other. */}
                    <SidebarMenuButton asChild className="text-stone-600">
                      <NavLink to={`/search?q=${encodeURIComponent(entry.query)}`}>
                        <span className="truncate">{entry.query}</span>
                      </NavLink>
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
