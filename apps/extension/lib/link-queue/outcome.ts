/** What saving one captured page did, in queue-row words. */
export type SaveOutcome =
  | { status: "saved"; itemId: string; title: string | null; message?: string }
  | { status: "duplicate"; message: string; title?: string | null; itemId?: string }
  | { status: "unavailable"; message: string; title: string | null; itemId?: string }
  | { status: "failed"; message: string };
