import { beforeEach, describe, expect, it } from "vitest";
import { readerTextOf } from "../reader-text";
import { clearRemoveUndo, registerRemoveTextTools, removalHash } from "../tools/remove-text";
import type { Folder, Highlight } from "../types";
import { connect, fakeDesktop, fakeWeb } from "./harness";

const BODY = `A **turbocharger** uses exhaust gas to spin a turbine.[^1] The delay before boost builds is called *turbo lag*.

## History

Early designs appeared in the 1900s.[^2]

Sponsored: buy our turbo kit today!

## Sponsors

This video is brought to you by Acme.

Use code TURBO for 10% off.

[^1]: [How turbos work](https://example.com/turbo) - example.com
[^2]: <https://example.com/history> - example.com`;

const folders: Folder[] = [
  { id: "p1", parent_id: null, name: "Cars", position: 0 },
  { id: "g1", parent_id: "p1", name: "Engines", position: 0 },
  { id: "p9", parent_id: null, name: "AI research", position: 1 },
];

function fileOf(body: string): string {
  return `---\nsource: grokipedia\nurl: "https://grokipedia.com/page/Turbocharger"\n---\n\n# Turbocharger\n\n> Saved from [Grokipedia](https://grokipedia.com/page/Turbocharger) on 2026-10-18\n\n${body}\n`;
}

function highlight(id: string, quote: string, body = BODY): Highlight {
  const text = readerTextOf(fileOf(body)).text;
  const start = text.indexOf(quote);
  return {
    id,
    item_id: "s1",
    kind: "text",
    quote,
    prefix: text.slice(Math.max(0, start - 32), start),
    suffix: text.slice(start + quote.length, start + quote.length + 32),
    start_offset: start,
    end_offset: start + quote.length,
    image_src: null,
    note: null,
    seconds: null,
    cited: [],
    created_at: "2026-10-18T00:00:00Z",
    updated_at: "2026-10-18T00:00:00Z",
  };
}

function library(kind = "grokipedia", highlights: Highlight[] = []) {
  const state = { body: BODY, highlights: [...highlights] };
  const web = fakeWeb({
    "GET /folders": () => ({ json: { data: folders } }),
    "GET /items/*": ({ path }) => ({
      json: { data: { id: path.split("/")[2], kind, title: "Turbocharger", folder_id: "g1" } },
    }),
    "GET /items/*/content": () => ({ text: fileOf(state.body) }),
    "PATCH /items/*": ({ body }) => {
      state.body = (body as { markdown: string }).markdown;
      return { json: { data: { id: "s1" } } };
    },
    "GET /highlights": () => ({ json: { data: state.highlights } }),
    "DELETE /highlights/*": ({ path }) => {
      state.highlights = state.highlights.filter((h) => h.id !== path.split("/")[2]);
      return { json: { data: null } };
    },
    "PUT /highlights/*": ({ body }) => {
      state.highlights.push(body as Highlight);
      return { json: { data: body } };
    },
  });
  return { state, web };
}

beforeEach(() => clearRemoveUndo());

