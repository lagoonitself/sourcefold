// `createLocalApi`: the website's `/api/*` answered inside the desktop app or the extension. Same
// paths, methods, bodies and answers as the website, because the handlers are the same code
// (src/routes). Contract: docs/dev/handoff-no-website.md, "The local API".
import type { RouteContext, RouteModule } from "./context";
import { createDriveAccess } from "./drive/token";
import { createDrivePusher, type DrivePusher } from "./drive/push";
import { createWorkerContentStore } from "./features/content/worker-store";
import type { Host } from "./host";
import { jsonData, jsonError } from "./http";
import type { LocalApi, LocalApiDeps } from "./types";

import * as capture from "./routes/capture";
import * as cards from "./routes/cards";
import * as card from "./routes/cards/[id]";
import * as driveSave from "./routes/drive/save";
import * as driveStatus from "./routes/drive/status";
import * as folders from "./routes/folders";
import * as folder from "./routes/folders/[id]";
import * as grokipedia from "./routes/grokipedia";
import * as highlights from "./routes/highlights";
import * as highlight from "./routes/highlights/[id]";
import * as items from "./routes/items";
import * as item from "./routes/items/[id]";
import * as itemContent from "./routes/items/[id]/content";
import * as itemTextUndos from "./routes/items/[id]/text-undos";
import * as itemFile from "./routes/items/[id]/file";
import * as itemMedia from "./routes/items/[id]/media";
import * as itemMediaFile from "./routes/items/[id]/media/[name]";
import * as itemMediaUpload from "./routes/items/[id]/media-upload";
import * as itemMerge from "./routes/items/[id]/merge";
import * as itemsCheck from "./routes/items/check";
import * as linkQueue from "./routes/link-queue";
import * as linkQueueClaim from "./routes/link-queue/claim";
import * as linkQueueItem from "./routes/link-queue/[id]";
import * as mirror from "./routes/mirror";
import * as notes from "./routes/notes";
import * as outlineSections from "./routes/outline-sections";
import * as outlineSection from "./routes/outline-sections/[id]";
import * as tldrs from "./routes/tldrs";
import * as tldr from "./routes/tldrs/[itemId]";
import * as shelf from "./routes/shelf";
import * as shelfLink from "./routes/shelf/[id]";
import * as shelfLinkOpen from "./routes/shelf/[id]/open";
import * as projectExport from "./routes/projects/[id]/export";
import * as projectImport from "./routes/projects/[id]/import";
import * as projectInvite from "./routes/projects/[id]/invite";
import * as projectInviteReset from "./routes/projects/[id]/invite/reset";
import * as projectMember from "./routes/projects/[id]/members/[userId]";
import * as projectSharing from "./routes/projects/[id]/sharing";
import * as invite from "./routes/invites/[code]";
import * as inviteAccept from "./routes/invites/[code]/accept";
import * as settingsBackup from "./routes/settings/backup";
import * as uploads from "./routes/uploads";
import * as uploadsSign from "./routes/uploads/sign";
import * as xPosts from "./routes/x/[itemId]/posts";
import * as xRecent from "./routes/x/recent";

/** Paths as the website names its route folders; `[name]` matches one path segment. */
export const LOCAL_ROUTES: ReadonlyArray<readonly [string, RouteModule]> = [
  ["/api/capture", capture],
  ["/api/cards", cards],
  ["/api/cards/[id]", card],
  ["/api/drive/save", driveSave],
  ["/api/drive/status", driveStatus],
  ["/api/folders", folders],
  ["/api/folders/[id]", folder],
  ["/api/grokipedia", grokipedia],
  ["/api/highlights", highlights],
  ["/api/highlights/[id]", highlight],
  ["/api/items", items],
  ["/api/items/check", itemsCheck],
  ["/api/items/[id]", item],
  ["/api/items/[id]/content", itemContent],
  ["/api/items/[id]/text-undos", itemTextUndos],
  ["/api/items/[id]/file", itemFile],
  ["/api/items/[id]/media", itemMedia],
  ["/api/items/[id]/media/[name]", itemMediaFile],
  ["/api/items/[id]/media-upload", itemMediaUpload],
  ["/api/items/[id]/merge", itemMerge],
  ["/api/link-queue", linkQueue],
  ["/api/link-queue/claim", linkQueueClaim],
  ["/api/link-queue/[id]", linkQueueItem],
  ["/api/mirror", mirror],
  ["/api/notes", notes],
  ["/api/outline-sections", outlineSections],
  ["/api/outline-sections/[id]", outlineSection],
  ["/api/shelf", shelf],
  ["/api/shelf/[id]", shelfLink],
  ["/api/shelf/[id]/open", shelfLinkOpen],
  ["/api/tldrs", tldrs],
  ["/api/tldrs/[itemId]", tldr],
  ["/api/projects/[id]/export", projectExport],
  ["/api/projects/[id]/import", projectImport],
  ["/api/projects/[id]/invite", projectInvite],
  ["/api/projects/[id]/invite/reset", projectInviteReset],
  ["/api/projects/[id]/members/[userId]", projectMember],
  ["/api/projects/[id]/sharing", projectSharing],
  ["/api/invites/[code]", invite],
  ["/api/invites/[code]/accept", inviteAccept],
  ["/api/settings/backup", settingsBackup],
  ["/api/uploads", uploads],
  ["/api/uploads/sign", uploadsSign],
  ["/api/x/[itemId]/posts", xPosts],
  ["/api/x/recent", xRecent],
];

/** A write the database refused (row-level security): a viewer of a shared project. */
const READ_ONLY_PATTERN = /row-level security|not allowed|permission denied|42501/i;
const READ_ONLY_MESSAGE = "You can view this project but not change it.";

