export function safeRedirectPath(value: string | null | undefined, fallback = "/"): string {
  if (!value || typeof value !== "string") {
    return fallback;
  }

  // Starts with exactly one '/' followed by something that is not '/' or '\' (or is just '/')
  if (!/^\/(?:[^\/\\]|$)/.test(value)) {
    return fallback;
  }

  // Contains no '\'
  if (value.includes("\\")) {
    return fallback;
  }

  // Contains no control characters (ASCII 0x00-0x1F and 0x7F)
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code >= 0 && code <= 0x1f) || code === 0x7f) {
      return fallback;
    }
  }

  // new URL(value, "https://x.invalid").origin === "https://x.invalid"
  try {
    const url = new URL(value, "https://x.invalid");
    if (url.origin !== "https://x.invalid") {
      return fallback;
    }
  } catch {
    return fallback;
  }

  return value;
}
