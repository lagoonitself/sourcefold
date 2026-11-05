import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  describeQueuedLink,
  detectLinkKind,
  summarizeLinks,
  workersAlive,
  type LinkWorkersSeen,
  type QueuedLinkInfo,
} from "@sourcefold/core";
import { formatWait } from "@sourcefold/core/capture";
import { z } from "zod";
import {
  readLinkArgs,
  refuseLocalAddresses,
  skippedLines,
  type SkippedLink,
} from "../links/link-args";
import { createNodeSourceFetch, createPublicFetch } from "../links/public-fetch";
import {
  checkDuplicate,
  checkUrl,
  classifyLink,
  isCloudRefusal,
  collectionKind,
  listCollection,
  saveLink,
  type LinkDeps,
  type LinkKind,
} from "../links/save-link";
import type { Folder, LinkQueueRow } from "../types";
import {
  ADD_JOBS_FILE,
  AddJobs,
  fileJobStore,
  inMemoryJobStore,
  isRowDone,
  memoryJobStore,
  type AddJob,
  type AddJobStore,
  type JobRow,
  type Pacing,
} from "./add-jobs";
import { defineTool, type ToolContext } from "./define";
import { scheduleDriveSave } from "./drive-autosave";
import { indexFolders, messageOf, plural, queuedForDesktopMessage } from "./format";
import { mapLimit } from "./library-data";

export {
  ADD_JOBS_FILE,
  AddJobs,
  fileJobStore,
  inMemoryJobStore,
  isRowDone,
  memoryJobStore,
  type AddJob,
  type AddJobStore,
  type JobRow,
  type Pacing,
};

