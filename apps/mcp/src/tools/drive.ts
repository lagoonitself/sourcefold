import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError, type WebApi } from "../web-api";
import { defineTool, type ToolContext } from "./define";
import { messageOf, plural } from "./format";

/** Stop starting new batches after this long: a client gives up on a tool call after a minute. */
const TIME_BUDGET_MS = 40_000;
const BATCH_SIZE = 50;
/** How long to wait before asking again while another save is running. Tests shorten it. */
export const driveTiming = { busyRetryMs: 3_000 };

interface SaveBatch {
  processed?: number;
  remaining?: number;
  done?: boolean;
  failed?: Array<{ id: string; title: string; message: string }>;
}

export interface SaveToDriveOptions {
  budgetMs?: number;
  batchSize?: number;
  waitOnBusy?: boolean;
  signInWorks?: boolean;
}

export interface SaveToDriveResult {
  processed: number;
  remaining: number;
  done: boolean;
  failed: Array<{ id: string; title: string; message: string }>;
  waited: boolean;
  busyTimedOut?: boolean;
}

export async function saveToDrive(
  api: WebApi,
  options: SaveToDriveOptions = {},
): Promise<SaveToDriveResult> {
  const budgetMs = options.budgetMs ?? TIME_BUDGET_MS;
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const waitOnBusy = options.waitOnBusy ?? true;
  const signInWorks = options.signInWorks ?? false;

  const started = Date.now();
  let processed = 0;
  let remaining = 0;
  let done = false;
  let waited = false;
  let busyTimedOut = false;
  const failed: NonNullable<SaveBatch["failed"]> = [];

  do {
    let batch: SaveBatch;
    try {
      batch = await api.post<SaveBatch>("/drive/save", { budget: batchSize });
    } catch (err) {
      // The app saves by itself a few minutes after a change; that save does the same work, so
      // wait for it to finish and then carry on, instead of failing.
      if (err instanceof ApiError && err.code === "sync_in_progress") {
        if (!waitOnBusy) {
          throw err;
        }
        if (Date.now() - started + driveTiming.busyRetryMs >= budgetMs) {
          busyTimedOut = true;
          break;
        }
        waited = true;
        await new Promise((resolve) => setTimeout(resolve, driveTiming.busyRetryMs));
        continue;
      }
      // The web app answers 401 "reconnect_drive" when Google refuses; web-api.ts words every
      // 401 as an expired sign-in. The status check above proved the sign-in is fine.
      if (signInWorks && err instanceof ApiError && err.status === 401) {
        throw new Error(
          "Reconnect Google Drive to keep saving. The user can do that in the Sourcefold web app's Settings.",
        );
      }
      throw err;
    }
    processed += batch.processed ?? 0;
    remaining = batch.remaining ?? 0;
    done = batch.done ?? remaining === 0;
    failed.push(...(batch.failed ?? []));
    if (!batch.processed) break;
  } while (!done && Date.now() - started < budgetMs);

  return { processed, remaining, done, failed, waited, busyTimedOut };
}

export function registerDriveTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, ctx, {
    name: "save_to_drive",
    title: "Save to Google Drive",
    description:
      "Saves the library's changes to the user's Google Drive now (the files and folders Sourcefold keeps there). Normally this happens by itself a few minutes after a change, so use it when the user asks for it or before they open Drive. If the app is already saving, it waits for that save and then continues. Runs in batches for up to about 40 seconds; if more is left it says how many, and calling it again continues. Answers with how many items were saved and any that failed, or the reason it couldn't (for example Drive isn't connected).",
    input: {},
    idempotent: true,
    run: async (_args, { api }) => {
      let signInWorks = false;
      try {
        const status = await api.get<{ connected?: boolean }>("/drive/status");
        signInWorks = true;
        if (status.connected === false) {
          throw new Error(
            "Google Drive isn't connected. The user can connect it in the Sourcefold web app's Settings.",
          );
        }
      } catch (err) {
        // A failed status check is not a reason to refuse; only "not connected" is.
        if (err instanceof Error && err.message.startsWith("Google Drive isn't connected"))
          throw err;
      }

      const result = await saveToDrive(api, { budgetMs: TIME_BUDGET_MS, signInWorks });
      if (result.busyTimedOut) {
        return "A save the Sourcefold app started is still running; it saves the same changes. Call save_to_drive again in a minute to check that everything is saved.";
      }
      const { processed, remaining, done, failed, waited } = result;

      const lines: string[] = [];
      if (processed === 0 && failed.length === 0 && done) {
        lines.push(
          waited
            ? "Google Drive is up to date: a save the Sourcefold app had started saved the changes."
            : "Google Drive is up to date: nothing needed saving.",
        );
      } else {
        lines.push(
          `Saved ${plural(Math.max(0, processed - failed.length), "item")} to Google Drive.`,
        );
      }
      if (!done && remaining > 0) {
        lines.push(
          `${plural(remaining, "item")} still to save. Call save_to_drive again to continue.`,
        );
      }
      if (failed.length > 0) {
        lines.push(`${plural(failed.length, "item")} failed:`);
        for (const f of failed.slice(0, 10))
          lines.push(`[${f.id}] ${f.title}: ${messageOf(f.message)}`);
        if (failed.length > 10) lines.push(`…and ${failed.length - 10} more.`);
      }
      return lines.join("\n");
    },
  });
}
