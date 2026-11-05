// Optional addresses baked in by the build. Empty settings count as not set.

function address(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : undefined;
}

/** The Content Worker (source text in R2). Undefined: text stays in Google Drive as before. */
export const CONTENT_URL: string | undefined = address(
  import.meta.env?.VITE_SOURCEFOLD_CONTENT_URL,
);

/** The website, for invite links. Undefined: the dialog shows only the code. */
export const WEB_URL: string | undefined = address(import.meta.env?.VITE_SOURCEFOLD_WEB_URL);
