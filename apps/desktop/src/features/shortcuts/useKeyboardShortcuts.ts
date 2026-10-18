import * as React from "react";
import { isAnyDialogOpen } from "@/components/ui/Dialog";
import { isTypingContext, matchesKeyCombo } from "./key-utils";

export interface KeyboardShortcutHandlers {
  /** Open Command Palette ('Mod+K' or 'Mod+Shift+P') */
  onCommandPalette?: () => void;
  /** Open search dialog ('/') */
  onSearch?: () => void;
  /** Open Add Links dialog ('Mod+N' or 'a') */
  onAddLinks?: () => void;
  /** Open New Note dialog ('c') */
  onNewNote?: () => void;
  /** Save to Google Drive ('Mod+S') */
  onSaveToGoogleDrive?: () => void;
  /** Show or hide the sidebar ('Mod+B') */
  onToggleSidebar?: () => void;
  /** Open Settings ('Mod+,') */
  onSettings?: () => void;
  /** Open Project switcher ('p' or 'Mod+P') */
  onProjectSwitcher?: () => void;
  /** Open Keyboard Shortcuts dialog ('?') */
  onShortcuts?: () => void;
  /** Archive / unarchive current project ('Mod+Shift+A') */
  onArchiveProject?: () => void;
  /** Refresh data ('Mod+R' or 'F5') */
  onRefresh?: () => void;
  /** Switch to project 1..9 ('Alt+1'..'Alt+9') */
  onSwitchProjectNumber?: (index: number) => void;
  /** Navigate focus to group tree ('Mod+Left' or 'h') */
  onFocusTree?: () => void;
  /** Navigate focus to source list ('Mod+Right' or 'l') */
  onFocusList?: () => void;
  /** Cycle focus between regions ('F6') */
  onCycleFocus?: () => void;
  /** Navigate to previous group in active project ('[') */
  onPreviousGroup?: () => void;
  /** Navigate to next group in active project (']') */
  onNextGroup?: () => void;
  /** Escape key pressed */
  onEscape?: () => void;
}

export interface UseKeyboardShortcutsOptions extends KeyboardShortcutHandlers {
  enabled?: boolean;
}

/**
 * App-wide global keyboard shortcuts listener.
 * Respects typing contexts and executes appropriate callbacks.
 */
export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  const { enabled = true, ...handlers } = options;
  const handlersRef = React.useRef(handlers);
  handlersRef.current = handlers;

  React.useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const inTyping = isTypingContext(e.target);
      const currentHandlers = handlersRef.current;
      const modalOpen = isAnyDialogOpen();

      // 1. Refresh: Mod+R or F5 (always prevent browser reload)
      if (matchesKeyCombo(e, "Mod+R") || matchesKeyCombo(e, "F5")) {
        e.preventDefault();
        if (!modalOpen) currentHandlers.onRefresh?.();
        return;
      }

      // 2. Prevent default browser print dialog (Mod+P) everywhere (including in inputs)
      if (matchesKeyCombo(e, "Mod+P")) {
        e.preventDefault();
        if (!inTyping && !modalOpen) {
          currentHandlers.onProjectSwitcher?.();
        }
        return;
      }

      // While a dialog, palette, reader or menu is open only Esc is global; every other key
      // belongs to the overlay itself.
      if (modalOpen) {
        if (e.key === "Escape") currentHandlers.onEscape?.();
        return;
      }

      // 3. Command Palette: Mod+K or Mod+Shift+P (available even in typing contexts)
      if (matchesKeyCombo(e, "Mod+K") || matchesKeyCombo(e, "Mod+Shift+P")) {
        e.preventDefault();
        currentHandlers.onCommandPalette?.();
        return;
      }

      // 4. Settings: Mod+, (available everywhere)
      if (matchesKeyCombo(e, "Mod+,")) {
        e.preventDefault();
        currentHandlers.onSettings?.();
        return;
      }

      // Sidebar: Mod+B (available everywhere)
      if (matchesKeyCombo(e, "Mod+B")) {
        e.preventDefault();
        currentHandlers.onToggleSidebar?.();
        return;
      }

      // 5. Save to Google Drive: Mod+S (available everywhere)
      if (matchesKeyCombo(e, "Mod+S")) {
        e.preventDefault();
        currentHandlers.onSaveToGoogleDrive?.();
        return;
      }

      // 6. Cycle focus: F6 (available everywhere)
      if (matchesKeyCombo(e, "F6")) {
        e.preventDefault();
        currentHandlers.onCycleFocus?.();
        return;
      }

      // 7. Escape (available everywhere)
      if (e.key === "Escape") {
        currentHandlers.onEscape?.();
        return;
      }

      // --- Below shortcuts are ONLY active outside typing context ---
      if (inTyping) return;

      // Focus navigation: Mod+ArrowLeft / Mod+ArrowRight
      // MUST NOT fire inside text inputs where Ctrl+ArrowLeft/Right is word jump
      if (matchesKeyCombo(e, "Mod+ArrowLeft")) {
        e.preventDefault();
        currentHandlers.onFocusTree?.();
        return;
      }
      if (matchesKeyCombo(e, "Mod+ArrowRight")) {
        e.preventDefault();
        currentHandlers.onFocusList?.();
        return;
      }

      // Archive/Unarchive project: Mod+Shift+A
      if (matchesKeyCombo(e, "Mod+Shift+A")) {
        e.preventDefault();
        currentHandlers.onArchiveProject?.();
        return;
      }

      // Switch project 1..9: Alt+1..Alt+9
      for (let i = 1; i <= 9; i++) {
        if (matchesKeyCombo(e, `Alt+${i}`)) {
          e.preventDefault();
          currentHandlers.onSwitchProjectNumber?.(i - 1);
          return;
        }
      }

      // Project switcher: p
      if (matchesKeyCombo(e, "p")) {
        e.preventDefault();
        currentHandlers.onProjectSwitcher?.();
        return;
      }

      // Search: /
      if (matchesKeyCombo(e, "/")) {
        e.preventDefault();
        currentHandlers.onSearch?.();
        return;
      }

      // Add Links: Mod+N or a
      if (matchesKeyCombo(e, "Mod+N") || matchesKeyCombo(e, "a")) {
        e.preventDefault();
        currentHandlers.onAddLinks?.();
        return;
      }

      // New Note: c
      if (matchesKeyCombo(e, "c")) {
        e.preventDefault();
        currentHandlers.onNewNote?.();
        return;
      }

      // Keyboard Shortcuts Dialog: ?
      if (matchesKeyCombo(e, "?")) {
        e.preventDefault();
        currentHandlers.onShortcuts?.();
        return;
      }

      // Single-key region navigation: h (tree) and l (list)
      if (matchesKeyCombo(e, "h")) {
        e.preventDefault();
        currentHandlers.onFocusTree?.();
        return;
      }
      if (matchesKeyCombo(e, "l")) {
        e.preventDefault();
        currentHandlers.onFocusList?.();
        return;
      }

      // Next / Previous group in project: [ and ]
      if (matchesKeyCombo(e, "[")) {
        e.preventDefault();
        currentHandlers.onPreviousGroup?.();
        return;
      }
      if (matchesKeyCombo(e, "]")) {
        e.preventDefault();
        currentHandlers.onNextGroup?.();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);
}

export default useKeyboardShortcuts;
