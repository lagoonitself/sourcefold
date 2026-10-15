import { describe, expect, it, vi } from "vitest";
import {
  formatKeyBinding,
  isEditableElement,
  isTypingContext,
  matchesKeyCombo,
  parseKeyCombo,
  splitComboForKbd,
} from "../key-utils";

describe("parseKeyCombo", () => {
  it("parses single key", () => {
    expect(parseKeyCombo("j")).toEqual({
      mod: false,
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      key: "j",
    });
  });

  it("parses modifier combos", () => {
    expect(parseKeyCombo("Mod+Shift+P")).toEqual({
      mod: true,
      ctrl: false,
      alt: false,
      shift: true,
      meta: false,
      key: "P",
    });

    expect(parseKeyCombo("Alt+ArrowUp")).toEqual({
      mod: false,
      ctrl: false,
      alt: true,
      shift: false,
      meta: false,
      key: "ArrowUp",
    });
  });
});

describe("matchesKeyCombo", () => {
  it("matches single letter navigation on Windows/Mac without modifiers", () => {
    const eventJ = { key: "j" };
    expect(matchesKeyCombo(eventJ, "j")).toBe(true);
    expect(matchesKeyCombo(eventJ, "k")).toBe(false);

    // Should not match if Ctrl is held
    const eventCtrlJ = { key: "j", ctrlKey: true };
    expect(matchesKeyCombo(eventCtrlJ, "j")).toBe(false);
  });

  it("matches Mod+K correctly on Windows (Ctrl+K)", () => {
    const winEvent = { key: "k", ctrlKey: true };
    expect(matchesKeyCombo(winEvent, "Mod+K", false)).toBe(true);

    const winMetaEvent = { key: "k", metaKey: true };
    expect(matchesKeyCombo(winMetaEvent, "Mod+K", false)).toBe(false);
  });

  it("matches Mod+K correctly on Mac (Cmd+K)", () => {
    const macMetaEvent = { key: "k", metaKey: true };
    expect(matchesKeyCombo(macMetaEvent, "Mod+K", true)).toBe(true);

    const macCtrlEvent = { key: "k", ctrlKey: true };
    expect(matchesKeyCombo(macCtrlEvent, "Mod+K", true)).toBe(false);
  });

  it("matches Mod+Shift+P on both platforms", () => {
    const winEvent = {
      key: "P",
      ctrlKey: true,
      shiftKey: true,
    };
    expect(matchesKeyCombo(winEvent, "Mod+Shift+P", false)).toBe(true);

    const macEvent = {
      key: "P",
      metaKey: true,
      shiftKey: true,
    };
    expect(matchesKeyCombo(macEvent, "Mod+Shift+P", true)).toBe(true);
  });

  it("matches Mod+ArrowLeft and Mod+ArrowRight for word jumping vs navigation", () => {
    const winLeft = { key: "ArrowLeft", ctrlKey: true };
    expect(matchesKeyCombo(winLeft, "Mod+ArrowLeft", false)).toBe(true);

    const macRight = { key: "ArrowRight", metaKey: true };
    expect(matchesKeyCombo(macRight, "Mod+ArrowRight", true)).toBe(true);
  });

  it("matches reload and print prevention combos (Mod+R, F5, Mod+P)", () => {
    const winReload = { key: "r", ctrlKey: true };
    expect(matchesKeyCombo(winReload, "Mod+R", false)).toBe(true);

    const f5Event = { key: "F5" };
    expect(matchesKeyCombo(f5Event, "F5")).toBe(true);

    const winPrint = { key: "p", ctrlKey: true };
    expect(matchesKeyCombo(winPrint, "Mod+P", false)).toBe(true);
  });

  it("ignores IME composing events", () => {
    const composingEvent = {
      key: "k",
      ctrlKey: true,
      isComposing: true,
    };
    expect(matchesKeyCombo(composingEvent, "Mod+K", false)).toBe(false);

    const keyCode229 = {
      key: "k",
      ctrlKey: true,
      keyCode: 229,
    };
    expect(matchesKeyCombo(keyCode229, "Mod+K", false)).toBe(false);
  });

  it("matches Alt+1..9 and arrow keys", () => {
    const alt1 = { key: "1", altKey: true };
    expect(matchesKeyCombo(alt1, "Alt+1")).toBe(true);

    const altUp = { key: "ArrowUp", altKey: true };
    expect(matchesKeyCombo(altUp, "Alt+ArrowUp")).toBe(true);
  });

  it("matches special symbol keys like / and ?", () => {
    const slash = { key: "/" };
    expect(matchesKeyCombo(slash, "/")).toBe(true);

    const question = { key: "?", shiftKey: true };
    expect(matchesKeyCombo(question, "?")).toBe(true);
  });
});

