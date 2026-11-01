import { SourceError } from "@sourcefold/core";
import { WikipediaError } from "@sourcefold/core/capture";
import { describe, expect, it } from "vitest";
import { isCloudRefusal } from "../links/save-link";
import { ApiError } from "../web-api";

describe("isCloudRefusal", () => {
  it("queues refusals, server errors and requests that got no answer", () => {
    expect(isCloudRefusal(new SourceError("blocked", "The site refused."))).toBe(true);
    expect(
      isCloudRefusal(
        new SourceError(
          "fetch_failed",
          "The site answered with an error (HTTP 503). It may be down.",
        ),
      ),
    ).toBe(true);
    expect(isCloudRefusal(new SourceError("fetch_failed", "Couldn't reach that page."))).toBe(true);
    expect(isCloudRefusal(new WikipediaError("fetch_failed"))).toBe(true);
    expect(isCloudRefusal(new ApiError(429, "Too many requests."))).toBe(true);
  });

  it("reports the page's own answer as failed instead of queuing it", () => {
    expect(
      isCloudRefusal(
        new SourceError("fetch_failed", "The site answered HTTP 400 instead of the page."),
      ),
    ).toBe(false);
    expect(isCloudRefusal(new SourceError("not_found", "That page doesn't exist anymore."))).toBe(
      false,
    );
    expect(isCloudRefusal(new WikipediaError("not_found"))).toBe(false);
    expect(isCloudRefusal(new ApiError(404, "Not found."))).toBe(false);
  });
});
