import { Mic, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function MicButton({
  listening,
  starting,
  error,
  onClick,
  className,
  size = 18,
}: {
  listening: boolean;
  starting: boolean;
  error: string | null;
  onClick: () => void;
  className?: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={listening ? "Discard dictation" : "Dictate"}
      title={error ?? (listening ? "Discard" : starting ? "Starting…" : "Dictate")}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full transition-colors",
        listening
          ? "bg-stone-100 text-stone-700 hover:bg-stone-200"
          : starting
          ? "text-stone-300"
          : error
          ? "text-amber-700 hover:bg-amber-50"
          : "text-stone-500 hover:bg-stone-100 hover:text-stone-900",
        className,
      )}
    >
      {listening ? (
        <X style={{ width: size - 2, height: size - 2 }} strokeWidth={2} />
      ) : (
        <Mic style={{ width: size, height: size }} strokeWidth={1.9} />
      )}
    </button>
  );
}

export function ListeningHint({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12px] text-stone-500", className)}>
      <span className="flex items-end gap-[2px]">
        <span className="w-[2px] animate-[pulse_1s_ease-in-out_infinite] rounded-full bg-stone-400" style={{ height: 6 }} />
        <span className="w-[2px] animate-[pulse_1s_ease-in-out_0.15s_infinite] rounded-full bg-stone-400" style={{ height: 11 }} />
        <span className="w-[2px] animate-[pulse_1s_ease-in-out_0.3s_infinite] rounded-full bg-stone-400" style={{ height: 8 }} />
      </span>
      Listening
    </span>
  );
}
