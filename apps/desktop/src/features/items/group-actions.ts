/** Actions the group view's header and list can run from the command palette. */
export type GroupAction =
  | "new-subgroup"
  | "add-image"
  | "select-mode"
  | "copy-all-links"
  | "status-keep"
  | "status-maybe"
  | "status-cut"
  | "status-clear"
  | "edit-tags"
  | "edit-summary";

export const GROUP_ACTION_EVENT = "sourcefold:group-action";

const COMMAND_ACTIONS: Record<string, GroupAction> = {
  "list.new-subgroup": "new-subgroup",
  "list.add-image": "add-image",
  "list.select-mode": "select-mode",
  "list.copy-all-links": "copy-all-links",
  "list.status-keep": "status-keep",
  "list.status-maybe": "status-maybe",
  "list.status-cut": "status-cut",
  "list.status-clear": "status-clear",
  "list.tags": "edit-tags",
  "list.summary": "edit-summary",
};

export function groupActionForCommand(commandId: string): GroupAction | null {
  return COMMAND_ACTIONS[commandId] ?? null;
}

export function dispatchGroupAction(action: GroupAction): void {
  window.dispatchEvent(new CustomEvent<GroupAction>(GROUP_ACTION_EVENT, { detail: action }));
}

/** Calls `handler` whenever the palette (or anything else) dispatches a group action. */
export function onGroupAction(handler: (action: GroupAction) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<GroupAction>).detail);
  window.addEventListener(GROUP_ACTION_EVENT, listener);
  return () => window.removeEventListener(GROUP_ACTION_EVENT, listener);
}

/** Asks the group tree to open its "New group" dialog (from empty states and the top bar). */
export const NEW_GROUP_EVENT = "sourcefold:new-group";

export function requestNewGroup(): void {
  window.dispatchEvent(new Event(NEW_GROUP_EVENT));
}
