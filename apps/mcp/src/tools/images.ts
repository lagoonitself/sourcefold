import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WIKIPEDIA_USER_AGENT } from "@sourcefold/core/capture";
import { z } from "zod";
import type { Item } from "../types";
import { defineTool, type ToolContext } from "./define";
import { messageOf } from "./format";
import { loadFolderIndex, requireFolder } from "./library-data";

// add_image copies the desktop app's `addImage` (apps/desktop/src/lib/api.ts): ask the web app for
// a signed upload URL, send the file to storage, then tell the web app to create the item.

/** Same limit as the web app and the desktop app. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const TYPE_ERROR = "Upload a PNG, JPEG, GIF or WebP image.";
const SIZE_ERROR = "Images can be up to 10 MB.";
const DOWNLOAD_TIMEOUT_MS = 30_000;

const EXTENSION_FOR_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};
const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

/** The image type from the file's first bytes, or null when it isn't one the web app takes. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

async function readLocalImage(path: string): Promise<{ bytes: Uint8Array; fileName: string }> {
  const extension = extname(path).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error(`${TYPE_ERROR} (${basename(path)})`);
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new Error(`There is no file at ${path} on this computer.`);
  }
  if (!info.isFile()) throw new Error(`${path} isn't a file.`);
  if (info.size > MAX_IMAGE_BYTES) throw new Error(SIZE_ERROR);
  return { bytes: new Uint8Array(await readFile(path)), fileName: basename(path) };
}

async function downloadImage(url: string): Promise<{ bytes: Uint8Array; fileName: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`"${url}" isn't a web address.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https addresses can be downloaded.");
  }
  let res: Response;
  try {
    // Wikimedia (upload.wikimedia.org) refuses downloads that don't say who they are.
    res = await fetch(parsed, {
      headers: { "User-Agent": WIKIPEDIA_USER_AGENT },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch {
    throw new Error(`Couldn't download ${url}.`);
  }
  if (!res.ok) throw new Error(`Couldn't download ${url}: the site answered ${res.status}.`);
  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_IMAGE_BYTES) throw new Error(SIZE_ERROR);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(SIZE_ERROR);
  let last = parsed.pathname.split("/").pop() ?? "";
  try {
    last = decodeURIComponent(last);
  } catch {
    // Keep the raw name.
  }
  return { bytes, fileName: last || "image" };
}

async function storageMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    message?: unknown;
    error?: unknown;
  } | null;
  const error = body?.error as { message?: unknown } | string | undefined;
  const message = body?.message ?? (typeof error === "object" ? error?.message : error);
  return typeof message === "string" && message
    ? message
    : `The upload failed with status ${res.status}.`;
}

export function registerImagesTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, ctx, {
    name: "add_image",
    title: "Add an image",
    description:
      "Adds a picture (PNG, JPEG, GIF or WebP, up to 10 MB) to a group as an image source. Give exactly one of path (a file on this computer) or url (a web address to download it from). The title defaults to the file name. Sources can't live directly in a project, so group_id must be a group. Answers with the new image's id.",
    input: {
      group_id: z.string().min(1).describe("Id of the group to put the image in."),
      path: z
        .string()
        .optional()
        .describe("Full path of an image file on this computer. Use this or url, not both."),
      url: z
        .string()
        .optional()
        .describe("http(s) address of an image to download. Use this or path, not both."),
      title: z
        .string()
        .max(500)
        .optional()
        .describe("Title for the image. Default: the file name."),
    },
    openWorld: true,
    run: async ({ group_id, path, url, title }, { api }) => {
      if ((path ? 1 : 0) + (url ? 1 : 0) !== 1) {
        throw new Error(
          "Give exactly one of path (a file on this computer) or url (a web address).",
        );
      }
      const index = await loadFolderIndex(api);
      const group = requireFolder(index, group_id, "group");

      const { bytes, fileName: foundName } = path
        ? await readLocalImage(path)
        : await downloadImage(url!);
      const mimeType = sniffImageType(bytes);
      if (!mimeType) throw new Error(TYPE_ERROR);

      let fileName = foundName;
      if (!ALLOWED_EXTENSIONS.has(extname(fileName).toLowerCase())) {
        fileName = `${fileName.replace(/\.[^.]*$/, "") || "image"}${EXTENSION_FOR_TYPE[mimeType]}`;
      }

      const signed = await api.post<{
        item_id: string;
        storage_path: string;
        signed_url: string;
        apikey?: string | null;
      }>("/uploads/sign", {
        folder_id: group_id,
        file_name: fileName,
        mime_type: mimeType,
        size: bytes.length,
      });

      // The same request supabase-js makes for uploadToSignedUrl with a Blob.
      const form = new FormData();
      form.append("cacheControl", "3600");
      form.append("", new Blob([bytes as BlobPart], { type: mimeType }), fileName);
      const headers: Record<string, string> = { "x-upsert": "false" };
      if (signed.apikey) headers.apikey = signed.apikey;
      let put: Response;
      try {
        put = await fetch(signed.signed_url, { method: "PUT", headers, body: form });
      } catch (err) {
        throw new Error(`The upload failed: ${messageOf(err)}`);
      }
      if (!put.ok) throw new Error(await storageMessage(put));

      const item = await api.post<Item>("/uploads", {
        item_id: signed.item_id,
        folder_id: group_id,
        storage_path: signed.storage_path,
        file_name: fileName,
        mime_type: mimeType,
        size: bytes.length,
        ...(title?.trim() ? { title: title.trim() } : {}),
      });
      return `Added image "${item.title}" [${item.id}] to ${index.pathOf(group.id)}.`;
    },
  });
}
