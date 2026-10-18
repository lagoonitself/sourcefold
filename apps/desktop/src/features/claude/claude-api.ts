export interface ClaudeExtensionOpened {
  /** Where the extension bundle came from: shipped with the app, this repository's build, or a download. */
  source: "bundled" | "dev" | "downloaded";
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Opens the Sourcefold extension in Claude Desktop's install dialog. Rejects with a readable message. */
export function openClaudeExtension(): Promise<ClaudeExtensionOpened> {
  return tauriInvoke<ClaudeExtensionOpened>("open_claude_extension");
}
