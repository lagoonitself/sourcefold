declare module "@joplin/turndown-plugin-gfm" {
  import type TurndownService from "turndown";

  export type Plugin = (turndownService: TurndownService) => void;

  export const gfm: Plugin;
  export const tables: Plugin;
  export const strikethrough: Plugin;
  export const taskListItems: Plugin;
  export const highlightedCodeBlock: Plugin;
}
