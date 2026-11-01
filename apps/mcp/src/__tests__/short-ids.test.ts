import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTool } from "../tools/define";
import { registerLibraryTools } from "../tools/library";
import { scheduleDriveSave } from "../tools/drive-autosave";
import { createShortIdStore, MAX_REMEMBERED_IDS } from "../tools/short-ids";
import { connect, fakeDesktop, fakeWeb } from "./harness";

vi.mock("../tools/drive-autosave", () => ({
  scheduleDriveSave: vi.fn(),
}));

describe("short ids", () => {
  const ID_A = "5ea963f7-1111-4444-8888-123456789abc";
  const ID_B = "5ea963f7-2222-4444-8888-abcdefabcdef";
  const ID_C = "abcdef01-2345-6789-abcd-ef0123456789";

  it("passes full UUIDs through directly (case-normalized) even if not remembered", () => {
    const store = createShortIdStore();
    const full = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890";
    expect(store.resolveId(full)).toBe(full.toLowerCase());
  });

  it("passes non-hex identifiers through unchanged", () => {
    const store = createShortIdStore();
    expect(store.resolveId("p1")).toBe("p1");
    expect(store.resolveId("project-alpha")).toBe("project-alpha");
    expect(store.resolveId("123")).toBe("123");
  });

  it("resolves a unique prefix of 6 or more hex characters", () => {
    const store = createShortIdStore();
    store.rememberId(ID_A);
    expect(store.resolveId("5ea963")).toBe(ID_A);
    expect(store.resolveId("5EA963F7")).toBe(ID_A);
    expect(store.resolveId("5ea963f7-1111")).toBe(ID_A);
  });

  it("fails with the exact contract message for unknown prefixes", () => {
    const store = createShortIdStore();
    expect(() => store.resolveId("5ea963")).toThrow(
      'No source or group id starting "5ea963" has been shown yet. Use the full id from list_sources or get_project_tree.',
    );
  });

  it("fails with the exact contract message for ambiguous prefixes", () => {
    const store = createShortIdStore();
    store.rememberId(ID_A);
    store.rememberId(ID_B);
    expect(() => store.resolveId("5ea963f7")).toThrow(
      '"5ea963f7" matches 2 ids. Use more characters or the full id.',
    );
    expect(store.resolveId("5ea963f7-1")).toBe(ID_A);
    expect(store.resolveId("5ea963f7-2")).toBe(ID_B);
  });

  it("extracts UUIDs from text and keeps each context isolated", () => {
    const first = createShortIdStore();
    const second = createShortIdStore();
    first.rememberIds(`Found sources [${ID_A}] and [${ID_C}].`);
    expect(first.resolveId("5ea963")).toBe(ID_A);
    expect(first.resolveId("abcdef01")).toBe(ID_C);
    expect(() => second.resolveId("5ea963")).toThrow(/No source or group id starting/);
  });

  it("enforces the cache limit and drops oldest entries", () => {
    const store = createShortIdStore();
    const makeId = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    store.rememberId(ID_A);
    for (let i = 0; i < MAX_REMEMBERED_IDS; i++) store.rememberId(makeId(i));
    expect(() => store.resolveId("5ea963")).toThrow(/No source or group id starting/);
    expect(store.resolveId("00000000-0000-0000-0000-000000049999")).toBe(makeId(49999));
  });
});

