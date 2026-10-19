import { NextResponse } from "next/server";
import { z } from "zod";
import { canonicalizeUrl, detectLinkKind, SourceError } from "@sourcefold/core";
import {
  fetchSourceCapture,
  parseHtmlOnServer,
  sourceFetchFromGlobalFetch,
} from "@sourcefold/core/server";
import { requireApiUser } from "@/lib/api";
import { BlockedAddressError, publicFetch } from "@/lib/public-fetch";
import {
  elsewhereError,
  findDuplicate,
  findDuplicateElsewhere,
  formatDuplicateMessage,
} from "@/features/capture/find-duplicate";
import { saveSource, saveSourceUnavailable } from "@/features/capture/save-source";
import { pushToDriveSoon } from "@/features/drive/push-to-drive-soon";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INVALID_URL = "That isn't a link Sourcefold can open.";
const INVALID_FOLDER = "That group no longer exists.";
const YOUTUBE_MESSAGE =
  "Save YouTube videos with the desktop app or the Sourcefold extension. YouTube blocks requests from servers.";
const DESKTOP_HINT = " Try the desktop app or the Sourcefold extension.";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const saveSourceSchema = z.object({
  url: z.string().trim().min(1, "URL is required"),
  folder_id: z.string().uuid("Invalid folder ID"),
  // Save the link even though it is already in another group of the project.
  allow_duplicate: z.boolean().optional(),
});

const ERROR_STATUS = {
  invalid_url: 400,
  not_found: 404,
  blocked: 422,
  too_large: 413,
  parse_failed: 422,
  fetch_failed: 502,
} as const;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_url", INVALID_URL, 400);
  }

  const parsed = saveSourceSchema.safeParse(body);
  if (!parsed.success) {
    const isFolderError = parsed.error.issues.some((issue) => issue.path.includes("folder_id"));
    return errorResponse(
      isFolderError ? "invalid_folder" : "invalid_url",
      isFolderError ? INVALID_FOLDER : INVALID_URL,
      400,
    );
  }

  const { url, folder_id: folderId, allow_duplicate: allowDuplicate } = parsed.data;
  const kind = detectLinkKind(url);
  if (!kind) return errorResponse("invalid_url", INVALID_URL, 400);
  if (kind === "youtube") return errorResponse("youtube_unsupported", YOUTUBE_MESSAGE, 422);

  // Check the pasted link first so a duplicate costs no request.
  let canonical: string | null = null;
  try {
    canonical = canonicalizeUrl(url);
  } catch {
    canonical = null;
  }
  if (canonical) {
    const existing = await findDuplicate(auth.db, auth.userId, canonical, folderId);
    if (existing) {
      return NextResponse.json(
        {
          error: {
            code: "duplicate",
            message: formatDuplicateMessage(existing.folder_name),
            item_id: existing.item_id,
            folder_id: existing.folder_id,
            folder_name: existing.folder_name,
          },
        },
        { status: 409 },
      );
    }
    if (!allowDuplicate) {
      const elsewhere = await findDuplicateElsewhere(auth.db, auth.userId, canonical, folderId);
      if (elsewhere) {
        return NextResponse.json({ error: elsewhereError(elsewhere) }, { status: 409 });
      }
    }
  }

  let extracted;
  try {
    extracted = await fetchSourceCapture(url, {
      fetch: sourceFetchFromGlobalFetch(publicFetch, {
        "User-Agent": BROWSER_USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
      }),
      parseHtml: parseHtmlOnServer,
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    if (error instanceof BlockedAddressError) {
      return errorResponse("invalid_url", INVALID_URL, 400);
    }
    if (error instanceof SourceError) {
      let message = error.message;
      if (error.code === "blocked" && kind === "reddit" && !/desktop app/i.test(message)) {
        message += DESKTOP_HINT;
      }
      return errorResponse(error.code, message, ERROR_STATUS[error.code] ?? 502);
    }
    return errorResponse("fetch_failed", "Couldn't reach that page. Try again.", 502);
  }

  const result =
    extracted.status === "ok"
      ? await saveSource(auth.db, auth.userId, extracted.kind, folderId, extracted.capture, {
          allowDuplicate,
        })
      : await saveSourceUnavailable(auth.db, auth.userId, {
          folder_id: folderId,
          allow_duplicate: allowDuplicate,
          source: extracted.kind,
          url: extracted.url,
          title: extracted.title,
          reason: extracted.reason,
        });

  if (result.success) {
    pushToDriveSoon(auth.userId);
    const data: { item: typeof result.item; unavailable?: true; reason?: string } = {
      item: result.item,
    };
    if (result.unavailable && extracted.status === "unavailable") {
      data.unavailable = true;
      data.reason = extracted.reason;
    }
    return NextResponse.json({ data }, { status: 201 });
  }

  return NextResponse.json({ error: result.error }, { status: result.status });
}
