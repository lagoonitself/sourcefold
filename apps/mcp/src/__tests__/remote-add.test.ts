import { SourceError } from "@sourcefold/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAddTools } from "../tools/add";
import * as saveLinkModule from "../links/save-link";
import type { LinkQueueRow } from "../types";
import { closedDesktop, connect, fakeWeb } from "./harness";

const PROJECT = {
  id: "00000000-0000-4000-8000-000000000001",
  parent_id: null,
  name: "Cars",
  position: 0,
};
const GROUP = {
  id: "00000000-0000-4000-8000-000000000002",
  parent_id: PROJECT.id,
  name: "Turbo",
  position: 0,
};

function remoteWeb() {
  const queueBodies: unknown[] = [];
  const queueRows: LinkQueueRow[] = [];
  const web = fakeWeb({
    "GET /folders": () => ({ json: { data: [PROJECT, GROUP] } }),
    "POST /link-queue": ({ body }) => {
      queueBodies.push(body);
      const links = (
        body as { links: { url: string; kind: string | null; needs: string; message: string }[] }
      ).links;
      const rows = links.map((link, index) => ({
        id: `00000000-0000-4000-8000-${String(queueRows.length + index + 1).padStart(12, "0")}`,
        folder_id: GROUP.id,
        url: link.url,
        kind: link.kind,
        needs: link.needs,
        status: "waiting",
        claimed_by: null,
        claimed_at: null,
        attempts: 0,
        message: link.message,
        title: null,
        item_id: null,
        added_by: "ChatGPT",
        created_at: "2026-11-02T00:00:00.000Z",
        updated_at: "2026-11-02T00:00:00.000Z",
      })) as LinkQueueRow[];
      queueRows.push(...rows);
      return { status: 201, json: { data: rows } };
    },
    "GET /link-queue": ({ query }) => ({
      json: {
        data:
          query.get("status") === "recent"
            ? [
                {
                  id: "00000000-0000-4000-8000-000000000099",
                  folder_id: GROUP.id,
                  url: "https://example.com/earlier",
                  kind: "web",
                  needs: "desktop",
                  status: "saved",
                  title: "Saved earlier",
                  item_id: "00000000-0000-4000-8000-000000000098",
                  message: null,
                  added_by: "Claude",
                },
              ]
            : queueRows.filter((row) => row.status === "waiting" || row.status === "working"),
      },
    }),
    "DELETE /link-queue/*": ({ path }) => {
      const id = path.split("/").at(-1);
      const row = queueRows.find((candidate) => candidate.id === id);
      if (row) row.status = "cancelled";
      return { json: { data: { ...(row ?? {}), status: "cancelled" } } };
    },
  });
  return { web, queueBodies, queueRows };
}

afterEach(() => vi.restoreAllMocks());

