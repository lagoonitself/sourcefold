import { describe, expect, it } from "vitest";
import { registerResearchTools } from "../tools/research";
import { registerLibraryTools } from "../tools/library";
import { registerReadTools, clearReadCache } from "../tools/read";
import { registerAddTools } from "../tools/add";
import type { Card, CardInput, Folder, Item, OutlineSection, OutlineSectionInput } from "../types";
import { connect, fakeWeb } from "./harness";

const folders: Array<Folder & { archived?: boolean }> = [
  { id: "p1", parent_id: null, name: "AI Research", position: 0, item_count: 3, archived: false },
  { id: "g1", parent_id: "p1", name: "Compute", position: 0, item_count: 2 },
  { id: "g2", parent_id: "p1", name: "Algorithms", position: 1, item_count: 1 },
  { id: "p2", parent_id: null, name: "Other Project", position: 1, item_count: 1, archived: false },
  { id: "g3", parent_id: "p2", name: "Misc", position: 0, item_count: 1 },
];

function makeItem(id: string, folderId: string, extra: Partial<Item> = {}): Item {
  return {
    id,
    folder_id: folderId,
    kind: "web",
    title: `Item ${id}`,
    source_url: `https://example.com/${id}`,
    status: "saved",
    meta: null,
    created_at: "2026-10-19T10:00:00Z",
    ...extra,
  };
}

describe("set_source_info", () => {
  it("updates status, tags, author, author_type, and summary on a single source", async () => {
    const item = makeItem("i1", "g1");
    let patchReceived: Record<string, unknown> | null = null;

    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "GET /items/*": () => ({ json: { data: item } }),
      "PATCH /items/*": ({ body }) => {
        patchReceived = body as Record<string, unknown>;
        return { json: { data: { ...item, ...patchReceived } } };
      },
    });

    const h = await connect(registerResearchTools, { web: fake });
    const { text, isError } = await h.call("set_source_info", {
      source_id: "i1",
      status: "keep",
      tags: ["Compute", "Scale"],
      author: "Epoch AI",
      author_type: "lab",
      summary: "Analysis of compute trends through 2030.",
    });

    expect(isError).toBe(false);
    expect(text).toContain("Updated 1 source:");
    expect(text).toContain("status: Keep");
    expect(text).toContain("tags: Compute, Scale");
    expect(patchReceived).toEqual({
      triage: "keep",
      tags: ["Compute", "Scale"],
      author: "Epoch AI",
      author_type: "lab",
      summary: "Analysis of compute trends through 2030.",
    });
  });

  it("supports add_tags, remove_tags, and clearing status with none", async () => {
    const item = makeItem("i1", "g1", { triage: "keep", tags: ["OldTag", "KeepTag"] });
    let patchReceived: Record<string, unknown> | null = null;

    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "GET /items/*": () => ({ json: { data: item } }),
      "PATCH /items/*": ({ body }) => {
        patchReceived = body as Record<string, unknown>;
        return { json: { data: { ...item, ...patchReceived } } };
      },
    });

    const h = await connect(registerResearchTools, { web: fake });
    const { text, isError } = await h.call("set_source_info", {
      source_id: "i1",
      status: "none",
      remove_tags: ["OldTag"],
      add_tags: ["NewTag"],
    });

    expect(isError).toBe(false);
    expect(text).toContain("status: none");
    expect(text).toContain("tags: KeepTag, NewTag");
    expect(patchReceived).toEqual({
      triage: null,
      tags: ["KeepTag", "NewTag"],
    });
  });

  it("refuses summary or author on multiple sources at once", async () => {
    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
    });

    const h = await connect(registerResearchTools, { web: fake });
    const { text, isError } = await h.call("set_source_info", {
      source_ids: ["i1", "i2"],
      summary: "Bulk summary not allowed",
    });

    expect(isError).toBe(true);
    expect(text).toContain("A summary or author on several sources at once is refused.");
  });

  it("enforces project guard when source is outside the project", async () => {
    const item = makeItem("i1", "g3"); // g3 is in p2 ("Other Project")
    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "GET /items/*": () => ({ json: { data: item } }),
    });

    const h = await connect(registerResearchTools, { web: fake });
    const { text, isError } = await h.call("set_source_info", {
      source_id: "i1",
      status: "keep",
      project: "AI Research", // p1
    });

    expect(isError).toBe(true);
    expect(text).toContain("is in Other Project");
  });
});

