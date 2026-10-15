import type { ItemKind } from "@/lib/types";

export interface ReaderItem {
  id: string;
  title: string;
  kind: ItemKind;
  markdown?: string | null;
  note?: string | null;
  source_url?: string | null;
  canonical_url?: string | null;
  meta?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
  status?: string;
  author?: string | null;
  folder_id?: string;
}

export type ReaderTypography = "serif" | "sans";

/** Where loading the file's text stands. The text is the whole file, front matter included. */
export type ReaderLoadState =
  { status: "loading" } | { status: "ready"; text: string } | { status: "error"; message: string };

export interface ReaderViewProps {
  item: ReaderItem;
  state: ReaderLoadState;
  onRetry?: () => void;
  onClose?: () => void;
  className?: string;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  initialTypography?: ReaderTypography;
}

export interface ReaderModalProps {
  item: ReaderItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClose?: () => void;
  className?: string;
  initialTypography?: ReaderTypography;
}