/** A real calendar day: 2026-02-30 is refused, not ignored (QA 2026-11-05). */
const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .refine((day) => {
    const date = new Date(`${day}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
  }, "Not a real date. Use YYYY-MM-DD.")
  .optional();
/** Claude Desktop cuts a tool call off after about a minute. */
const MAX_WAIT_SECONDS = 50;
const ROWS_SHOWN = 60;
// Vercel stops the function at 60 s. Saving gets 35 s from the start of the call (finding the
// group included); writing the waiting links gets at most 15 s after that.
const REMOTE_BUDGET_MS = 35_000;
const REMOTE_LINK_TIMEOUT_MS = 12_000;
const REMOTE_QUEUE_TIMEOUT_MS = 15_000;
/** Links taken per call: one queue write (the route accepts 200). */
const REMOTE_MAX_LINKS = 200;

const STATUS_LABEL: Record<JobRow["status"], string> = {
  waiting: "waiting",
  finding: "finding videos or posts",
  saving: "saving",
  saved: "saved",
  duplicate: "already saved",
  unavailable: "not saved",
  paid: "paid, not saved",
  paused: "paused",
  queued: "waiting for your computer",
  failed: "failed",
  skipped: "skipped",
};

function rowLine(r: JobRow, now: number): string {
  const name = r.title ? `${r.title} — ${r.url}` : r.url;
  let message = r.message;
  if (r.status === "paused" && r.resumeAt) {
    const seconds = Math.max(1, Math.ceil((r.resumeAt - now) / 1000));
    message = `${r.message ?? "Paused."} Trying again in ${formatWait(seconds)}.`;
  }
  const id = r.itemId ? ` [${r.itemId}]` : "";
  const label =
    r.status === "queued" && r.kind === "x" ? "waiting for Chrome" : STATUS_LABEL[r.status];
  return `- ${label}${id}: ${name}${message ? ` (${message})` : ""}`;
}

export function formatJob(
  job: AddJob,
  now = Date.now(),
  ahead?: AddJob[] | { jobs: number; links: number },
): string {
  const count = (status: JobRow["status"]) => job.rows.filter((r) => r.status === status).length;
  const done = job.rows.filter(isRowDone).length;
  const lines: string[] = [];

  const parts = [
    `${count("saved")} saved`,
    count("duplicate") && `${count("duplicate")} already saved`,
    count("unavailable") && `${count("unavailable")} not saved (no captions or similar)`,
    count("paid") && `${count("paid")} paid`,
    job.rows.filter((r) => r.status === "queued" && r.kind !== "x").length &&
      `${job.rows.filter((r) => r.status === "queued" && r.kind !== "x").length} waiting for your computer`,
    job.rows.filter((r) => r.status === "queued" && r.kind === "x").length &&
      `${job.rows.filter((r) => r.status === "queued" && r.kind === "x").length} waiting for Chrome`,
    count("failed") && `${count("failed")} failed`,
    count("skipped") && `${count("skipped")} skipped`,
  ].filter(Boolean);
  lines.push(
    `Adding to ${job.groupPath} [${job.groupId}], job ${job.id}: ${done} of ${plural(job.rows.length, "link")} done (${parts.join(", ")}).`,
  );

  if (count("paid") > 0) {
    lines.push(
      "Paid posts need the user's Substack cookie: in the Sourcefold desktop app, Settings → Substack. Then add those links again.",
    );
  }

  if (job.state === "running" || job.state === "queued") {
    if (job.state === "queued") {
      if (ahead) {
        if (Array.isArray(ahead)) {
          const count = ahead.length;
          const links = ahead.reduce(
            (sum, j) => sum + j.rows.filter((r) => !isRowDone(r)).length,
            0,
          );
          lines.push(
            `Waiting behind ${plural(count, "earlier add job")} with ${plural(links, "link")} still to save.`,
          );
        } else {
          lines.push(
            `Waiting behind ${plural(ahead.jobs, "earlier add job")} with ${plural(ahead.links, "link")} still to save.`,
          );
        }
      } else {
        lines.push("Waiting for an earlier add job to finish.");
      }
    } else {
      lines.push("Still running in the background. YouTube videos are saved a few seconds apart.");
    }
    lines.push(`Check again with get_add_progress { "job_id": "${job.id}" }.`);
  } else if (job.state === "stopped") {
    lines.push("Stopped. Links still waiting were not saved; add them again to continue.");
  } else {
    lines.push("Finished.");
  }

  // Everything that isn't plain waiting, newest activity last; waiting rows only as a count.
  const active = job.rows.filter((r) => r.status !== "waiting");
  const waiting = job.rows.filter((r) => r.status === "waiting");
  const shown = active.slice(-ROWS_SHOWN);
  if (active.length > shown.length)
    lines.push(`(${active.length - shown.length} earlier rows not shown)`);
  lines.push("", ...shown.map((r) => rowLine(r, now)));
  if (waiting.length > 0) {
    const preview = waiting.slice(0, 5).map((r) => rowLine(r, now));
    lines.push(...preview);
    if (waiting.length > preview.length)
      lines.push(`- … and ${waiting.length - preview.length} more waiting`);
  }
  return lines.join("\n").trim();
}

function linkDepsFactory(ctx: ToolContext): () => Promise<LinkDeps> {
  return async () => ({
    api: ctx.api,
    desktop: ctx.desktop,
    addedBy: ctx.addedBy ?? "Claude",
    sourceFetch: createNodeSourceFetch(),
    publicFetch: createPublicFetch(),
    desktopOpen: (await ctx.desktop.status()) !== null,
    deferUnavailable: ctx.mode === "remote",
  });
}

async function resolveGroup(
  ctx: ToolContext,
  groupId: string,
  timeoutMs?: number,
): Promise<{ id: string; path: string }> {
  const folders = await ctx.api.get<Folder[]>("/folders", {
    query: { includeArchived: true },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const index = indexFolders(folders);
  const group = index.byId.get(groupId.trim());
  if (!group)
    throw new Error(`No group with id ${groupId}. Use get_project_tree to find group ids.`);
  if (!group.parent_id) {
    throw new Error(
      `${group.name} is a project. Sources live in groups: pick a group inside it, or make one with create_group.`,
    );
  }
  return { id: group.id, path: index.pathOf(group.id) };
}

function queuedInfo(result: RemoteResult): QueuedLinkInfo {
  return { needs: result.needs ?? "desktop", status: "waiting", message: result.message ?? null };
}

interface RemoteResult {
  url: string;
  status: "saved" | "duplicate" | "unavailable" | "failed" | "waiting";
  title?: string;
  itemId?: string;
  message?: string;
  needs?: "desktop" | "browser";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(
        `The link took longer than ${Math.ceil(timeoutMs / 1000)} seconds to answer.`,
      );
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Whether a site's front page is a Substack publication, in at most a few seconds and never
 * throwing: a slow or hostile site once used up the whole call (QA 2026-11-05, a 502).
 */
async function probeCollection(url: string, deps: LinkDeps): Promise<"publication" | null> {
  try {
    const kind = await withTimeout(collectionKind(url, deps), 5_000);
    return kind === "publication" ? kind : null;
  } catch {
    return null;
  }
}

function queueReason(reason: string): string {
  return reason.length > 950 ? `${reason.slice(0, 947)}...` : reason;
}

interface QueuedLink {
  url: string;
  kind: string | null;
  needs: "desktop" | "browser";
  message: string;
  result: RemoteResult;
}

// Links to queue during one add_links call, written together at the end in one request.
const queueBatches = new WeakMap<ToolContext, QueuedLink[]>();

async function queueRemoteLink(
  ctx: ToolContext,
  _groupId: string,
  url: string,
  kind: string | null,
  needs: "desktop" | "browser",
  message: string,
): Promise<RemoteResult> {
  const batch = queueBatches.get(ctx);
  if (!batch) throw new Error("Remote links are queued inside add_links only.");
  const result: RemoteResult = { url, status: "waiting", needs, message };
  batch.push({ url, kind, needs, message, result });
  return result;
}

/** Time kept for writing the queue after the duplicate checks. */
const QUEUE_CHECK_RESERVE_MS = 5_000;

/**
 * The link queue doesn't carry allow_duplicates: the desktop app and the extension save with the
 * usual checks, so a link already saved in another group would only come back later as "already
 * saved". With allow_duplicates, such links are reported now instead of being queued. Links that
 * can't be checked in time are queued as usual.
 */
async function settleQueuedDuplicates(
  ctx: ToolContext,
  groupId: string,
  batch: QueuedLink[],
  deadline: number,
): Promise<void> {
  const verdicts = await mapLimit(batch, 6, async (link) => {
    const remaining = deadline + REMOTE_QUEUE_TIMEOUT_MS - QUEUE_CHECK_RESERVE_MS - Date.now();
    if (remaining <= 0) return null;
    try {
      const check = await checkUrl(ctx.api, link.url, groupId, Math.min(5_000, remaining));
      if (check.exists) return checkDuplicate(check, true).message;
      if (check.elsewhere) {
        return `Already saved in ${check.elsewhere.folder_path}. Links that wait for your computer or Chrome can't be saved a second time yet (allow_duplicates only works for links saved straight away)`;
      }
    } catch {
      // Queue it; the computer checks again when it saves.
    }
    return null;
  });
  for (let i = batch.length - 1; i >= 0; i -= 1) {
    const message = verdicts[i];
    const link = batch[i];
    if (!message || !link) continue;
    link.result.status = "duplicate";
    link.result.message = message;
    delete link.result.needs;
    batch.splice(i, 1);
  }
}

