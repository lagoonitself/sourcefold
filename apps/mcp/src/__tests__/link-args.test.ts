import { describe, expect, it } from "vitest";
import { LOCAL_ADDRESS_MESSAGE, readLinkArgs, refuseLocalAddresses } from "../links/link-args";

// QA 2026-11-05: 7 links in, 5 accounted for; local-network links were queued for the desktop.
describe("readLinkArgs", () => {
  it("accounts for every entry", () => {
    const { urls, skipped } = readLinkArgs([
      "https://example.com/a",
      "https://example.com/a?utm_source=x",
      "not a url",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "see https://example.com/b, and https://example.com/c.",
    ]);
    expect(urls).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
    ]);
    expect(skipped.map((s) => s.input)).toEqual([
      "https://example.com/a?utm_source=x",
      "not a url",
      "file:///etc/passwd",
      "javascript:alert(1",
    ]);
    expect(skipped[0]!.message).toContain("same link as https://example.com/a");
    expect(skipped[1]!.message).toContain("Not a link");
    expect(skipped[2]!.message).toContain("not file: links");
  });

  it("says a link given twice was saved once", () => {
    const { urls, skipped } = readLinkArgs(["https://example.com/a", "https://example.com/a"]);
    expect(urls).toEqual(["https://example.com/a"]);
    expect(skipped[0]!.message).toBe("Given twice in this call; saved once.");
  });
});

describe("refuseLocalAddresses", () => {
  const lookup = async (host: string) =>
    host === "router.example.com" ? [{ address: "192.168.1.1" }] : [{ address: "93.184.216.34" }];

  it("refuses this computer and the local network, by address and by name", async () => {
    const { urls, skipped } = await refuseLocalAddresses(
      [
        "http://localhost:3000/",
        "http://192.168.1.1/",
        "http://10.0.0.1/admin",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "http://router.example.com/",
        "https://example.com/ok",
      ],
      lookup,
    );
    expect(urls).toEqual(["https://example.com/ok"]);
    expect(skipped).toHaveLength(6);
    expect(skipped.every((s) => s.message === LOCAL_ADDRESS_MESSAGE)).toBe(true);
  });

  it("keeps a link whose name can't be looked up", async () => {
    const { urls } = await refuseLocalAddresses(["https://nowhere.example/"], async () => {
      throw new Error("ENOTFOUND");
    });
    expect(urls).toEqual(["https://nowhere.example/"]);
  });
});
