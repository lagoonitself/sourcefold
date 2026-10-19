// The desktop reader's pure text code: splitting a Sourcefold file, rendering its Markdown, and
// the anchoring maths for highlights. Shared with the MCP server, which places highlights Claude
// makes on the same text the reader shows (docs/dev/handoff-mcp.md).
export * from "./parse-file";
export * from "./render-markdown";
export * from "./remove-text";
export * from "./anchoring";
export * from "./extract";
