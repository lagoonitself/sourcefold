import { describe, expect, it } from "vitest";
import { shelfAddSchema, shelfPatchSchema } from "./index";

describe("shelf request checks", () => {
  it("reads one link or a list, normalizing URL, note and tags", () => {
    const one = shelfAddSchema.parse({
      url: "vercel.com/",
      note: " deploys \r\n",
      tags: ["#Dev", "dev"],
    });
    expect(one.links).toHaveLength(1);
    expect(one.links[0]!.url).toEqual({ url: "https://vercel.com/", key: "vercel.com" });
    expect(one.links[0]!.note).toBe("deploys");
    expect(one.links[0]!.tags).toEqual(["Dev"]);

    const many = shelfAddSchema.parse({ links: [{ url: "a.com" }, { url: "b.org" }] });
    expect(many.links.map((l) => l.url.key)).toEqual(["a.com", "b.org"]);
  });

  it("refuses what isn't a web address, and empty batches", () => {
    expect(shelfAddSchema.safeParse({ url: "hello" }).success).toBe(false);
    expect(shelfAddSchema.safeParse({ links: [] }).success).toBe(false);
    expect(shelfAddSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
  });

  it("allows only known fields in a patch", () => {
    expect(shelfPatchSchema.parse({ pinned: true })).toEqual({ pinned: true });
    expect(shelfPatchSchema.safeParse({ open_count: 9 }).success).toBe(false);
    expect(shelfPatchSchema.safeParse({ note: "x".repeat(8001) }).success).toBe(false);
  });
});