describe("remove_text", () => {
  it("cuts a quoted paragraph and saves the body with PATCH markdown", async () => {
    const { state, web } = library();
    const desktop = fakeDesktop();
    const h = await connect(registerRemoveTextTools, { web, desktop });
    const { text, isError } = await h.call("remove_text", {
      source_id: "s1",
      quote: "Sponsored: buy our turbo kit today!",
    });
    expect(isError).toBe(false);
    expect(text).toContain(
      'Removed "Sponsored: buy our turbo kit today!" from "Turbocharger" [s1].',
    );
    expect(state.body).not.toContain("Sponsored");
    expect(state.body).toContain("Early designs appeared in the 1900s.[^2]\n\n## Sponsors");
    // Only the body is sent: no front matter, title, or source line.
    expect(state.body.startsWith("A **turbocharger**")).toBe(true);
    expect(desktop.changed).toHaveBeenCalled();
  });

  it("cuts part of a paragraph without leaving stray markup", async () => {
    const { state, web } = library();
    const h = await connect(registerRemoveTextTools, { web });
    const { isError } = await h.call("remove_text", {
      source_id: "s1",
      quote: "The delay before boost builds is called *turbo lag*.",
    });
    expect(isError).toBe(false);
    expect(state.body.split("\n")[0]).toBe(
      "A **turbocharger** uses exhaust gas to spin a turbine.[^1]",
    );
    expect(state.body).not.toContain("turbo lag");
  });

  it("removes a whole section by its outline number", async () => {
    const { state, web } = library();
    const h = await connect(registerRemoveTextTools, { web });
    const { text, isError } = await h.call("remove_text", { source_id: "s1", section: 2 });
    expect(isError).toBe(false);
    expect(text).toContain('the section "Sponsors"');
    expect(state.body).not.toContain("Sponsors");
    expect(state.body).not.toContain("Acme");
    expect(state.body).not.toContain("TURBO for");
    expect(state.body).toContain("## History");
    // The footnote definitions after the section stay.
    expect(state.body).toContain("[^1]: [How turbos work]");
    const refs = `${BODY}\n\n## References\n\n[^9]: A long footnote that belongs to the section.\n`;
    const refLib = library();
    refLib.state.body = refs;
    const refTool = await connect(registerRemoveTextTools, { web: refLib.web });
    const removedRefs = await refTool.call("remove_text", { source_id: "s1", section: 3 });
    expect(removedRefs.isError).toBe(false);
    expect(removedRefs.text).toContain('the section "References"');
    expect(refLib.state.body).not.toContain("## References");
    expect(refLib.state.body).not.toContain("[^9]:");
    expect(refLib.state.body).toContain("## Sponsors");

    const outside = await h.call("remove_text", { source_id: "s1", section: 5 });
    expect(outside.isError).toBe(true);
    expect(outside.text).toContain("§5 isn't one");
  });

  it("deletes highlights in the removed text and undo brings both back", async () => {
    const gone = highlight("h-gone", "Acme");
    const kept = highlight("h-kept", "exhaust gas");
    const { state, web } = library("youtube", [gone, kept]);
    const h = await connect(registerRemoveTextTools, { web });
    const removed = await h.call("remove_text", { source_id: "s1", section: 2 });
    expect(removed.text).toContain('1 highlight in that text went with it: "Acme".');
    expect(state.highlights.map((x) => x.id)).toEqual(["h-kept"]);

    const undo = await h.call("undo_remove_text", { source_id: "s1" });
    expect(undo.isError).toBe(false);
    expect(undo.text).toContain("Restored 1 highlight too.");
    expect(state.body).toBe(BODY);
    expect(state.highlights.map((x) => x.id).sort()).toEqual(["h-gone", "h-kept"]);
    const put = web.bodies[web.calls.indexOf("PUT /highlights/h-gone")] as Record<string, unknown>;
    expect(put).not.toHaveProperty("created_at");

    const again = await h.call("undo_remove_text", { source_id: "s1" });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("no removal to undo");
  });

  it("won't undo over text that changed since", async () => {
    const { state, web } = library();
    const h = await connect(registerRemoveTextTools, { web });
    await h.call("remove_text", { source_id: "s1", quote: "Use code TURBO for 10% off." });
    state.body = "Edited in the app.";
    const undo = await h.call("undo_remove_text", { source_id: "s1" });
    expect(undo.isError).toBe(true);
    expect(undo.text).toContain("changed since that removal");
    expect(state.body).toBe("Edited in the app.");
  });

  it("refuses notes, images, X threads, missing quotes and other projects", async () => {
    for (const [kind, message] of [
      ["note", "edit_note"],
      ["image", "image has no text"],
      ["x", "X thread"],
    ]) {
      const h = await connect(registerRemoveTextTools, { web: library(kind).web });
      const r = await h.call("remove_text", { source_id: "s1", quote: "Acme" });
      expect(r.isError).toBe(true);
      expect(r.text).toContain(message);
    }

    const { state, web } = library();
    const h = await connect(registerRemoveTextTools, { web });
    const missing = await h.call("remove_text", { source_id: "s1", quote: "superchargers" });
    expect(missing.text).toContain("isn't in");
    const both = await h.call("remove_text", { source_id: "s1", quote: "Acme", section: 1 });
    expect(both.text).toContain("exactly one of quote or section");
    const guarded = await h.call("remove_text", {
      source_id: "s1",
      quote: "Acme",
      project: "AI research",
    });
    expect(guarded.isError).toBe(true);
    expect(guarded.text).toContain('outside the project "AI research"');
    expect(state.body).toBe(BODY);
    expect(web.calls.some((c) => c.startsWith("PATCH"))).toBe(false);
  });

  it("keeps the removed text on the server so undo works in the web connector", async () => {
    const { state, web } = library();
    const undos: Array<{ before: string; after_hash: string; lost: unknown[] }> = [];
    const inner = web.fetch;
    web.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.pathname.endsWith("/text-undos")) {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "POST") {
          undos.push(JSON.parse(String(init?.body)) as (typeof undos)[number]);
          return new Response(JSON.stringify({ data: { id: "u1" } }), { status: 200 });
        }
        if (method === "GET") {
          const last = undos[undos.length - 1];
          return new Response(JSON.stringify({ data: last ?? null }), { status: 200 });
        }
        undos.pop();
        return new Response(JSON.stringify({ data: { id: "u1" } }), { status: 200 });
      }
      return inner(input, init);
    }) as typeof fetch;

    const h = await connect(registerRemoveTextTools, { web, mode: "remote" });
    const removed = await h.call("remove_text", { source_id: "s1", section: 2 });
    expect(removed.isError).toBe(false);
    expect(removed.text).toContain("undo_remove_text");
    expect(undos).toHaveLength(1);
    expect(undos[0]?.after_hash).toBe(removalHash(state.body));

    const undo = await h.call("undo_remove_text", { source_id: "s1" });
    expect(undo.isError).toBe(false);
    expect(undo.text).toContain("Put the removed text back");
    expect(state.body).toBe(BODY);
    expect(undos).toHaveLength(0);
  });
});