describe("isEditableElement and isTypingContext", () => {
  it("identifies input and textarea as typing contexts", () => {
    const fakeInput = {
      tagName: "INPUT",
      isContentEditable: false,
    } as unknown as Element;
    expect(isEditableElement(fakeInput)).toBe(true);
    expect(isTypingContext(fakeInput)).toBe(true);

    const fakeTextarea = {
      tagName: "TEXTAREA",
      isContentEditable: false,
    } as unknown as Element;
    expect(isEditableElement(fakeTextarea)).toBe(true);
    expect(isTypingContext(fakeTextarea)).toBe(true);
  });

  it("identifies contenteditable elements as typing contexts", () => {
    const fakeDiv = {
      tagName: "DIV",
      isContentEditable: true,
      closest: () => null,
    } as unknown as Element;
    expect(isEditableElement(fakeDiv)).toBe(true);
    expect(isTypingContext(fakeDiv)).toBe(true);
  });

  it("identifies non-editable elements as non-typing contexts", () => {
    const fakeButton = {
      tagName: "BUTTON",
      isContentEditable: false,
      closest: () => null,
    } as unknown as Element;
    expect(isEditableElement(fakeButton)).toBe(false);
  });

  it("respects typing context for word-jumping shortcuts (Mod+ArrowLeft, Mod+ArrowRight)", () => {
    const fakeInput = {
      tagName: "INPUT",
      isContentEditable: false,
    } as unknown as Element;

    const inTyping = isTypingContext(fakeInput);
    expect(inTyping).toBe(true);

    // Simulated action dispatcher: only executes tree/list focus if NOT in typing
    const onFocusTree = vi.fn();
    const onFocusList = vi.fn();

    const dispatchNavigation = (combo: string) => {
      if (inTyping) return;
      if (combo === "Mod+ArrowLeft") onFocusTree();
      if (combo === "Mod+ArrowRight") onFocusList();
    };

    dispatchNavigation("Mod+ArrowLeft");
    dispatchNavigation("Mod+ArrowRight");
    expect(onFocusTree).not.toHaveBeenCalled();
    expect(onFocusList).not.toHaveBeenCalled();
  });

  it("prevents browser reload and print even when typing", () => {
    const fakeInput = {
      tagName: "INPUT",
      isContentEditable: false,
    } as unknown as Element;

    const inTyping = isTypingContext(fakeInput);
    expect(inTyping).toBe(true);

    const preventDefault = vi.fn();
    const onRefresh = vi.fn();
    const onProjectSwitcher = vi.fn();

    // Simulated handler for Mod+R, F5, Mod+P
    const handleKey = (combo: string) => {
      if (combo === "Mod+R" || combo === "F5") {
        preventDefault();
        onRefresh();
        return;
      }
      if (combo === "Mod+P") {
        preventDefault();
        if (!inTyping) {
          onProjectSwitcher();
        }
        return;
      }
    };

    handleKey("Mod+R");
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    handleKey("F5");
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledTimes(2);

    handleKey("Mod+P");
    expect(preventDefault).toHaveBeenCalledTimes(3);
    // Project switcher must NOT open when inside input
    expect(onProjectSwitcher).not.toHaveBeenCalled();
  });
});

describe("formatKeyBinding and splitComboForKbd", () => {
  it("formats shortcuts differently for Mac and Windows", () => {
    expect(formatKeyBinding("Mod+K", true)).toBe("⌘K");
    expect(formatKeyBinding("Mod+K", false)).toBe("Ctrl+K");

    expect(formatKeyBinding("Mod+Shift+P", true)).toBe("⌘⇧P");
    expect(formatKeyBinding("Mod+Shift+P", false)).toBe("Ctrl+Shift+P");

    expect(formatKeyBinding("Alt+ArrowUp", true)).toBe("⌥↑");
    expect(formatKeyBinding("Alt+ArrowUp", false)).toBe("Alt+Up");
  });

  it("splits combos for rendering kbd elements", () => {
    expect(splitComboForKbd("Mod+K", false)).toEqual(["Ctrl", "K"]);
    expect(splitComboForKbd("Mod+K", true)).toEqual(["⌘", "K"]);
    expect(splitComboForKbd("Shift+N", false)).toEqual(["Shift", "N"]);
  });
});
