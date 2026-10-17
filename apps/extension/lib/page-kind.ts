import {
  detectLinkKind,
  detectSource,
  type SourceCaptureKind,
  type SourceKind,
} from "@sourcefold/core";
import { sourceKindLabel } from "./capture-route";

export type PageKind = SourceKind | SourceCaptureKind;

/** What the popup would save this page as, or null for pages it can't save. */
export function pageKindOf(url: string): PageKind | null {
  if (!/^https?:\/\//i.test(url)) return null;
  return detectSource(url) ?? detectLinkKind(url);
}

export function pageKindLabel(kind: PageKind): string {
  switch (kind) {
    case "grokipedia":
      return "Grokipedia article";
    case "substack":
      return "Substack post";
    case "x":
      return "X post";
    default:
      return sourceKindLabel(kind);
  }
}

export function hostLabel(url: string): string {
  if (!/^https?:\/\//i.test(url)) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}
