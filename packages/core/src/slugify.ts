export function slugify(title: string, maxLength = 80): string {
  const normalized = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    return "untitled";
  }

  const truncated = Array.from(normalized).slice(0, maxLength).join("").replace(/-+$/, "");

  return truncated || "untitled";
}
