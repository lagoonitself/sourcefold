import { safeName } from "./file-name";

// Images inside a saved post (docs/FILE-FORMAT.md, "Post images"): the Markdown links to them on
// the web, and a copy of each file sits in `<file name>_files/` next to the post's file.

const IMAGE_LINK = /!\[(?:[^\]\\]|\\.)*\]\((https?:\/\/[^\s)]+)\)/g;
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "mp4"]);

/** The web image links in a Markdown body, each once, in order. */
export function markdownImageUrls(markdown: string): string[] {
  const urls = new Set<string>();
  for (const match of markdown.matchAll(IMAGE_LINK)) urls.add(match[1]!);
  return [...urls];
}

/** The folder holding a post's images, next to its file: `Title.md` → `Title_files`. */
export function postImagesFolderName(fileName: string): string {
  return `${fileName.replace(/\.md$/i, "")}_files`;
}

function lastSegment(path: string): string {
  const parts = path.split("/").filter(Boolean);
  let segment = parts[parts.length - 1] ?? "";
  try {
    segment = decodeURIComponent(segment);
  } catch {
    // keep it as it is
  }
  return segment;
}

// Substack's CDN wraps the original: /image/fetch/<options>/https%3A%2F%2F…/name.jpeg
function originalName(url: URL): string {
  const segment = lastSegment(url.pathname);
  if (/^https?:\/\//i.test(segment)) {
    try {
      return lastSegment(new URL(segment).pathname);
    } catch {
      return segment;
    }
  }
  return segment;
}

/**
 * File names for a post's images, in the order of `urls`: the name the image has on the web,
 * made safe, with ` (2)` on clashes. Images with no usable name are `image-<n>`.
 */
export function postImageFileNames(urls: string[]): string[] {
  const used = new Set<string>();
  return urls.map((raw, index) => {
    let name = "";
    try {
      name = originalName(new URL(raw));
    } catch {
      name = "";
    }
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
    const knownExt = IMAGE_EXTENSIONS.has(ext);
    let base = safeName(knownExt ? name.slice(0, dot) : name);
    if (!name || base === "Untitled") base = `image-${index + 1}`;
    const extension = knownExt ? ext : "jpg";

    let candidate = `${base}.${extension}`;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) {
      candidate = `${base} (${n}).${extension}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