describe("remote add_links", () => {
  it("saves cloud links and queues refusals, YouTube, and X for the right worker", async () => {
    const { web, queueBodies } = remoteWeb();
    vi.spyOn(saveLinkModule, "saveLink").mockImplementation(async (url) => {
      if (url.endsWith("/refused")) throw new SourceError("blocked", "The server was blocked.");
      return { status: "saved", title: "Cloud saved", itemId: "item-cloud" };
    });
    const h = await connect((server, ctx) => void registerAddTools(server, ctx), {
      web,
      desktop: closedDesktop(),
      mode: "remote",
      addedBy: "ChatGPT",
    });

    const result = await h.call("add_links", {
      group_id: GROUP.id,
      links: [
        "https://example.com/saved",
        "https://example.com/refused",
        "https://www.youtube.com/watch?v=aircAruvnKk",
        "https://x.com/example/status/123",
      ],
    });

    expect(result.isError).toBe(false);
    expect(result.text).toContain("1 saved");
    expect(result.text).toContain("waiting for your computer");
    expect(result.text).toContain("waiting for Chrome");
    expect(result.text).toContain("Check with get_add_progress.");
    expect(saveLinkModule.saveLink).toHaveBeenCalledTimes(2);
    const links = queueBodies.flatMap((body) => (body as { links: unknown[] }).links) as {
      url: string;
      needs: string;
      message: string;
    }[];
    expect(links.find((link) => link.url.endsWith("/refused"))?.needs).toBe("desktop");
    expect(links.find((link) => link.url.includes("youtube.com"))?.needs).toBe("desktop");
    expect(links.find((link) => link.url.includes("x.com"))?.needs).toBe("browser");
    expect(queueBodies[0]).toMatchObject({ added_by: "ChatGPT", folder_id: GROUP.id });
  });

  it("queues remaining cloud links after the shared call budget is exhausted", async () => {
    const { web, queueBodies } = remoteWeb();
    const realNow = Date.now.bind(Date);
    let expired = false;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + (expired ? 50_000 : 0));
    vi.spyOn(saveLinkModule, "saveLink").mockImplementation(async () => {
      expired = true;
      return { status: "saved", title: "First", itemId: "item-first" };
    });
    const h = await connect((server, ctx) => void registerAddTools(server, ctx), {
      web,
      desktop: closedDesktop(),
      mode: "remote",
    });

    const result = await h.call("add_links", {
      group_id: GROUP.id,
      links: ["https://example.com/first", "https://example.com/after-budget"],
    });

    expect(result.text).toContain("1 saved");
    expect(result.text).toContain("1 waiting");
    expect(saveLinkModule.saveLink).toHaveBeenCalledTimes(1);
    expect(queueBodies.flatMap((body) => (body as { links: { url: string }[] }).links)).toEqual([
      expect.objectContaining({ url: "https://example.com/after-budget" }),
    ]);
  });

  it("reads open and recent queue rows without relying on process memory", async () => {
    const { web } = remoteWeb();
    const h = await connect((server, ctx) => void registerAddTools(server, ctx), {
      web,
      desktop: closedDesktop(),
      mode: "remote",
    });

    const open = await h.call("get_add_progress");
    expect(open.text).toContain("No links are waiting for your computer.");
    const recent = await h.call("get_add_progress", { recent: true });
    expect(recent.text).toContain("Saved earlier");
    expect(web.calls).toContain("GET /link-queue?status=open&limit=500");
    expect(web.calls).toContain("GET /link-queue?status=recent&limit=500");
  });

  it("still attempts Substack posts in the cloud and queues paid posts for desktop", async () => {
    const { web, queueBodies } = remoteWeb();
    vi.spyOn(saveLinkModule, "listCollection").mockResolvedValue({
      title: "Publication",
      links: [{ url: "https://writer.substack.com/p/paid-post", title: "Paid post", detail: null }],
      truncated: false,
    });
    vi.spyOn(saveLinkModule, "saveLink").mockResolvedValue({
      status: "paid",
      title: "Paid post",
      message: "Paid post.",
    });
    const h = await connect((server, ctx) => void registerAddTools(server, ctx), {
      web,
      desktop: closedDesktop(),
      mode: "remote",
    });

    const result = await h.call("add_links", {
      group_id: GROUP.id,
      links: ["https://writer.substack.com"],
    });

    expect(result.text).toContain("waiting for your computer");
    expect(saveLinkModule.saveLink).toHaveBeenCalledWith(
      "https://writer.substack.com/p/paid-post",
      "substack",
      GROUP.id,
      expect.objectContaining({ deferUnavailable: true }),
      expect.any(AbortSignal),
      false,
      expect.any(Number),
    );
    expect(
      queueBodies.flatMap((body) => (body as { links: { needs: string }[] }).links)[0]?.needs,
    ).toBe("desktop");
  });

  it("cancels every open queue row in a group", async () => {
    const { web } = remoteWeb();
    const h = await connect((server, ctx) => void registerAddTools(server, ctx), {
      web,
      desktop: closedDesktop(),
      mode: "remote",
    });
    await h.call("add_links", {
      group_id: GROUP.id,
      links: ["https://x.com/example/status/123"],
    });

    const result = await h.call("cancel_waiting_links", { group_id: GROUP.id });

    expect(result.isError).toBe(false);
    expect(result.text).toContain("1 waiting link cancelled.");
    expect(web.calls).toContain("DELETE /link-queue/00000000-0000-4000-8000-000000000001");
  });
});
