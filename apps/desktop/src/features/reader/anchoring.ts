// Lives in packages/core/src/reader so the MCP server shares it.
export {
  CONTEXT_LENGTH,
  captureContext,
  locateHighlight,
  overlappingIds,
  segmentsForRange,
  trimRange,
  type AnchorFields,
  type NodeSegment,
  type Placement,
} from "@sourcefold/core/reader";
