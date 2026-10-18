import { describe, expect, it } from "vitest";
import { DOWNLOAD_ERROR, START_ERROR, describeEmbeddingError } from "../errors";

describe("describeEmbeddingError", () => {
  it("says to check the connection when the download fails", () => {
    expect(describeEmbeddingError(new TypeError("Failed to fetch"))).toBe(DOWNLOAD_ERROR);
    expect(describeEmbeddingError(new Error("Could not locate file: config.json"))).toBe(
      DOWNLOAD_ERROR,
    );
  });

  it("falls back to a plain sentence for anything else", () => {
    expect(describeEmbeddingError(new Error("kernel exploded"))).toBe(START_ERROR);
    expect(describeEmbeddingError(undefined)).toBe(START_ERROR);
  });
});