function failureResponse(err: unknown): Response {
  const message = err instanceof Error ? err.message : "";
  const code = (err as { code?: unknown } | null)?.code;
  if (READ_ONLY_PATTERN.test(message) || code === "42501") {
    return jsonError(403, READ_ONLY_MESSAGE);
  }
  return jsonError(500, "Something went wrong. Try again.");
}

/** A fixed origin for the Request objects handlers read their query from. */
const LOCAL_ORIGIN = "http://sourcefold.local";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof METHODS)[number];

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

const compiled = LOCAL_ROUTES.map(([pattern, module]) => ({
  segments: splitPath(pattern),
  module,
}));

/**
 * Finds the route for a path. Literal segments win over `[param]` ones, so
 * `/api/items/check` is never read as `/api/items/[id]` with id "check".
 */
export function matchRoute(
  pathname: string,
): { module: RouteModule; params: Record<string, string> } | null {
  const parts = splitPath(pathname);
  let best: { module: RouteModule; params: Record<string, string>; literals: number } | null = null;
  for (const route of compiled) {
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let literals = 0;
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const segment = route.segments[i]!;
      const part = parts[i]!;
      if (segment.startsWith("[") && segment.endsWith("]")) {
        try {
          params[segment.slice(1, -1)] = decodeURIComponent(part);
        } catch {
          ok = false;
          break;
        }
      } else if (segment === part) {
        literals++;
      } else {
        ok = false;
        break;
      }
    }
    if (ok && (!best || literals > best.literals))
      best = { module: route.module, params, literals };
  }
  return best ? { module: best.module, params: best.params } : null;
}

export interface LocalApiWithDrive extends LocalApi {
  /** Pushes pending changes to Drive now instead of in a few seconds (sign-out, tests). */
  flushDrivePush(): Promise<void>;
  /** Stops a scheduled push (sign-out). */
  dispose(): void;
}

export function createLocalApi(
  deps: LocalApiDeps,
  options: { drivePushDelayMs?: number } = {},
): LocalApiWithDrive {
  const { supabase } = deps;
  const drive = createDriveAccess(supabase);
  let pusher: DrivePusher | null = null;
  const host: Host = {
    drive,
    content: deps.contentUrl
      ? createWorkerContentStore({
          baseUrl: deps.contentUrl,
          authorization: async () => {
            const token = deps.accessToken
              ? await deps.accessToken()
              : ((await supabase.auth.getSession()).data.session?.access_token ?? null);
            return token ? `Bearer ${token}` : null;
          },
        })
      : null,
    fetchUrl: deps.fetchUrl,
    parseHtml: deps.parseHtml,
    scheduleDrivePush: (userId) => pusher?.schedule(userId),
  };
  pusher = createDrivePusher(supabase, host, {
    delayMs: options.drivePushDelayMs,
    onPushed: deps.onItemsChanged,
  });

  async function handle(path: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(path, LOCAL_ORIGIN);
    const method = (init.method ?? "GET").toUpperCase() as Method;

    if (url.pathname === "/api/health") {
      if (method !== "GET") return jsonError(405, "Method not allowed.");
      const { error } = await supabase.rpc("health");
      return error
        ? Response.json({ error: { message: "Database unreachable" } }, { status: 503 })
        : jsonData({ status: "ok" });
    }

    const match = matchRoute(url.pathname);
    if (!match) return jsonError(404, "Not found.");
    if (!METHODS.includes(method) || !match.module[method]) {
      return jsonError(405, "Method not allowed.");
    }

    // The session lives on this computer; reading it needs no request. The database checks the
    // token itself, so a stale user id can only ever find nothing.
    const userId = deps.currentUserId
      ? await deps.currentUserId()
      : ((await supabase.auth.getSession()).data.session?.user.id ?? null);
    if (!userId) return jsonError(401, "Sign in to continue.");

    const ctx: RouteContext = { db: supabase, userId, via: "session", host };
    let response: Response;
    try {
      response = await dispatchRoute(ctx, url.toString(), init);
    } catch (err) {
      console.error(`${method} ${url.pathname} failed:`, err);
      return failureResponse(err);
    }
    if (method !== "GET" && response.ok) deps.onItemsChanged?.();
    return response;
  }

  return {
    fetch: handle,
    flushDrivePush: () => pusher!.flush(),
    dispose: () => pusher?.cancel(),
  };
}

/** Dispatches a website API path through the shared route handlers as a supplied user. */
export async function dispatchRoute(
  ctx: RouteContext,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = new URL(path, LOCAL_ORIGIN);
  const method = (init.method ?? "GET").toUpperCase() as Method;
  if (url.pathname === "/api/health") {
    if (method !== "GET") return jsonError(405, "Method not allowed.");
    try {
      const { error } = await ctx.db.rpc("health");
      return error
        ? Response.json({ error: { message: "Database unreachable" } }, { status: 503 })
        : jsonData({ status: "ok" });
    } catch (err) {
      console.error(`${method} ${url.pathname} failed:`, err);
      return jsonError(500, "Something went wrong. Try again.");
    }
  }
  const match = matchRoute(url.pathname);
  if (!match) return jsonError(404, "Not found.");
  const handler = METHODS.includes(method) ? match.module[method] : undefined;
  if (!handler) return jsonError(405, "Method not allowed.");

  try {
    return await handler(ctx, new Request(url, init), match.params as never);
  } catch (err) {
    console.error(`${method} ${url.pathname} failed:`, err);
    return failureResponse(err);
  }
}
