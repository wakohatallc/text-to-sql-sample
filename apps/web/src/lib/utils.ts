import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn/ui componentで使うclassNameを安全に結合する。
 *
 * @param inputs 結合対象のclass値。
 * @returns Tailwindの競合を解決したclassName。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
