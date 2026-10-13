export function toSafeFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  const lastDot = lower.lastIndexOf(".");
  let base: string;
  let ext: string;

  if (lastDot >= 0) {
    base = lower.slice(0, lastDot);
    ext = lower.slice(lastDot);
  } else {
    base = lower;
    ext = "";
  }

  // safe name: lowercase, keep [a-z0-9._-], collapse others to -, max 100 chars, keep extension
  let safeBase = base.replace(/[^a-z0-9._-]+/g, "-");
  const safeExt = ext.replace(/[^a-z0-9._-]+/g, "-");

  if (!safeBase) {
    safeBase = "image";
  }

  if (safeExt.length >= 100) {
    return safeExt.slice(0, 100);
  }

  const maxBaseLen = 100 - safeExt.length;
  if (safeBase.length > maxBaseLen) {
    safeBase = safeBase.slice(0, maxBaseLen);
  }

  return safeBase + safeExt;
}
