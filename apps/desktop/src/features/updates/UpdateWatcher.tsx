import * as React from "react";
import { toast } from "sonner";
import { openClaudeExtension } from "../claude/claude-api";
import {
  claudeBundleOutdated,
  installedClaudeBundleVersion,
  rememberClaudeBundleVersion,
} from "./claude-bundle-version";
import { checkForUpdate, getAppVersion, installUpdate } from "./update-store";

const FIRST_CHECK_MS = 8_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const UPDATE_TOAST_ID = "sourcefold-app-update";
const CLAUDE_TOAST_ID = "sourcefold-claude-update";

/**
 * Checks for a new version a few seconds after start and every six hours, and offers it in a toast
 * that stays until it's answered. After an update, offers to update Claude Desktop's copy of the
 * Sourcefold extension too. Release builds only: a dev build would "update" itself into the
 * released app.
 */
export function UpdateWatcher() {
  React.useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no vite/client types here
    const isRelease = Boolean(((import.meta as any).env ?? {}).PROD);
    if (!isRelease) return;
    let offered: string | null = null;

    const run = async () => {
      const version = await checkForUpdate({ quiet: true });
      if (!version || version === offered) return;
      offered = version;
      toast(`Sourcefold ${version} is ready`, {
        id: UPDATE_TOAST_ID,
        description: "Update now and the app restarts in a few seconds. Nothing you saved is lost.",
        duration: Infinity,
        action: {
          label: "Update and restart",
          onClick: () => {
            toast.loading(`Updating to ${version}…`, { id: UPDATE_TOAST_ID, duration: Infinity });
            void installUpdate();
          },
        },
        cancel: { label: "Later", onClick: () => {} },
      });
    };

    const first = window.setTimeout(run, FIRST_CHECK_MS);
    const every = window.setInterval(run, CHECK_EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void getAppVersion().then((appVersion) => {
      if (cancelled) return;
      const installed = installedClaudeBundleVersion();
      if (!claudeBundleOutdated(appVersion, installed)) return;
      toast("Update Sourcefold in Claude Desktop", {
        id: CLAUDE_TOAST_ID,
        description: `Claude still has version ${installed}. Click Update, then Install in Claude's window.`,
        duration: Infinity,
        action: {
          label: "Update",
          onClick: () => {
            openClaudeExtension()
              .then(() => rememberClaudeBundleVersion(appVersion))
              .catch((err: unknown) =>
                toast.error(err instanceof Error ? err.message : String(err)),
              );
          },
        },
        cancel: {
          label: "Not now",
          // Ask again after the next update, not on every start.
          onClick: () => rememberClaudeBundleVersion(appVersion),
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
