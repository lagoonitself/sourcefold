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

export interface ReaderViewProps {
  item: ReaderItem;
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