describe("list_tags", () => {
  it("lists outline sections first, then other tags with source counts", async () => {
    const sections: OutlineSection[] = [
      {
        id: "s1",
        project_id: "p1",
        title: "Introduction",
        position: 10,
        created_at: "",
        updated_at: "",
      },
      {
        id: "s2",
        project_id: "p1",
        title: "Compute",
        position: 20,
        created_at: "",
        updated_at: "",
      },
    ];
    const items: Item[] = [
      makeItem("i1", "g1", { tags: ["Introduction", "Compute", "Hardware"] }),
      makeItem("i2", "g1", { tags: ["Compute", "Hardware", "Cooling"] }),
      makeItem("i3", "g2", { tags: ["Algorithms"] }),
    ];

    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "GET /outline-sections": () => ({ json: { data: sections } }),
      "GET /items": () => ({ json: { data: items } }),
    });

    const h = await connect(registerResearchTools, { web: fake });
    const { text, isError } = await h.call("list_tags", { project: "AI Research" });

    expect(isError).toBe(false);
    expect(text).toContain('Project "AI Research" tags:');
    expect(text).toContain("Outline sections:");
    expect(text).toContain("- § Introduction · 1 source");
    expect(text).toContain("- § Compute · 2 sources");
    expect(text).toContain("Other tags:");
    expect(text).toContain("- Hardware · 2 sources");
    expect(text).toContain("- Algorithms · 1 source");
    expect(text).toContain("- Cooling · 1 source");
  });
});

describe("find_duplicates", () => {
  it("finds duplicate sets by url and formats reason, ids, paths, and dates", async () => {
    const items: Item[] = [
      makeItem("i1", "g1", {
        title: "Scaling Report",
        source_url: "https://example.com/scaling",
        created_at: "2026-10-15T00:00:00Z",
      }),
      makeItem("i2", "g2", {
        title: "Scaling Report Copy",
        source_url: "https://example.com/scaling",
        created_at: "2026-10-16T00:00:00Z",
      }),
    ];

    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "GET /items": () => ({ json: { data: items } }),
    });

    const h = await connect(registerResearchTools, { web: fake });
    const { text, isError } = await h.call("find_duplicates", { project: "AI Research" });

    expect(isError).toBe(false);
    expect(text).toContain('Found 1 duplicate group in "AI Research":');
    expect(text).toContain("Duplicate group 1 (Same link):");
    expect(text).toContain("[i1] · Scaling Report · in AI Research › Compute · 2026-10-15");
    expect(text).toContain("[i2] · Scaling Report Copy · in AI Research › Algorithms · 2026-10-16");
  });

  it("reports when no duplicates exist", async () => {
    const items: Item[] = [
      makeItem("i1", "g1", { title: "Item 1", source_url: "https://example.com/1" }),
      makeItem("i2", "g2", { title: "Item 2", source_url: "https://example.com/2" }),
    ];

    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "GET /items": () => ({ json: { data: items } }),
    });

    const h = await connect(registerResearchTools, { web: fake });
    const { text, isError } = await h.call("find_duplicates", { project: "AI Research" });

    expect(isError).toBe(false);
    expect(text).toContain('No duplicate sources found in "AI Research".');
  });
});

describe("merge_duplicates", () => {
  it("calls merge endpoint, reports moved highlights and cards, and invalidates cache", async () => {
    const keep = makeItem("i1", "g1", { title: "Original Keep" });
    const dup = makeItem("i2", "g2", { title: "Duplicate Copy" });
    let mergeBody: unknown = null;

    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "GET /items/*": ({ path }) => {
        if (path.endsWith("/i1")) return { json: { data: keep } };
        if (path.endsWith("/i2")) return { json: { data: dup } };
        return { status: 404 };
      },
      "POST /items/*/merge": ({ body }) => {
        mergeBody = body;
        return { json: { data: { moved_highlights: 2, moved_cards: 1 } } };
      },
    });

    const h = await connect(registerResearchTools, { web: fake });
    const { text, isError } = await h.call("merge_duplicates", {
      keep_id: "i1",
      ids: ["i2"],
      project: "AI Research",
    });

    expect(isError).toBe(false);
    expect(text).toContain(
      'Merged 1 duplicate into "Original Keep" [i1] (moved 2 highlights and 1 card).',
    );
    expect(mergeBody).toEqual({ ids: ["i2"] });
  });
});

