import { BadgerBadge } from "./BadgerMark";

/**
 * The 56px bar that carries the whole app. There is no sidebar by design —
 * one bar, three screens.
 *
 * `children` is the slot between the mark and the account cluster: empty on
 * Home, the compact search input on Results, a back link on Ask.
 */
export function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 px-6">
      <BadgerBadge />
      {children ?? (
        <>
          <span className="text-[14.5px] font-semibold tracking-[-0.01em]">badger</span>
          <span className="font-mono text-[11px] text-stone-500">arkind</span>
        </>
      )}
      <div className="ml-auto flex items-center gap-4">
        <button className="text-[12.5px] font-medium text-stone-600 hover:text-stone-900">
          Burrows
        </button>
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-stone-200 text-[10px] font-medium">
          AM
        </span>
      </div>
    </header>
  );
}
