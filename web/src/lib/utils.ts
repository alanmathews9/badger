import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class lists so a caller's class can override a default. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