async function flushRemoteQueue(
  ctx: ToolContext,
  groupId: string,
  batch: QueuedLink[],
): Promise<void> {
  if (batch.length === 0) return;
  const fail = (message: string) => {
    for (const link of batch) {
      link.result.status = "failed";
      link.result.message = message;
      delete link.result.needs;
    }
  };
  try {
    await ctx.api.post<LinkQueueRow[]>(
      "/link-queue",
      {
        folder_id: groupId,
        added_by: (ctx.addedBy ?? "Claude").trim().slice(0, 100) || "Claude",
        links: batch.map((link) => ({
          url: link.url,
          kind: link.kind,
          needs: link.needs,
          message: queueReason(link.message),
        })),
      },
      { timeoutMs: REMOTE_QUEUE_TIMEOUT_MS },
    );
  } catch (err) {
    fail(`Could not queue this link: ${messageOf(err)}`);
  }
}

function desktopQueueMessage(reason: string): string {
  return queuedForDesktopMessage("The cloud couldn't fetch this link", reason);
}

async function saveRemoteCloudLink(
  ctx: ToolContext,
  deps: LinkDeps,
  groupId: string,
  url: string,
  kind: LinkKind,
  deadline: number,
  allowDuplicates: boolean,
): Promise<RemoteResult> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    return queueRemoteLink(
      ctx,
      groupId,
      url,
      kind,
      "desktop",
      desktopQueueMessage("the cloud save time budget ran out"),
    );
  }

  const timeoutMs = Math.min(REMOTE_LINK_TIMEOUT_MS, remainingMs);
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const outcome = await withTimeout(
      saveLink(url, kind, groupId, deps, signal, allowDuplicates, timeoutMs),
      timeoutMs,
    );
    if (outcome.status === "paid") {
      return queueRemoteLink(
        ctx,
        groupId,
        url,
        kind,
        "desktop",
        "This Substack post is paid and needs the Sourcefold desktop app with your Substack cookie.",
      );
    }
    return {
      url,
      status: outcome.status,
      ...(outcome.title ? { title: outcome.title } : {}),
      ...(outcome.status === "saved" ? { itemId: outcome.itemId } : {}),
      ...(outcome.message ? { message: outcome.message } : {}),
    };
  } catch (err) {
    const reason = messageOf(err);
    if (isCloudRefusal(err)) {
      return queueRemoteLink(ctx, groupId, url, kind, "desktop", desktopQueueMessage(reason));
    }
    return { url, status: "failed", message: reason };
  }
}

