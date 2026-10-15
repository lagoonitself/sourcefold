export function isMacPlatform(customNavigator?: Navigator): boolean {
  const nav = customNavigator ?? (typeof navigator !== "undefined" ? navigator : undefined);
  if (!nav) return false;
  const platform = (nav as any).userAgentData?.platform || nav.platform || "";
  const userAgent = nav.userAgent || "";
  return /Mac|iPhone|iPod|iPad/i.test(platform) || /Macintosh|Mac OS X/i.test(userAgent);
}

export function isEditableElement(element: Element | null): boolean {
  if (!element) return false;
  if (typeof HTMLElement !== "undefined" && !(element instanceof HTMLElement)) return false;
  const tag = (element.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((element as any).isContentEditable) return true;
  if (typeof element.closest === "function" && element.closest("[contenteditable='true']")) {
    return true;
  }
  return false;
}

export function isTypingContext(target: EventTarget | null): boolean {
  if (isEditableElement(target as Element | null)) return true;
  if (typeof document !== "undefined" && isEditableElement(document.activeElement)) {
    return true;
  }
  return false;
}

export function hasTextSelection(): boolean {
  if (typeof window === "undefined") return false;
  const selection = window.getSelection();
  return Boolean(selection && selection.toString().length > 0);
}

export interface ParsedKeyCombo {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

export type KeyEventLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
};

export function parseKeyCombo(combo: string): ParsedKeyCombo {
  const parts = combo.split("+").map((p) => p.trim());
  let mod = false;
  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  let key = "";

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "mod" || lower === "cmdorctrl") {
      mod = true;
    } else if (lower === "ctrl" || lower === "control") {
      ctrl = true;
    } else if (lower === "alt" || lower === "option") {
      alt = true;
    } else if (lower === "shift") {
      shift = true;
    } else if (lower === "meta" || lower === "cmd" || lower === "command") {
      meta = true;
    } else {
      key = part;
    }
  }

  return { mod, ctrl, alt, shift, meta, key };
}

export function matchesKeyCombo(event: KeyEventLike, combo: string, forceMac?: boolean): boolean {
  if (event.isComposing || event.keyCode === 229) {
    return false;
  }

  const isMac = forceMac ?? isMacPlatform();
  const parsed = parseKeyCombo(combo);

  let expectedCtrl = parsed.ctrl;
  let expectedMeta = parsed.meta;
  if (parsed.mod) {
    if (isMac) {
      expectedMeta = true;
    } else {
      expectedCtrl = true;
    }
  }

  if (Boolean(event.ctrlKey) !== expectedCtrl) return false;
  if (Boolean(event.metaKey) !== expectedMeta) return false;
  if (Boolean(event.altKey) !== parsed.alt) return false;

  const isShiftPunctuation =
    parsed.key === "?" ||
    parsed.key === ":" ||
    parsed.key === "!" ||
    parsed.key === "@" ||
    parsed.key === "#" ||
    parsed.key === "$" ||
    parsed.key === "%" ||
    parsed.key === "^" ||
    parsed.key === "&" ||
    parsed.key === "*" ||
    parsed.key === "(" ||
    parsed.key === ")" ||
    parsed.key === "_" ||
    parsed.key === "+" ||
    parsed.key === "{" ||
    parsed.key === "}" ||
    parsed.key === "|" ||
    parsed.key === "<" ||
    parsed.key === ">" ||
    parsed.key === "~";

  if (!parsed.shift && event.shiftKey && !isShiftPunctuation) {
    return false;
  }
  if (parsed.shift && !event.shiftKey) {
    return false;
  }

  const eventKey = event.key;
  if (!eventKey) return false;

  const normalize = (k: string) => k.toLowerCase();

  if (normalize(parsed.key) === normalize(eventKey)) return true;

  if (parsed.key === " " && eventKey === "Space") return true;
  if (parsed.key === "Space" && eventKey === " ") return true;

  return false;
}

export function formatKeyBinding(combo: string, forceMac?: boolean): string {
  const isMac = forceMac ?? isMacPlatform();
  const parsed = parseKeyCombo(combo);
  const parts: string[] = [];

  if (parsed.mod) {
    parts.push(isMac ? "⌘" : "Ctrl");
  }
  if (parsed.ctrl && !parsed.mod) {
    parts.push(isMac ? "⌃" : "Ctrl");
  }
  if (parsed.alt) {
    parts.push(isMac ? "⌥" : "Alt");
  }
  if (parsed.shift) {
    parts.push(isMac ? "⇧" : "Shift");
  }
  if (parsed.meta && !parsed.mod) {
    parts.push(isMac ? "⌘" : "Win");
  }

  let displayKey = parsed.key;
  if (isMac) {
    if (displayKey === "ArrowUp") displayKey = "↑";
    else if (displayKey === "ArrowDown") displayKey = "↓";
    else if (displayKey === "ArrowLeft") displayKey = "←";
    else if (displayKey === "ArrowRight") displayKey = "→";
    else if (displayKey.length === 1) displayKey = displayKey.toUpperCase();
    return `${parts.join("")}${displayKey}`;
  } else {
    if (displayKey === "ArrowUp") displayKey = "Up";
    else if (displayKey === "ArrowDown") displayKey = "Down";
    else if (displayKey === "ArrowLeft") displayKey = "Left";
    else if (displayKey === "ArrowRight") displayKey = "Right";
    else if (displayKey.length === 1) displayKey = displayKey.toUpperCase();
    return [...parts, displayKey].join("+");
  }
}

export function splitComboForKbd(combo: string, forceMac?: boolean): string[] {
  const isMac = forceMac ?? isMacPlatform();
  const parsed = parseKeyCombo(combo);
  const keys: string[] = [];

  if (parsed.mod) {
    keys.push(isMac ? "⌘" : "Ctrl");
  }
  if (parsed.ctrl && !parsed.mod) {
    keys.push(isMac ? "⌃" : "Ctrl");
  }
  if (parsed.alt) {
    keys.push(isMac ? "⌥" : "Alt");
  }
  if (parsed.shift) {
    keys.push(isMac ? "⇧" : "Shift");
  }
  if (parsed.meta && !parsed.mod) {
    keys.push(isMac ? "⌘" : "Win");
  }

  let displayKey = parsed.key;
  if (isMac) {
    if (displayKey === "ArrowUp") displayKey = "↑";
    else if (displayKey === "ArrowDown") displayKey = "↓";
    else if (displayKey === "ArrowLeft") displayKey = "←";
    else if (displayKey === "ArrowRight") displayKey = "→";
    else if (displayKey.length === 1) displayKey = displayKey.toUpperCase();
  } else {
    if (displayKey === "ArrowUp") displayKey = "Up";
    else if (displayKey === "ArrowDown") displayKey = "Down";
    else if (displayKey === "ArrowLeft") displayKey = "Left";
    else if (displayKey === "ArrowRight") displayKey = "Right";
    else if (displayKey.length === 1) displayKey = displayKey.toUpperCase();
  }

  keys.push(displayKey);
  return keys;
}
