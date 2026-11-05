import { describe, expect, it } from "vitest";
import { claudeBundleOutdated } from "../claude-bundle-version";

describe("claudeBundleOutdated", () => {
  it("offers an update only when Claude has an older bundle than the app ships", () => {
    expect(claudeBundleOutdated("0.6.0", "0.5.0")).toBe(true);
    expect(claudeBundleOutdated("0.6.0", "0.6.0")).toBe(false);
  });

  it("never nags people who didn't add Sourcefold to Claude, or when the version is unknown", () => {
    expect(claudeBundleOutdated("0.6.0", null)).toBe(false);
    expect(claudeBundleOutdated(null, "0.5.0")).toBe(false);
  });
});