describe("make_card", () => {
  it("creates quote card from source and quote validating reader text", async () => {
    const item = makeItem("i1", "g1", { title: "AI Scaling Paper" });
    const markdownContent = [
      "---",
      "source: web",
      "title: AI Scaling Paper",
      "url: https://example.com/i1",
      "folder: AI Research/Compute",
      "---",
      "",
      "# AI Scaling Paper",
      "",
      "Training runs of 2e29 FLOP are feasible by 2030; power is the binding constraint.",
    ].join("\n");

    let putCardBody: CardInput | null = null;

    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "GET /items/*": () => ({ json: { data: item } }),
      "GET /items/*/content": () => ({ text: markdownContent }),
      "GET /outline-sections": () => ({
        json: {
          data: [
            {
              id: "sec1",
              project_id: "p1",
              title: "Compute Limits",
              position: 10,
              created_at: "",
              updated_at: "",
            },
          ],
        },
      }),
      "GET /cards": () => ({ json: { data: [] } }),
      "PUT /cards/*": ({ body }) => {
        putCardBody = body as CardInput;
        return { json: { data: { ...putCardBody, created_at: "", updated_at: "" } } };
      },
    });

    const h = await connect(registerResearchTools, { web: fake });
    const { text, isError } = await h.call("make_card", {
      source_id: "i1",
      quote: "power is the binding constraint.",
      section: "Compute Limits",
      project: "AI Research",
    });

    expect(isError).toBe(false);
    expect(text).toContain("Created quote card");
    expect(text).toContain('placed in section "Compute Limits"');
    expect(text).toContain("“power is the binding constraint.”");
    expect(putCardBody).toMatchObject({
      kind: "quote",
      project_id: "p1",
      item_id: "i1",
      quote: "power is the binding constraint.",
      section_id: "sec1",
    });
  });

  it("rejects quote that does not appear in the source", async () => {
    const item = makeItem("i1", "g1", { title: "AI Scaling Paper" });
    const markdownContent = "# Title\n\nSome unrelated text.";

    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "GET /items/*": () => ({ json: { data: item } }),
      "GET /items/*/content": () => ({ text: markdownContent }),
    });

    const h = await connect(registerResearchTools, { web: fake });
    const { text, isError } = await h.call("make_card", {
      source_id: "i1",
      quote: "completely absent quote",
      project: "AI Research",
    });

    expect(isError).toBe(true);
    expect(text).toContain('That quote isn\'t in "AI Scaling Paper"');
  });

  it("creates quote card from existing highlight_id", async () => {
    const item = makeItem("i1", "g1", { title: "AI Scaling Paper" });
    const highlight = {
      id: "h1",
      item_id: "i1",
      quote: "highlighted sentence",
      seconds: 125,
      note: "Important takeaway",
    };

    let putCardBody: CardInput | null = null;

    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "GET /highlights/*": () => ({ json: { data: highlight } }),
      "GET /items/*": () => ({ json: { data: item } }),
      "GET /outline-sections": () => ({ json: { data: [] } }),
      "GET /cards": () => ({ json: { data: [] } }),
      "PUT /cards/*": ({ body }) => {
        putCardBody = body as CardInput;
        return { json: { data: { ...putCardBody, created_at: "", updated_at: "" } } };
      },
    });

    const h = await connect(registerResearchTools, { web: fake });
    const { text, isError } = await h.call("make_card", {
      highlight_id: "h1",
      project: "AI Research",
    });

    expect(isError).toBe(false);
    expect(text).toContain("added to unplaced card pile");
    expect(putCardBody).toMatchObject({
      kind: "quote",
      item_id: "i1",
      highlight_id: "h1",
      quote: "highlighted sentence",
      seconds: 125,
      note: "Important takeaway",
      section_id: null,
    });
  });
});

