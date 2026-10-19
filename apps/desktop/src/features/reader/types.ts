import type { AuthorType, ItemResearchPatch, Triage } from "@sourcefold/core";
import type { ItemKind } from "@/lib/types";
import type { SourceInfoSignals } from "../research/source-info";
import type { ReaderHighlightsController } from "./useReaderHighlights";
import type { ReaderCleanupController } from "./use-reader-cleanup";
import type { InitialSearch, ReaderFindController } from "./use-reader-find";

export type { InitialSearch, ReaderFindController, ReaderCleanupController };

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
  triage?: Triage | null;
  tags?: string[];
  summary?: string | null;
  author_type?: AuthorType | null;
}

export type ReaderTypography = "serif" | "sans";

/** Where loading the file's text stands. The text is the whole file, front matter included. */
export type ReaderLoadState =
  | { status: "loading" }
  /** `itemId` is the source the text belongs to (the view may still hold the previous one's). */
  | { status: "ready"; text: string; itemId?: string }
  | { status: "error"; message: string };

export interface ReaderViewProps {
  item: ReaderItem;
  state: ReaderLoadState;
  onRetry?: () => void;
  onClose?: () => void;
  className?: string;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  initialTypography?: ReaderTypography;
  /** The rendered body, parsed once by the modal so highlights and the view agree. */
  content?: ReaderContent;
  /** Highlights state and actions; without it the view is a plain reader. */
  highlights?: ReaderHighlightsController;
  bodyRef?: React.RefObject<HTMLDivElement | null>;
  /** The find bar (Mod+F) and its state; without it the view has no find bar. */
  find?: ReaderFindController;
  /** "Remove text" mode and the text editor; without it the view cannot change the text. */
  cleanup?: ReaderCleanupController;
  /** Research tools: project id, updater and keyboard signals. */
  projectId?: string | null;
  onUpdateResearch?: (patch: ItemResearchPatch) => void;
  researchSignals?: SourceInfoSignals;
}

export interface ReaderContent {
  parsed: import("./parse-file").ParsedReaderFile | null;
  bodyHtml: string;
  noteHtml: string;
}

export interface ReaderModalProps {
  item: ReaderItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClose?: () => void;
  className?: string;
  initialTypography?: ReaderTypography;
  /** All sources of the open group, in list order (for [ and ]). */
  groupItems?: ReaderItem[];
  onNavigate?: (item: ReaderItem) => void;
  /** Scroll to this highlight once the text has loaded. */
  initialHighlightId?: string | null;
  /** From the search box: scroll to this passage once the text has loaded and mark the matches. */
  initialSearch?: InitialSearch | null;
  onSaveLinks?: (urls: string[], folderId: string) => void;
  onHighlightsChanged?: (itemId: string) => void;
}
