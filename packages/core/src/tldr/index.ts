// TL;DRs of saved sources (docs/dev/PLAN-tldr.md): the article's own when it has a clear one,
// otherwise written by a model the user picks (ChatGPT, OpenRouter or OpenCode).
export * from "./types";
export * from "./article";
export * from "./input";
export * from "./prompt";
export { inlineToText, markdownBlocks, readingMinutes, splitSentences } from "./plain-text";
export type { TextBlock } from "./plain-text";