describe("defineTool integration with short ids and drive autosave", () => {
  beforeEach(() => vi.clearAllMocks());

  const FULL_ID = "5ea963f7-1111-4444-8888-123456789abc";

  it("resolves short ids before passing to a local tool run", async () => {
    let receivedSourceId: string | null = null;
    let receivedSourceIds: string[] | null = null;
    const h = await connect(
      (server, ctx) => {
        ctx.shortIds?.rememberId(FULL_ID);
        defineTool(server, ctx, {
          name: "test_tool",
          title: "Test Tool",
          description: "Resolves ids",
          input: {
            source_id: z.string().optional(),
            source_ids: z.array(z.string()).optional(),
          },
          readOnly: true,
          run: async ({ source_id, source_ids }) => {
            receivedSourceId = source_id ?? null;
            receivedSourceIds = source_ids ?? null;
            return "ok";
          },
        });
      },
      { web: fakeWeb({}), desktop: fakeDesktop() },
    );

    const res = await h.call("test_tool", { source_id: "5ea963", source_ids: ["5ea963f7"] });
    expect(res.isError).toBe(false);
    expect(receivedSourceId).toBe(FULL_ID);
    expect(receivedSourceIds).toEqual([FULL_ID]);
  });

  it("answers local resolution errors with isError true", async () => {
    const h = await connect(
      (server, ctx) =>
        defineTool(server, ctx, {
          name: "test_tool",
          title: "Test Tool",
          description: "Resolves ids",
          input: { source_id: z.string() },
          readOnly: true,
          run: async () => "ok",
        }),
      { web: fakeWeb({}), desktop: fakeDesktop() },
    );
    const res = await h.call("test_tool", { source_id: "5ea963" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("No source or group id starting");
  });

  it("remembers ids from local tool replies", async () => {
    const h = await connect(
      (server, ctx) =>
        defineTool(server, ctx, {
          name: "speaker",
          title: "Speaker",
          description: "Outputs an id",
          input: {},
          readOnly: true,
          run: async () => `Here is source [${FULL_ID}]`,
        }),
      { web: fakeWeb({}), desktop: fakeDesktop() },
    );
    await h.call("speaker");
    expect(h.ctx.shortIds?.resolveId("5ea963")).toBe(FULL_ID);
  });

  it("does not rely on short ids in stateless remote mode", async () => {
    const h = await connect(
      (server, ctx) => {
        defineTool(server, ctx, {
          name: "speaker",
          title: "Speaker",
          description: "Outputs an id",
          input: {},
          readOnly: true,
          run: async () => `Here is source [${FULL_ID}]`,
        });
        defineTool(server, ctx, {
          name: "echo_id",
          title: "Echo id",
          description: "Echoes the id input",
          input: { source_id: z.string() },
          readOnly: true,
          run: async ({ source_id }) => source_id,
        });
      },
      { web: fakeWeb({}), desktop: fakeDesktop(), mode: "remote" },
    );

    expect((await h.call("speaker")).text).toContain(FULL_ID);
    expect(await h.call("echo_id", { source_id: "5ea963" })).toMatchObject({
      text: "5ea963",
      isError: false,
    });
  });

  it("keeps full source ids in remote project trees even when compact is requested", async () => {
    const projectId = "00000000-0000-4000-8000-000000000001";
    const groupId = "00000000-0000-4000-8000-000000000002";
    const itemId = "00000000-0000-4000-8000-000000000003";
    const web = fakeWeb({
      "GET /folders": () => ({
        json: {
          data: [
            { id: projectId, parent_id: null, name: "Cars", position: 0 },
            { id: groupId, parent_id: projectId, name: "Turbo", position: 0 },
          ],
        },
      }),
      "GET /items": () => ({
        json: {
          data: [
            {
              id: itemId,
              folder_id: groupId,
              kind: "web",
              title: "A source",
              source_url: "https://example.com/source",
              canonical_url: "https://example.com/source",
              status: "saved",
              error: null,
              meta: null,
              created_at: "2026-11-02T00:00:00.000Z",
            },
          ],
        },
      }),
    });
    const h = await connect((server, ctx) => registerLibraryTools(server, ctx), {
      web,
      mode: "remote",
    });

    const result = await h.call("get_project_tree", {
      project_id: projectId,
      include_sources: true,
      compact: true,
    });

    expect(result.text).toContain(`[${itemId}]`);
    expect(result.text).not.toContain(`[${itemId.slice(0, 8)}]`);
  });

  it("schedules Drive autosave only after successful non-readOnly local tools", async () => {
    const h = await connect(
      (server, ctx) => {
        defineTool(server, ctx, {
          name: "reader",
          title: "Reader",
          description: "Read only",
          input: {},
          readOnly: true,
          run: async () => "read done",
        });
        defineTool(server, ctx, {
          name: "writer",
          title: "Writer",
          description: "Mutating",
          input: {},
          readOnly: false,
          run: async () => "write done",
        });
        defineTool(server, ctx, {
          name: "failing_writer",
          title: "Failing Writer",
          description: "Mutating that fails",
          input: {},
          readOnly: false,
          run: async () => {
            throw new Error("write exploded");
          },
        });
      },
      { web: fakeWeb({}), desktop: fakeDesktop() },
    );

    await h.call("reader");
    expect(scheduleDriveSave).not.toHaveBeenCalled();
    await h.call("failing_writer");
    expect(scheduleDriveSave).not.toHaveBeenCalled();
    await h.call("writer");
    expect(scheduleDriveSave).toHaveBeenCalledTimes(1);
  });

  it("does not schedule Drive autosave for remote mutations", async () => {
    const h = await connect(
      (server, ctx) =>
        defineTool(server, ctx, {
          name: "writer",
          title: "Writer",
          description: "Remote mutation",
          input: {},
          run: async () => "write done",
        }),
      { web: fakeWeb({}), desktop: fakeDesktop(), mode: "remote" },
    );
    await h.call("writer");
    expect(scheduleDriveSave).not.toHaveBeenCalled();
  });
});