function directQueueTarget(url: string, kind: LinkKind | null) {
  if (kind === "x") {
    return {
      needs: "browser" as const,
      message: "X posts need Chrome with the Sourcefold extension.",
    };
  }
  if (kind === "youtube_list" || detectLinkKind(url) === "youtube") {
    return {
      needs: "desktop" as const,
      message: "YouTube blocks cloud servers; waiting for the Sourcefold desktop app.",
    };
  }
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    // Invalid URLs are rejected by classifyLink before this helper is reached.
  }
  if (
    detectLinkKind(url) === "reddit" ||
    hostname === "reddit.com" ||
    hostname.endsWith(".reddit.com") ||
    hostname === "redd.it" ||
    hostname.endsWith(".redd.it")
  ) {
    return {
      needs: "desktop" as const,
      message: "Reddit often refuses cloud servers; waiting for the Sourcefold desktop app.",
    };
  }
  return null;
}

/**
 * The links to save, and every entry left out with its reason (QA 2026-11-05: duplicates, text
 * and file: links vanished, and local-network links were queued for the user's computer). Throws
 * only when nothing is left to save, saying why each entry was left out.
 */
async function readLinks(entries: string[]): Promise<{ urls: string[]; skipped: SkippedLink[] }> {
  const read = readLinkArgs(entries);
  const local = await refuseLocalAddresses(read.urls);
  const skipped = [...read.skipped, ...local.skipped];
  if (local.urls.length === 0) {
    throw new Error(
      [
        "No links to save. Pass full addresses starting with https://.",
        ...skippedLines(skipped),
      ].join("\n"),
    );
  }
  return { urls: local.urls, skipped };
}