describe("add_broll", () => {
  it("adds b-roll clip from video source with start and end times", async () => {
    const item = makeItem("v1", "g1", { kind: "youtube", title: "Data Center Tour" });
    let putCardBody: CardInput | null = null;

    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "GET /items/*": () => ({ json: { data: item } }),
      "GET /outline-sections": () => ({
        json: {
          data: [
            {
              id: "sec1",
              project_id: "p1",
              title: "Infrastructure",
              position: 10,
              created_at: "",
              updated_at: "",
            },
          ],
        },
      }),
      "GET /cards": () => ({ json: { data: [] } }),
      "PUT /cards/*": ({ body }) => {
        putCardBody = body as CardInput;
        return { json: { data: { ...putCardBody, created_at: "", updated_at: "" } } };
      },
    });

    const h = await connect(registerResearchTools, { web: fake });
    const { text, isError } = await h.call("add_broll", {
      source_id: "v1",
      start: "1:15",
      end: "1:30",
      description: "Aerial shot of transformer substation",
      section: "Infrastructure",
    });

    expect(isError).toBe(false);
    expect(text).toContain("Added b-roll clip");
    expect(text).toContain('from "Data Center Tour" at 1:15–1:30');
    expect(text).toContain('placed in section "Infrastructure"');
    expect(putCardBody).toMatchObject({
      kind: "broll",
      seconds: 75,
      end_seconds: 90,
      script_line: "Aerial shot of transformer substation",
      section_id: "sec1",
    });
  });

  it("rejects invalid clip timestamps or end <= start", async () => {
    const item = makeItem("v1", "g1", { kind: "youtube", title: "Data Center Tour" });
    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "GET /items/*": () => ({ json: { data: item } }),
      "GET /outline-sections": () => ({ json: { data: [] } }),
      "GET /cards": () => ({ json: { data: [] } }),
    });

    const h = await connect(registerResearchTools, { web: fake });
    const res1 = await h.call("add_broll", {
      source_id: "v1",
      start: "invalid-time",
    });
    expect(res1.isError).toBe(true);
    expect(res1.text).toContain("Could not parse start time");

    const res2 = await h.call("add_broll", {
      source_id: "v1",
      start: "2:00",
      end: "1:00",
    });
    expect(res2.isError).toBe(true);
    expect(res2.text).toContain("End time must be after start time.");
  });
});

describe("list_cards", () => {
  it("groups cards by section and unplaced cards, with filtering", async () => {
    const sections: OutlineSection[] = [
      {
        id: "sec1",
        project_id: "p1",
        title: "Intro",
        position: 10,
        created_at: "",
        updated_at: "",
      },
    ];
    const items: Item[] = [makeItem("i1", "g1", { title: "Source One" })];
    const cards: Card[] = [
      {
        id: "c1",
        project_id: "p1",
        kind: "quote",
        item_id: "i1",
        highlight_id: null,
        quote: "Key quote one",
        seconds: null,
        end_seconds: null,
        url: null,
        note: "Note one",
        script_line: null,
        section_id: "sec1",
        position: 10,
        created_at: "",
        updated_at: "",
      },
      {
        id: "c2",
        project_id: "p1",
        kind: "broll",
        item_id: "i1",
        highlight_id: null,
        quote: "",
        seconds: 45,
        end_seconds: 60,
        url: null,
        note: null,
        script_line: "B-roll shot",
        section_id: null,
        position: 20,
        created_at: "",
        updated_at: "",
      },
    ];

    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "GET /outline-sections": () => ({ json: { data: sections } }),
      "GET /cards": () => ({ json: { data: cards } }),
      "GET /items": () => ({ json: { data: items } }),
    });

    const h = await connect(registerResearchTools, { web: fake });
    const all = await h.call("list_cards", { project: "AI Research" });
    expect(all.isError).toBe(false);
    expect(all.text).toContain("Section § Intro (1 card):");
    expect(all.text).toContain("[c1] quote");
    expect(all.text).toContain("Unplaced cards (1 card):");
    expect(all.text).toContain("[c2] broll");

    const unplacedOnly = await h.call("list_cards", {
      project: "AI Research",
      unplaced_only: true,
    });
    expect(unplacedOnly.text).toContain("[c2] broll");
    expect(unplacedOnly.text).not.toContain("[c1] quote");

    const quotesOnly = await h.call("list_cards", { project: "AI Research", kind: "quote" });
    expect(quotesOnly.text).toContain("[c1] quote");
    expect(quotesOnly.text).not.toContain("[c2] broll");
  });
});

