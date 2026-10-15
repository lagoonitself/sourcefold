export { useKeyboardShortcuts } from "./useKeyboardShortcuts";
export type { UseKeyboardShortcutsOptions, KeyboardShortcutHandlers } from "./useKeyboardShortcuts";

export { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
export type { KeyboardShortcutsDialogProps } from "./KeyboardShortcutsDialog";

export {
  isMacPlatform,
  parseKeyCombo,
  matchesKeyCombo,
  formatKeyBinding,
  splitComboForKbd,
  isEditableElement,
  isTypingContext,
  hasTextSelection,
} from "./key-utils";

export {
  SHORTCUT_COMMANDS,
  getCommandsByGroup,
  findCommandById,
  type ShortcutCommand,
  type ShortcutWhen,
  type ShortcutGroup,
} from "./registry";
