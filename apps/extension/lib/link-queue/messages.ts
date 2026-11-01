export const LINK_QUEUE_MESSAGE = "sourcefold:link-queue" as const;

export type LinkQueueMessage = {
  type: typeof LINK_QUEUE_MESSAGE;
  op: "kick" | "retry";
};

export function isLinkQueueMessage(value: unknown): value is LinkQueueMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as { type?: unknown; op?: unknown };
  return message.type === LINK_QUEUE_MESSAGE && (message.op === "kick" || message.op === "retry");
}
