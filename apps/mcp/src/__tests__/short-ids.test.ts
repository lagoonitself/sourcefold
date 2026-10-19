import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTool } from "../tools/define";
import { scheduleDriveSave } from "../tools/drive-autosave";
import {
  clearRememberedIds,
  MAX_REMEMBERED_IDS,
  rememberId,
  rememberIds,
  resolveId,
} from "../tools/short-ids";
import { connect, fakeDesktop, fakeWeb } from "./harness";

vi.mock("../tools/drive-autosave", () => ({
  scheduleDriveSave: vi.fn(),
}));

describe("short ids", () => {
  beforeEach(() => {
    clearRememberedIds();
    vi.clearAllMocks();
  });

  const ID_A = "5ea963f7-1111-4444-8888-123456789abc";
  const ID_B = "5ea963f7-2222-4444-8888-abcdefabcdef";
  const ID_C = "abcdef01-2345-6789-abcd-ef0123456789";

  it("passes full UUIDs through directly (case-normalized) even if not remembered", () => {
    const full = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890";
    expect(resolveId(full)).toBe(full.toLowerCase());
  });

  it("passes non-hex identifiers through unchanged", () => {
    expect(resolveId("p1")).toBe("p1");
    expect(resolveId("project-alpha")).toBe("project-alpha");
    expect(resolveId("123")).toBe("123");
  });

  it("resolves a unique prefix of 6 or more hex characters", () => {
    rememberId(ID_A);
    expect(resolveId("5ea963")).toBe(ID_A);
    expect(resolveId("5EA963F7")).toBe(ID_A);
    expect(resolveId("5ea963f7-1111")).toBe(ID_A);
  });

  it("fails with the exact contract message for unknown prefixes", () => {
    expect(() => resolveId("5ea963")).toThrow(
      'No source or group id starting "5ea963" has been shown yet. Use the full id from list_sources or get_project_tree.',
    );
  });

  it("fails with the exact contract message for ambiguous prefixes", () => {
    rememberId(ID_A);
    rememberId(ID_B);
    expect(() => resolveId("5ea963f7")).toThrow(
      '"5ea963f7" matches 2 ids. Use more characters or the full id.',
    );
    // Disambiguating with more characters works:
    expect(resolveId("5ea963f7-1")).toBe(ID_A);
    expect(resolveId("5ea963f7-2")).toBe(ID_B);
  });

  it("extracts UUIDs from text with rememberIds", () => {
    const text = `Found sources [${ID_A}] and [${ID_C}].`;
    rememberIds(text);
    expect(resolveId("5ea963")).toBe(ID_A);
    expect(resolveId("abcdef01")).toBe(ID_C);
  });

  it("enforces cache limit and drops oldest entries", () => {
    const makeId = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    rememberId(ID_A);
    for (let i = 0; i < MAX_REMEMBERED_IDS; i++) {
      rememberId(makeId(i));
    }
    // ID_A was dropped as oldest
    expect(() => resolveId("5ea963")).toThrow(/No source or group id starting/);
    // Recent entry remains
    expect(resolveId("00000000-0000-0000-0000-000000049999")).toBe(makeId(49999));
  });
});

describe("defineTool integration with short ids and drive autosave", () => {
  beforeEach(() => {
    clearRememberedIds();
    vi.clearAllMocks();
  });

  const FULL_ID = "5ea963f7-1111-4444-8888-123456789abc";

  it("resolves short ids before passing to tool run", async () => {
    rememberId(FULL_ID);
    let receivedSourceId: string | null = null;
    let receivedSourceIds: string[] | null = null;

    const h = await connect(
      (server, ctx) =>
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
        }),
      { web: fakeWeb({}), desktop: fakeDesktop() },
    );

    const res = await h.call("test_tool", {
      source_id: "5ea963",
      source_ids: ["5ea963f7"],
    });
    expect(res.isError).toBe(false);
    expect(receivedSourceId).toBe(FULL_ID);
    expect(receivedSourceIds).toEqual([FULL_ID]);
  });

  it("answers resolution errors with isError: true", async () => {
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
    expect(res.text).toContain(
      'No source or group id starting "5ea963" has been shown yet. Use the full id from list_sources or get_project_tree.',
    );
  });

  it("remembers ids from tool replies", async () => {
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
    expect(resolveId("5ea963")).toBe(FULL_ID);
  });

  it("schedules drive autosave only after successful non-readOnly tools", async () => {
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
});
