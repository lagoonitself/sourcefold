import type { XMedia } from "../capture-types";
import type { SourceFetch } from "../source-fetch";

const PHOTO_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const PHOTO_PATH_REGEX = /^\/media\/([A-Za-z0-9_-]{1,100})(?:\.([A-Za-z0-9_-]+))?$/;
const GIF_PATH_REGEX = /^\/tweet_video\/([A-Za-z0-9_-]{1,100})\.mp4$/;

function normalizeAlt(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const chars = Array.from(trimmed);
  if (chars.length > 1000) {
    return chars.slice(0, 1000).join("");
  }
  return trimmed;
}

/**
 * Normalizes an untrusted array of media descriptors from X. Drops elements that fail validation,
 * never throws, and caps the result at 10 items.
 */
export function normalizeXMedia(raw: unknown): XMedia[] {
  if (!Array.isArray(raw)) return [];

  const result: XMedia[] = [];

  for (const item of raw) {
    if (result.length >= 10) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;

    const type = (item as { type?: unknown }).type;

    if (type === "photo") {
      const rawUrl = (item as { url?: unknown }).url;
      if (typeof rawUrl !== "string") continue;
      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        continue;
      }
      if (parsed.protocol !== "https:") continue;
      if (parsed.hostname !== "pbs.twimg.com" || parsed.port !== "") continue;

      const match = PHOTO_PATH_REGEX.exec(parsed.pathname);
      if (!match) continue;

      const id = match[1];
      let ext: string;
      if (match[2] !== undefined) {
        const pathExt = match[2].toLowerCase();
        if (!PHOTO_EXTENSIONS.has(pathExt)) continue;
        ext = pathExt;
      } else {
        const formatParam = parsed.searchParams.get("format")?.toLowerCase();
        ext = formatParam && PHOTO_EXTENSIONS.has(formatParam) ? formatParam : "jpg";
      }

      const alt = normalizeAlt((item as { alt?: unknown }).alt);
      result.push({
        type: "photo",
        url: `https://pbs.twimg.com/media/${id}.${ext}?name=orig`,
        alt,
      });
    } else if (type === "gif") {
      const rawUrl = (item as { url?: unknown }).url;
      if (typeof rawUrl !== "string") continue;
      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        continue;
      }
      if (parsed.protocol !== "https:") continue;
      if (parsed.hostname !== "video.twimg.com" || parsed.port !== "") continue;

      const match = GIF_PATH_REGEX.exec(parsed.pathname);
      if (!match) continue;

      const id = match[1];
      const alt = normalizeAlt((item as { alt?: unknown }).alt);
      result.push({
        type: "gif",
        url: `https://video.twimg.com/tweet_video/${id}.mp4`,
        alt,
      });
    } else if (type === "video") {
      const rawDuration = (item as { durationSeconds?: unknown }).durationSeconds;
      let durationSeconds: number | null = null;
      if (
        typeof rawDuration === "number" &&
        Number.isFinite(rawDuration) &&
        rawDuration >= 0 &&
        rawDuration <= 86400
      ) {
        durationSeconds = rawDuration;
      }
      result.push({ type: "video", durationSeconds });
    }
  }

  return result;
}

/**
 * Formats a single media item as a Markdown line.
 */
export function formatXMediaLine(media: XMedia, postUrl: string): string {
  if (media.type === "photo" || media.type === "gif") {
    const fallback = media.type === "photo" ? "Image" : "GIF";
    let formattedAlt = fallback;
    if (typeof media.alt === "string") {
      const collapsed = media.alt.replace(/\s+/g, " ").trim();
      if (collapsed) {
        const truncated = Array.from(collapsed).slice(0, 300).join("");
        formattedAlt = truncated.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
      }
    }
    return `![${formattedAlt}](${media.url})`;
  }

  if (
    media.durationSeconds == null ||
    !Number.isFinite(media.durationSeconds) ||
    media.durationSeconds < 0
  ) {
    return `[Video on X](${postUrl})`;
  }

  const total = Math.round(media.durationSeconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const duration =
    h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;

  return `[Video (${duration}) on X](${postUrl})`;
}

/**
 * Fetches media information for an X post by status ID. Tries syndication first, falling back to
 * FxTwitter. Returns null if both sources are unusable or the ID is invalid.
 */
export async function fetchXPostMedia(
  fetch: SourceFetch,
  statusId: string,
  signal?: AbortSignal,
): Promise<XMedia[] | null> {
  if (!/^\d{1,25}$/.test(statusId)) {
    return null;
  }

  // 1. Syndication
  try {
    const token = ((Number(statusId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
    const syndicationUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${statusId}&lang=en&token=${token}`;
    const res = await fetch({ url: syndicationUrl, signal });
    if (res.status === 200) {
      const data = JSON.parse(res.text);
      if (data && typeof data === "object" && data.__typename === "Tweet") {
        const details = Array.isArray(data.mediaDetails) ? data.mediaDetails : [];
        const rawMedia: unknown[] = [];
        for (const item of details) {
          if (!item || typeof item !== "object") continue;
          if (item.type === "photo") {
            const rawUrl = typeof item.media_url_https === "string" ? item.media_url_https : "";
            rawMedia.push({
              type: "photo",
              url: rawUrl,
              alt: item.ext_alt_text ?? null,
            });
          } else if (item.type === "animated_gif") {
            const variants =
              item.video_info && Array.isArray(item.video_info.variants)
                ? item.video_info.variants
                : [];
            const mp4Variant = variants.find(
              (v: unknown) =>
                v &&
                typeof v === "object" &&
                (v as { content_type?: unknown }).content_type === "video/mp4",
            );
            const rawUrl = mp4Variant && typeof mp4Variant.url === "string" ? mp4Variant.url : "";
            rawMedia.push({
              type: "gif",
              url: rawUrl,
              alt: item.ext_alt_text ?? null,
            });
          } else if (item.type === "video") {
            const durationMillis = item.video_info?.duration_millis;
            const durationSeconds =
              typeof durationMillis === "number" ? durationMillis / 1000 : null;
            rawMedia.push({
              type: "video",
              durationSeconds,
            });
          }
        }
        return normalizeXMedia(rawMedia);
      }
    }
  } catch {
    // Fallback to FxTwitter below
  }

  // 2. FxTwitter fallback
  try {
    const fxUrl = `https://api.fxtwitter.com/2/status/${statusId}`;
    const res = await fetch({ url: fxUrl, signal });
    if (res.status === 200) {
      const data = JSON.parse(res.text);
      if (data && typeof data === "object" && data.status != null) {
        const mediaAll =
          data.status.media && Array.isArray(data.status.media.all) ? data.status.media.all : [];
        const rawMedia: unknown[] = [];
        for (const item of mediaAll) {
          if (!item || typeof item !== "object") continue;
          if (item.type === "photo") {
            rawMedia.push({
              type: "photo",
              url: item.url,
              alt: item.altText ?? null,
            });
          } else if (item.type === "gif") {
            rawMedia.push({
              type: "gif",
              url: item.url,
              alt: item.altText ?? null,
            });
          } else if (item.type === "video") {
            const duration = typeof item.duration === "number" ? item.duration : null;
            rawMedia.push({
              type: "video",
              durationSeconds: duration,
            });
          }
        }
        return normalizeXMedia(rawMedia);
      }
    }
  } catch {
    // Both failed
  }

  return null;
}
