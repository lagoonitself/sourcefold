import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Tauri commands reject with a plain string, fetch/Error with an Error. */
export function errorMessage(err: unknown, fallback: string): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export async function openUrl(url: string) {
  if (typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__)) {
    try {
      const opener = await import("@tauri-apps/plugin-opener");
      await opener.openUrl(url);
      return;
    } catch (e) {
      console.warn("Failed to open via plugin-opener, falling back to window.open", e);
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