/** Which helpers are running, from the check-ins; null when they can't be read. */
async function readLinkWorkers(ctx: ToolContext): Promise<LinkWorkersSeen | null> {
  try {
    return await ctx.api.get<LinkWorkersSeen>("/link-queue/workers");
  } catch {
    return null;
  }
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The closing sentence of add_links for links left waiting: which helper, and is it running. */
function waitingSentence(waiting: RemoteResult[], seen: LinkWorkersSeen | null): string {
  if (!seen) {
    return `${plural(waiting.length, "link")} ${waiting.length === 1 ? "is" : "are"} waiting for your computer. ${waiting.length === 1 ? "It'll" : "They'll"} be saved the next time the Sourcefold desktop app is open (X posts also need Chrome with the Sourcefold extension). Check with get_add_progress.`;
  }
  const alive = workersAlive(seen);
  const browser = waiting.filter((row) => row.needs === "browser").length;
  const desktop = waiting.length - browser;
  const parts: string[] = [];
  if (desktop > 0) {
    const them = desktop === 1 ? "it" : "them";
    parts.push(
      `${plural(desktop, "link")} ${desktop === 1 ? "waits" : "wait"} for the Sourcefold desktop app, which ${alive.desktop ? `is open and will save ${them} in a minute` : "isn't open"}.`,
    );
  }
  if (browser > 0) {
    const them = browser === 1 ? "it" : "them";
    const chrome = alive.chrome
      ? `is open and will save ${them} in a minute`
      : alive.chromeIdle
        ? "is open but isn't signed in or can't reach the desktop app yet"
        : "isn't open";
    const tail = desktop === 0 ? `; your desktop app ${alive.desktop ? "is" : "isn't"} open` : "";
    parts.push(
      `${plural(browser, "X post")} ${browser === 1 ? "waits" : "wait"} for Chrome with the Sourcefold extension, which ${chrome}${tail}.`,
    );
  }
  parts.push("Check with get_add_progress.");
  return parts.join(" ");
}

function formatRemoteResults(
  group: { id: string; path: string },
  results: RemoteResult[],
  skipped: SkippedLink[] = [],
  seen: LinkWorkersSeen | null = null,
): string {
  const count = (status: RemoteResult["status"]) =>
    results.filter((row) => row.status === status).length;
  const waiting = results.filter((row) => row.status === "waiting");
  const summary = [
    `${count("saved")} saved`,
    `${count("duplicate")} already saved`,
    `${count("unavailable")} unavailable`,
    `${count("failed")} failed`,
    `${waiting.length} waiting`,
    ...(skipped.length > 0 ? [`${skipped.length} left out`] : []),
  ];
  const lines = [`Adding to ${group.path} [${group.id}]: ${summary.join(", ")}.`];
  for (const result of results) {
    const title = result.title ? `${result.title} — ${result.url}` : result.url;
    const state =
      result.status === "waiting"
        ? lowerFirst(describeQueuedLink(queuedInfo(result), seen).label)
        : result.status === "duplicate"
          ? "already saved"
          : result.status === "unavailable"
            ? "not saved"
            : result.status;
    const id = result.itemId ? ` [${result.itemId}]` : "";
    lines.push(`- ${state}${id}: ${title}${result.message ? ` (${result.message})` : ""}`);
  }
  lines.push(...skippedLines(skipped));
  if (waiting.length > 0) {
    lines.push(waitingSentence(waiting, seen));
  } else {
    lines.push("Finished.");
  }
  return lines.join("\n");
}

async function addLinksRemote(
  args: {
    group_id: string;
    links: string[];
    allow_duplicates?: boolean;
    limit_per_collection?: number;
    published_after?: string;
    published_before?: string;
  },
  ctx: ToolContext,
): Promise<string> {
  const deadline = Date.now() + REMOTE_BUDGET_MS;
  const { urls: found, skipped } = await readLinks(args.links);
  const urls = found.slice(0, REMOTE_MAX_LINKS);
  const left = found.length - urls.length;
  const batch: QueuedLink[] = [];
  ctx = { ...ctx };
  queueBatches.set(ctx, batch);
  const group = await resolveGroup(ctx, args.group_id, Math.min(10_000, REMOTE_BUDGET_MS));
  const deps = await linkDepsFactory(ctx)();
  deps.deferUnavailable = true;
  deps.addedBy = ctx.addedBy ?? "Claude";
  const results: RemoteResult[] = [];

  for (const url of urls) {
    let kind = classifyLink(url);
    if (kind !== "publication" && kind !== "youtube_list") {
      const probed = await probeCollection(url, deps);
      if (probed === "publication") kind = "publication";
    }
    if (!kind) {
      results.push({ url, status: "failed", message: "Sourcefold can't save this kind of link." });
      continue;
    }

    const direct = directQueueTarget(url, kind);
    if (direct) {
      results.push(await queueRemoteLink(ctx, group.id, url, kind, direct.needs, direct.message));
      continue;
    }

    if (kind === "publication") {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        results.push(
          await queueRemoteLink(
            ctx,
            group.id,
            url,
            kind,
            "desktop",
            desktopQueueMessage("the cloud save time budget ran out"),
          ),
        );
        continue;
      }
      const timeoutMs = Math.min(REMOTE_LINK_TIMEOUT_MS, remaining);
      try {
        const list = await withTimeout(
          listCollection(
            url,
            "publication",
            {
              limit: args.limit_per_collection ?? 50,
              publishedAfter: args.published_after ?? null,
              publishedBefore: args.published_before ?? null,
              signal: AbortSignal.timeout(timeoutMs),
            },
            deps,
          ),
          timeoutMs,
        );
        if (list.links.length === 0) {
          results.push({
            url,
            status: "failed",
            message:
              args.published_after || args.published_before
                ? "No Substack posts in that date range."
                : "No Substack posts found.",
          });
          continue;
        }
        for (const link of list.links) {
          results.push(
            await saveRemoteCloudLink(
              ctx,
              deps,
              group.id,
              link.url,
              "substack",
              deadline,
              args.allow_duplicates ?? false,
            ),
          );
        }
      } catch (err) {
        if (isCloudRefusal(err)) {
          results.push(
            await queueRemoteLink(
              ctx,
              group.id,
              url,
              kind,
              "desktop",
              desktopQueueMessage(messageOf(err)),
            ),
          );
        } else {
          results.push({ url, status: "failed", message: messageOf(err) });
        }
      }
      continue;
    }

    results.push(
      await saveRemoteCloudLink(
        ctx,
        deps,
        group.id,
        url,
        kind,
        deadline,
        args.allow_duplicates ?? false,
      ),
    );
  }

  // A publication can list more posts than one queue write takes; the rest are left for later.
  const overflow = batch.splice(REMOTE_MAX_LINKS);
  for (const link of overflow) {
    link.result.status = "failed";
    link.result.message = `Not queued: one call queues at most ${REMOTE_MAX_LINKS} links. Add it again.`;
    delete link.result.needs;
  }
  if (args.allow_duplicates) await settleQueuedDuplicates(ctx, group.id, batch, deadline);
  await flushRemoteQueue(ctx, group.id, batch);
  const seen = results.some((row) => row.status === "waiting") ? await readLinkWorkers(ctx) : null;
  const reply = formatRemoteResults(group, results, skipped, seen);
  return left > 0
    ? `${reply}\nOnly the first ${REMOTE_MAX_LINKS} links were taken; ${left} more were left out. Call add_links again with the rest.`
    : reply;
}