describe("edit_outline", () => {
  it("executes sequential outline actions and stops on first failure", async () => {
    let sections: OutlineSection[] = [
      {
        id: "sec1",
        project_id: "p1",
        title: "Existing Section",
        position: 10,
        created_at: "",
        updated_at: "",
      },
    ];
    let cards: Card[] = [
      {
        id: "c1",
        project_id: "p1",
        kind: "line",
        item_id: null,
        highlight_id: null,
        quote: "",
        seconds: null,
        end_seconds: null,
        url: null,
        note: null,
        script_line: "Initial line",
        section_id: null,
        position: 10,
        created_at: "",
        updated_at: "",
      },
    ];

    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "GET /outline-sections": () => ({ json: { data: sections } }),
      "GET /cards": () => ({ json: { data: cards } }),
      "PUT /outline-sections/*": ({ body }) => {
        const sec = body as OutlineSectionInput;
        const existing = sections.find((s) => s.id === sec.id);
        if (existing) {
          Object.assign(existing, sec);
          return { json: { data: existing } };
        }
        const created: OutlineSection = { ...sec, created_at: "", updated_at: "" };
        sections.push(created);
        return { json: { data: created } };
      },
      "PATCH /cards/*": ({ path, body }) => {
        const id = path.split("/").pop();
        const card = cards.find((c) => c.id === id);
        if (!card) return { status: 404 };
        Object.assign(card, body);
        return { json: { data: card } };
      },
      "PUT /cards/*": ({ body }) => {
        const c = body as CardInput;
        const created: Card = { ...c, created_at: "", updated_at: "" };
        cards.push(created);
        return { json: { data: created } };
      },
    });

    const h = await connect(registerResearchTools, { web: fake });
    const res = await h.call("edit_outline", {
      project: "AI Research",
      actions: [
        { action: "add_section", title: "Hardware" },
        { action: "rename_section", section: "Existing Section", title: "Overview" },
        { action: "place_card", card_id: "c1", section: "Overview" },
        { action: "set_line", card_id: "c1", text: "Updated narration line" },
        { action: "add_line", section: "Overview", text: "Follow-up sentence" },
        { action: "delete_card", card_id: "nonexistent-card" }, // Failure here
      ],
    });

    expect(res.text).toContain('Failed during action 6 of 6: No card with id "nonexistent-card".');
    expect(res.text).toContain("Completed before failure:");
    expect(res.text).toContain('1. Added section "Hardware"');
    expect(res.text).toContain('2. Renamed section "Existing Section" to "Overview"');
    expect(res.text).toContain('3. Placed card [c1] in section "Overview"');
    expect(res.text).toContain("4. Updated script line on card [c1]");
    expect(res.text).toContain("5. Added line card");
  });
});

