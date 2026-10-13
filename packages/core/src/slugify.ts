export function slugify(title: string, maxLength = 80): string {
  const normalized = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    return "untitled";
  }

  const truncated = normalized.slice(0, maxLength).replace(/-+$/, "");

  return truncated || "untitled";
}
