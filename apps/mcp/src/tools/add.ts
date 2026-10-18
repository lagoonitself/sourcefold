import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { extractUrls, formatWait } from "@sourcefold/core/capture";
import { z } from "zod";
import { createNodeSourceFetch, createPublicFetch } from "../links/public-fetch";
import { classifyLink, listCollection, type LinkDeps } from "../links/save-link";
import type { Folder } from "../types";
import { AddJobs, isRowDone, type AddJob, type JobRow, type Pacing } from "./add-jobs";
import { defineTool, type ToolContext } from "./define";
import { indexFolders, plural } from "./format";

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .optional();
/** Claude Desktop cuts a tool call off after about a minute. */
const MAX_WAIT_SECONDS = 50;
const ROWS_SHOWN = 60;

const STATUS_LABEL: Record<JobRow["status"], string> = {
  waiting: "waiting",
  finding: "finding videos or posts",
  saving: "saving",
  saved: "saved",
  duplicate: "already saved",
  unavailable: "not saved",
  paid: "paid, not saved",
  paused: "paused",
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
  return `- ${STATUS_LABEL[r.status]}${id}: ${name}${message ? ` (${message})` : ""}`;
}

export function formatJob(job: AddJob, now = Date.now()): string {
  const count = (status: JobRow["status"]) => job.rows.filter((r) => r.status === status).length;
  const done = job.rows.filter(isRowDone).length;
  const lines: string[] = [];

  const parts = [
    `${count("saved")} saved`,
    count("duplicate") && `${count("duplicate")} already saved`,
    count("unavailable") && `${count("unavailable")} not saved (no captions or similar)`,
    count("paid") && `${count("paid")} paid`,
    count("failed") && `${count("failed")} failed`,
    count("skipped") && `${count("skipped")} skipped`,
  ].filter(Boolean);
  lines.push(
    `Adding to ${job.groupPath} [${job.groupId}], job ${job.id}: ${done} of ${plural(job.rows.length, "link")} done (${parts.join(", ")}).`,
  );

  if (job.state === "running" || job.state === "queued") {
    lines.push(
      job.state === "queued"
        ? "Waiting for an earlier add job to finish."
        : "Still running in the background. YouTube videos are saved a few seconds apart.",
      `Check again with get_add_progress { "job_id": "${job.id}" }.`,
    );
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
    sourceFetch: createNodeSourceFetch(),
    publicFetch: createPublicFetch(),
    desktopOpen: (await ctx.desktop.status()) !== null,
  });
}

async function resolveGroup(
  ctx: ToolContext,
  groupId: string,
): Promise<{ id: string; path: string }> {
  const folders = await ctx.api.get<Folder[]>("/folders", { query: { includeArchived: true } });
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

export function registerAddTools(server: McpServer, ctx: ToolContext, pacing?: Pacing): AddJobs {
  const jobs = new AddJobs(linkDepsFactory(ctx), pacing);

  defineTool(server, ctx, {
    name: "add_links",
    title: "Add links",
    description: `Saves links into a group, like pasting them into Sourcefold's Add links. Works for Grokipedia and Wikipedia articles, YouTube videos (their transcript), web pages, PDFs and arXiv papers, Reddit and Hacker News threads, Bluesky posts and Substack posts. A YouTube playlist or channel, or a Substack publication, is expanded into its videos or posts (up to limit_per_collection each; Substack can be narrowed by date). X posts can't be added here (the user saves them with the browser extension).

Saving runs in the background, one link after another; YouTube videos are spaced a few seconds apart and wait when YouTube pushes back, so many videos take minutes. This waits up to wait_seconds, then answers with the progress and a job id: call get_add_progress with it until it says Finished. Links already saved in the group are reported, not saved twice. Use list_collection first to look at a playlist or publication without saving.`,
    input: {
      group_id: z.string().describe("The group to save into (not a project)."),
      links: z
        .array(z.string())
        .min(1)
        .max(500)
        .describe("The links. Each entry may also be text containing several links."),
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
        "Substack publications only: posts published after this day (YYYY-MM-DD).",
      ),
      published_before: DATE.describe(
        "Substack publications only: posts published before this day (YYYY-MM-DD).",
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
      const urls = [...new Set(extractUrls(args.links.join("\n")))];
      if (urls.length === 0)
        throw new Error("No links found. Pass full addresses starting with https://.");
      const group = await resolveGroup(ctx, args.group_id);
      const job = jobs.start(
        group.id,
        group.path,
        urls.map((url) => ({ url, kind: classifyLink(url) })),
        {
          limitPerCollection: args.limit_per_collection ?? 50,
          publishedAfter: args.published_after ?? null,
          publishedBefore: args.published_before ?? null,
        },
      );
      await jobs.waitForEnd(job, (args.wait_seconds ?? 25) * 1000);
      return formatJob(job);
    },
  });

  defineTool(server, ctx, {
    name: "get_add_progress",
    title: "Add progress",
    description:
      "Progress of an add_links job: each link's state (waiting, saving, saved with its source id, already saved, not saved with the reason, paid, paused while YouTube limits requests, failed with the message). Waits up to wait_seconds for the job to finish first. Pass stop: true to stop it after the link being saved now. Without job_id, lists the recent jobs.",
    input: {
      job_id: z.string().optional().describe("The job id add_links answered with."),
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
      if (!args.job_id) {
        const recent = jobs.list();
        if (recent.length === 0) return "No add jobs since Claude Desktop started.";
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
          `No add job ${args.job_id}. Jobs are kept until Claude Desktop restarts; call get_add_progress without a job_id to list them.`,
        );
      }
      if (args.stop) {
        jobs.stop(job.id);
        await jobs.waitForEnd(job, 5_000);
      } else {
        await jobs.waitForEnd(job, (args.wait_seconds ?? 20) * 1000);
      }
      return formatJob(job);
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
      const kind = classifyLink(args.url.trim());
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
        await linkDepsFactory(ctx)(),
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