function formatQueueRows(
  rows: LinkQueueRow[],
  seen: LinkWorkersSeen | null,
  recent = false,
): string {
  if (rows.length === 0) {
    return recent
      ? "No links were added in the last seven days."
      : "No links are waiting for your computer.";
  }
  const lines = rows.map((row) => {
    const status = describeQueuedLink(row, seen);
    const title = row.title ? `${row.title} — ${row.url}` : row.url;
    // "saved as [id]", never "saved saved as [id]" (QA 2026-11-04 P2-4).
    const saved = !row.item_id
      ? ""
      : row.status === "saved"
        ? ` as [${row.item_id}]`
        : ` [${row.item_id}]`;
    const hint = status.hint ? ` ${status.hint}` : "";
    const note =
      row.message && !status.hint.includes(row.message) && row.status !== "failed"
        ? ` (${row.message})`
        : "";
    return `- [${row.id}] ${lowerFirst(status.label)}${saved}: ${title}${note}${hint} — added by ${row.added_by}`;
  });
  const summary = summarizeLinks(rows, seen);
  const statuses = rows.map((row) => describeQueuedLink(row, seen));
  const counts = [
    `${summary.saved} saved`,
    `${statuses.filter((st) => st.state === "up_next" || st.state.startsWith("waiting")).length} waiting`,
    `${summary.needsYou} need${summary.needsYou === 1 ? "s" : ""} you`,
  ];
  lines.push(`${counts.join(", ")}.${summary.nextStep ? ` Next: ${summary.nextStep}` : ""}`);
  return lines.join("\n");
}

async function remoteAddProgress(
  args: { ids?: string[]; group_id?: string; recent?: boolean },
  ctx: ToolContext,
): Promise<string> {
  const rows = await ctx.api.get<LinkQueueRow[]>("/link-queue", {
    query: {
      status: args.recent ? "recent" : "open",
      ids: args.ids?.join(","),
      folder_id: args.group_id,
      limit: 500,
    },
  });
  const seen = rows.length > 0 ? await readLinkWorkers(ctx) : null;
  return formatQueueRows(rows, seen, args.recent ?? false);
}

async function cancelWaitingLinks(
  args: { ids?: string[]; group_id?: string },
  ctx: ToolContext,
): Promise<string> {
  let rows: LinkQueueRow[];
  let cancelled = 0;
  if (args.ids) {
    rows = await ctx.api.get<LinkQueueRow[]>("/link-queue", {
      query: { ids: args.ids.join(","), limit: 500 },
    });
    cancelled += await cancelRows(ctx, rows);
  } else {
    while (true) {
      rows = await ctx.api.get<LinkQueueRow[]>("/link-queue", {
        query: { status: "open", folder_id: args.group_id, limit: 500 },
      });
      if (rows.length === 0) break;
      const changed = await cancelRows(ctx, rows);
      cancelled += changed;
      if (changed === 0) break;
    }
  }
  return `${plural(cancelled, "waiting link")} cancelled.`;
}

async function cancelRows(ctx: ToolContext, rows: LinkQueueRow[]): Promise<number> {
  let cancelled = 0;
  for (const row of rows) {
    if (row.status !== "waiting" && row.status !== "working") continue;
    const result = await ctx.api.delete<LinkQueueRow>(`/link-queue/${encodeURIComponent(row.id)}`);
    if (result.status === "cancelled") cancelled++;
  }
  return cancelled;
}