describe("get_script", () => {
  it("exports script narration, cited references, keep_references, and b-roll list", async () => {
    const sections: OutlineSection[] = [
      {
        id: "sec1",
        project_id: "p1",
        title: "Intro",
        position: 10,
        created_at: "",
        updated_at: "",
      },
    ];
    const items: Item[] = [
      makeItem("i1", "g1", {
        title: "Compute Scaling",
        triage: "keep",
        author: "Epoch AI",
        author_type: "lab",
        source_url: "https://example.com/scaling",
      }),
      makeItem("i2", "g1", {
        title: "Chip Architecture",
        triage: "keep",
        author: "Jim Keller",
        author_type: "researcher",
        source_url: "https://example.com/chips",
      }),
    ];
    const cards: Card[] = [
      {
        id: "c1",
        project_id: "p1",
        kind: "quote",
        item_id: "i1",
        highlight_id: null,
        quote: "Power is the constraint.",
        seconds: 120,
        end_seconds: null,
        url: null,
        note: null,
        script_line: "Power availability is the main bottleneck.",
        section_id: "sec1",
        position: 10,
        created_at: "",
        updated_at: "",
      },
      {
        id: "c2",
        project_id: "p1",
        kind: "broll",
        item_id: "i1",
        highlight_id: null,
        quote: "",
        seconds: 130,
        end_seconds: 145,
        url: null,
        note: null,
        script_line: "Substation aerial footage",
        section_id: "sec1",
        position: 20,
        created_at: "",
        updated_at: "",
      },
    ];

    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "GET /outline-sections": () => ({ json: { data: sections } }),
      "GET /cards": () => ({ json: { data: cards } }),
      "GET /items": () => ({ json: { data: items } }),
    });

    const h = await connect(registerResearchTools, { web: fake });

    const scriptRes = await h.call("get_script", { project: "AI Research", format: "script" });
    expect(scriptRes.isError).toBe(false);
    expect(scriptRes.text).toContain("# AI Research");
    expect(scriptRes.text).toContain("## Intro");
    expect(scriptRes.text).toContain("Power availability is the main bottleneck. [1, 2:00]");

    const refRes = await h.call("get_script", { project: "AI Research", format: "references" });
    expect(refRes.isError).toBe(false);
    expect(refRes.text).toContain("Compute Scaling");
    expect(refRes.text).toContain("Epoch AI");

    const keepRefRes = await h.call("get_script", {
      project: "AI Research",
      format: "keep_references",
    });
    expect(keepRefRes.isError).toBe(false);
    expect(keepRefRes.text).toContain("Chip Architecture");
    expect(keepRefRes.text).toContain("Compute Scaling");

    const brollRes = await h.call("get_script", { project: "AI Research", format: "broll" });
    expect(brollRes.isError).toBe(false);
    expect(brollRes.text).toContain("# B-roll: AI Research");
    expect(brollRes.text).toContain("Substation aerial footage");
    expect(brollRes.text).toContain("Compute Scaling");
    expect(brollRes.text).toContain("2:10–2:25");
  });
});

describe("list_sources status and tag filters", () => {
  it("filters by status and tag, showing author type, status, and tags per line", async () => {
    const items: Item[] = [
      makeItem("i1", "g1", {
        title: "First Source",
        author: "Ada",
        author_type: "researcher",
        triage: "keep",
        tags: ["Engines", "Fast"],
      }),
      makeItem("i2", "g1", {
        title: "Second Source",
        author: "Bob",
        author_type: "journalist",
        triage: "cut",
        tags: ["Engines"],
      }),
      makeItem("i3", "g1", {
        title: "Third Source",
        triage: null,
      }),
    ];

    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "GET /items": ({ query }) => {
        const folder = query.get("folder");
        if (folder === "g1") return { json: { data: items } };
        return { json: { data: [] } };
      },
    });

    const h = await connect(registerLibraryTools, { web: fake });

    // Status filter
    const keepRes = await h.call("list_sources", { group_id: "g1", status: "keep" });
    expect(keepRes.isError).toBe(false);
    expect(keepRes.text).toContain("First Source");
    expect(keepRes.text).toContain("Researcher");
    expect(keepRes.text).toContain("Keep");
    expect(keepRes.text).toContain("tags: Engines, Fast");
    expect(keepRes.text).not.toContain("Second Source");

    // Tag filter
    const tagRes = await h.call("list_sources", { group_id: "g1", tag: "Fast" });
    expect(tagRes.isError).toBe(false);
    expect(tagRes.text).toContain("First Source");
    expect(tagRes.text).not.toContain("Second Source");

    // None status filter (untriaged)
    const noneRes = await h.call("list_sources", { group_id: "g1", status: "none" });
    expect(noneRes.isError).toBe(false);
    expect(noneRes.text).toContain("Third Source");
    expect(noneRes.text).not.toContain("First Source");
  });
});

