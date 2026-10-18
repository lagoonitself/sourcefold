// Plain-sentence errors for the people using the app (docs/dev/DESIGN.md, "Writing").

export const DOWNLOAD_ERROR = "Couldn't download the model. Check your connection and try again.";
export const START_ERROR = "Couldn't run search by meaning. It will try again in a minute.";

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

/** Turns a load or run failure into a sentence that says what happened and what to do. */
export function describeEmbeddingError(error: unknown): string {
  const text = messageOf(error);
  if (
    /failed to fetch|networkerror|load failed|network request failed|could not locate|err_internet|offline|\b40[0-9]\b|\b50[0-9]\b/i.test(
      text,
    )
  ) {
    return DOWNLOAD_ERROR;
  }
  if (/quota|storage/i.test(text)) {
    return "Couldn't save the model on this computer. Free some disk space and try again.";
  }
  return START_ERROR;
}
