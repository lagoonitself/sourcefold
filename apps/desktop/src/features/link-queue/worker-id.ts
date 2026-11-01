const STORAGE_KEY = "sourcefold:desktop-install-id";

function defaultStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** `desktop:<install id>`, stable for this computer, at most 100 characters. */
export function desktopWorkerId(
  storage: Pick<Storage, "getItem" | "setItem"> | null = defaultStorage(),
  random: () => string = randomId,
): string {
  let id = storage?.getItem(STORAGE_KEY)?.trim() ?? "";
  if (!id) {
    id = random();
    try {
      storage?.setItem(STORAGE_KEY, id);
    } catch {
      // A private window can refuse storage. This run still has a worker name.
    }
  }
  const worker = `desktop:${id}`;
  return worker.length <= 100 ? worker : worker.slice(0, 100);
}