describe("read_source overview header", () => {
  it("shows author, author type, status, tags, and summary in overview header", async () => {
    clearReadCache();
    const fake = fakeWeb({
      "GET /items/*/content": () => ({
        text: "---\nsource: web\ntitle: Neural Nets\nurl: https://example.com/nn\n---\n\n## Overview\n\nShort content.",
      }),
      "GET /items/*": () => ({
        json: {
          data: {
            id: "s1",
            folder_id: "g1",
            kind: "web",
            title: "Neural Nets",
            source_url: "https://example.com/nn",
            status: "saved",
            author: "Ada Lovelace",
            author_type: "researcher",
            triage: "keep",
            tags: ["AI", "Math"],
            summary: "Early algorithms and compute.",
            created_at: "2026-10-19T00:00:00Z",
          },
        },
      }),
    });

    const h = await connect(registerReadTools, { web: fake });
    const { text, isError } = await h.call("read_source", { source_id: "s1" });

    expect(isError).toBe(false);
    expect(text).toContain("By: Ada Lovelace");
    expect(text).toContain("Author type: Researcher");
    expect(text).toContain("Status: Keep");
    expect(text).toContain("Tags: AI, Math");
    expect(text).toContain("Summary: Early algorithms and compute.");
  });
});

describe("add_links allow_duplicates and cross-group duplicate reporting", () => {
  it("refuses cross-group duplicate by default naming the group path", async () => {
    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "POST /items/check": () => ({
        json: {
          data: {
            exists: false,
            elsewhere: {
              item_id: "i99",
              folder_id: "g2",
              folder_path: "AI Research/Algorithms",
            },
          },
        },
      }),
    });

    const h = await connect(registerAddTools, { web: fake });
    const res = await h.call("add_links", {
      group_id: "g1",
      links: ["https://example.com/already-in-algorithms"],
      wait_seconds: 1,
      allow_duplicates: false,
    });

    expect(res.isError).toBe(false);
    expect(res.text).toContain("already saved");
    expect(res.text).toContain("Already saved in AI Research/Algorithms");
  });

  it("still refuses same-group duplicate even when allow_duplicates is true", async () => {
    let grokipediaCalled = false;

    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "POST /items/check": () => ({
        json: {
          data: {
            exists: true,
            folder_id: "g1",
            folder_name: "Compute",
          },
        },
      }),
      "POST /grokipedia": () => {
        grokipediaCalled = true;
        return {
          status: 201,
          json: { data: { id: "i101", title: "Should Not Save" } },
        };
      },
    });

    const h = await connect(registerAddTools, { web: fake });
    const res = await h.call("add_links", {
      group_id: "g1",
      links: ["https://grokipedia.com/page/Same_Group_Duplicate"],
      wait_seconds: 1,
      allow_duplicates: true,
    });

    expect(res.isError).toBe(false);
    expect(res.text).toContain("already saved");
    expect(res.text).toContain("Already saved in Compute");
    expect(grokipediaCalled).toBe(false);
  });

  it("saves cross-group duplicate with allow_duplicate: true in request body when allowed", async () => {
    let grokipediaBody: Record<string, unknown> | null = null;

    const fake = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "POST /items/check": () => ({
        json: {
          data: {
            exists: false,
            elsewhere: {
              item_id: "i99",
              folder_id: "g2",
              folder_path: "AI Research/Algorithms",
            },
          },
        },
      }),
      "POST /grokipedia": ({ body }) => {
        grokipediaBody = body as Record<string, unknown>;
        return {
          status: 201,
          json: {
            data: {
              id: "i101",
              folder_id: "g1",
              kind: "grokipedia",
              title: "Allowed Duplicate",
              slug: "Allowed_Duplicate",
              status: "saved",
            },
          },
        };
      },
    });

    const h = await connect(registerAddTools, { web: fake });
    const res = await h.call("add_links", {
      group_id: "g1",
      links: ["https://grokipedia.com/page/Allowed_Duplicate"],
      wait_seconds: 1,
      allow_duplicates: true,
    });

    expect(res.isError).toBe(false);
    expect(res.text).toContain("1 saved");
    expect(grokipediaBody).toMatchObject({
      allow_duplicate: true,
    });
  });
});