export function registerAddTools(
  server: McpServer,
  ctx: ToolContext,
  pacing?: Pacing,
  store?: AddJobStore,
  onJobFinished?: (job: AddJob) => void,
): AddJobs {
  const jobStore = store ?? memoryJobStore();
  const finishedCallback = onJobFinished ?? (store ? () => scheduleDriveSave(ctx.api) : undefined);
  const jobs = new AddJobs(linkDepsFactory(ctx), pacing, jobStore, finishedCallback);
  jobs.restore();

  defineTool(server, ctx, {
    name: "add_links",
    title: "Add links",
    description:
      ctx.mode === "remote"
        ? "Saves links into a group, like pasting them into Sourcefold's Add links. Works for Grokipedia and Wikipedia articles, web pages, PDFs and arXiv papers, Hacker News threads, Bluesky posts and Substack posts (including a publication on its own domain). A YouTube playlist or channel, or a Substack publication, is expanded into its videos or posts (up to limit_per_collection each; Substack can be narrowed by date).\n\nThis is the web connector: each call saves what a cloud server can fetch, then returns. YouTube, Reddit and pages that refuse the cloud wait for the Sourcefold desktop app. X posts wait for Chrome with the Sourcefold extension. There is no job id. Check what is still waiting with get_add_progress, which lists each waiting link with its queue id and shows whether the desktop app and Chrome are running. Links already saved in the group are reported, not saved twice. Use list_collection first to look at a playlist or publication without saving."
        : "Saves links into a group, like pasting them into Sourcefold's Add links. Works for Grokipedia and Wikipedia articles, YouTube videos (their transcript), web pages, PDFs and arXiv papers, Reddit and Hacker News threads, Bluesky posts and Substack posts (including a publication on its own domain). A YouTube playlist or channel, or a Substack publication, is expanded into its videos or posts (up to limit_per_collection each; Substack can be narrowed by date).\n\nSaving runs in the background, one link after another, and this call returns a job id. YouTube videos are spaced a few seconds apart and wait when YouTube pushes back. Check that job with get_add_progress. Links the cloud or this computer can't fetch wait for the desktop app, and X posts wait for Chrome with the Sourcefold extension. Links already saved in the group are reported, not saved twice. Use list_collection first to look at a playlist or publication without saving.",
    input: {
      group_id: z.string().describe("The group to save into (not a project)."),
      links: z
        .array(z.string())
        .min(1)
        .max(500)
        .describe("The links. Each entry may also be text containing several links."),
      allow_duplicates: z
        .boolean()
        .default(false)
        .describe(
          "Only allows saving a second copy in a different group of the same project. Same-group duplicates are still refused (a group holds each link once). Links that wait for the desktop app or Chrome (in the web connector: YouTube, Reddit, X and pages the cloud can't fetch) can't be saved a second time yet; they are reported as already saved. Default false.",
        ),
      limit_per_collection: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe(
          "Most videos or posts to take from each playlist, channel or publication. Default 50.",
        ),
      published_after: DATE.describe(
        "Substack publications only: save only posts published after this day (YYYY-MM-DD).",
      ),
      published_before: DATE.describe(
        "Substack publications only: save only posts published before this day (YYYY-MM-DD).",
      ),
      wait_seconds: z
        .number()
        .int()
        .min(0)
        .max(MAX_WAIT_SECONDS)
        .optional()
        .describe(
          `How long to wait for the job before answering. Default 25, at most ${MAX_WAIT_SECONDS}.`,
        ),
    },
    openWorld: true,
    run: async (args) => {
      if (ctx.mode === "remote") return addLinksRemote(args, ctx);
      const { urls, skipped } = await readLinks(args.links);
      const group = await resolveGroup(ctx, args.group_id);
      const deps = await linkDepsFactory(ctx)();
      const rows = [];
      for (const url of urls) {
        let kind = classifyLink(url);
        if (kind !== "publication" && kind !== "youtube_list") {
          const probed = await probeCollection(url, deps);
          if (probed === "publication") kind = "publication";
        }
        rows.push({ url, kind });
      }
      const job = jobs.start(group.id, group.path, rows, {
        limitPerCollection: args.limit_per_collection ?? 50,
        publishedAfter: args.published_after ?? null,
        publishedBefore: args.published_before ?? null,
        allowDuplicates: args.allow_duplicates ?? false,
      });
      await jobs.waitForEnd(job, (args.wait_seconds ?? 25) * 1000);
      const reply = formatJob(job, Date.now(), jobs.ahead(job));
      if (skipped.length === 0) return reply;
      return [reply, "Left out:", ...skippedLines(skipped)].join("\n");
    },
  });

  defineTool(server, ctx, {
    name: "get_add_progress",
    title: "Add progress",
    description:
      ctx.mode === "remote"
        ? "Lists links that add_links left waiting for the Sourcefold desktop app or for Chrome with the extension, and says whether the desktop app and Chrome are running and what to open. Each open row includes its queue id in brackets; pass those ids to cancel_waiting_links to cancel one link. By default this shows links still waiting or being saved. Pass recent=true for rows finished in the last seven days, ids for specific rows, or group_id to filter. There are no background job ids on the web connector."
        : "Checks an add_links job. Pass the job id add_links returned. Omit it to list recent jobs. wait_seconds waits for the job to finish before answering. stop=true stops it after the current link. Links that end up waiting for the desktop app or Chrome are included, each with its queue id.",
    input: {
      job_id: z.string().optional().describe("The job id add_links answered with."),
      ids: z
        .array(z.string().uuid())
        .min(1)
        .max(200)
        .optional()
        .describe("Remote connector only: show these link queue rows, in any state."),
      group_id: z
        .string()
        .uuid()
        .optional()
        .describe("Remote connector only: show queue rows in this group."),
      recent: z
        .boolean()
        .optional()
        .describe("Remote connector only: include rows finished in the last seven days."),
      wait_seconds: z
        .number()
        .int()
        .min(0)
        .max(MAX_WAIT_SECONDS)
        .optional()
        .describe(
          `How long to wait for the job to finish before answering. Default 20, at most ${MAX_WAIT_SECONDS}.`,
        ),
      stop: z.boolean().optional().describe("Stop the job. Links still waiting are not saved."),
    },
    // Saving happens in the background; checking on it only reads.
    readOnly: true,
    run: async (args) => {
      if (ctx.mode === "remote") return remoteAddProgress(args, ctx);
      if (!args.job_id) {
        const recent = jobs.list();
        if (recent.length === 0) return "No add jobs.";
        return recent
          .map((job) => {
            const done = job.rows.filter(isRowDone).length;
            return `- job ${job.id}: ${job.state}, ${done} of ${plural(job.rows.length, "link")} done, into ${job.groupPath}`;
          })
          .join("\n");
      }
      const job = jobs.get(args.job_id);
      if (!job) {
        throw new Error(
          `No add job ${args.job_id}. Only the last 20 jobs are kept; call get_add_progress without a job_id to list them.`,
        );
      }
      if (args.stop) {
        jobs.stop(job.id);
        await jobs.waitForEnd(job, 5_000);
      } else {
        await jobs.waitForEnd(job, (args.wait_seconds ?? 20) * 1000);
      }
      return formatJob(job, Date.now(), jobs.ahead(job));
    },
  });

  defineTool(server, ctx, {
    name: "cancel_waiting_links",
    title: "Cancel waiting links",
    description:
      "Cancels open link queue rows that have not finished saving. Pass ids to cancel specific links, or group_id to cancel every open link in that group.",
    input: {
      ids: z.array(z.string().uuid()).min(1).max(200).optional(),
      group_id: z.string().uuid().optional(),
    },
    syncDrive: false,
    run: async (args) => {
      if (Boolean(args.ids) === Boolean(args.group_id)) {
        throw new Error("Give either ids or group_id.");
      }
      return cancelWaitingLinks(args, ctx);
    },
  });

  defineTool(server, ctx, {
    name: "list_collection",
    title: "List a playlist, channel or publication",
    description:
      "Lists the videos of a YouTube playlist or channel (newest first for channels) or the posts of a Substack publication (with date and paid/free), without saving anything. Use it to pick what to pass to add_links.",
    input: {
      url: z
        .string()
        .describe("A YouTube playlist or channel link, or a Substack publication address."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Most entries to list. Default 50."),
      published_after: DATE.describe("Substack only: posts published after this day (YYYY-MM-DD)."),
      published_before: DATE.describe(
        "Substack only: posts published before this day (YYYY-MM-DD).",
      ),
    },
    readOnly: true,
    openWorld: true,
    run: async (args) => {
      const deps = await linkDepsFactory(ctx)();
      const kind = (await collectionKind(args.url.trim(), deps)) ?? classifyLink(args.url.trim());
      if (kind !== "youtube_list" && kind !== "publication") {
        throw new Error(
          "That isn't a YouTube playlist or channel, or a Substack publication. For single links use add_links.",
        );
      }
      const list = await listCollection(
        args.url.trim(),
        kind,
        {
          limit: args.limit ?? 50,
          publishedAfter: args.published_after ?? null,
          publishedBefore: args.published_before ?? null,
        },
        deps,
      );
      if (list.links.length === 0)
        return kind === "publication" ? "No posts found." : "No videos found.";
      const what = kind === "publication" ? "post" : "video";
      const head = `${list.title ? `${list.title}: ` : ""}${plural(list.links.length, what)}${list.truncated ? ` (more exist; raise limit to see them)` : ""}.`;
      return [
        head,
        "",
        ...list.links.map(
          (l, i) =>
            `${i + 1}. ${l.title ?? "(untitled)"}${l.detail ? ` · ${l.detail}` : ""} — ${l.url}`,
        ),
      ].join("\n");
    },
  });

  return jobs;
}
