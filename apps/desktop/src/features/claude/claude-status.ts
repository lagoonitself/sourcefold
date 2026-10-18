export interface ClaudeStatusInput {
  signedIn: boolean;
  offline: boolean;
  email: string | null;
}

export const CLAUDE_INSTALL_STARTED =
  "Claude Desktop is asking you to install Sourcefold. Click Install there.";

export const CLAUDE_APP_OPEN_NOTE =
  "With this app open, Claude can also search inside your sources and show things here.";

/** The status line under the Claude settings: what Claude can use from this app right now. */
export function claudeStatusLine({ signedIn, offline, email }: ClaudeStatusInput): {
  ok: boolean;
  text: string;
} {
  if (offline) {
    return {
      ok: false,
      text: "Claude works with a signed-in library for now. Sign in to use it with Claude.",
    };
  }
  if (signedIn) {
    const who = email?.trim();
    return {
      ok: true,
      text: who ? `Claude uses this app's sign-in (${who}).` : "Claude uses this app's sign-in.",
    };
  }
  return { ok: false, text: "Sign in to use Sourcefold with Claude." };
}
