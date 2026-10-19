import { SourceError } from "@sourcefold/core";
import { YOUTUBE_BLOCKED_MESSAGE } from "@sourcefold/core/capture";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddJobs, type AddJob } from "../tools/add-jobs";
import { registerAddTools } from "../tools/add";
import type { LinkDeps } from "../links/save-link";
import * as saveLinkModule from "../links/save-link";
import { checkDuplicate, classifyLink } from "../links/save-link";
import { assertPublicUrl, BlockedAddressError } from "../links/public-fetch";
import { connect, fakeDesktop, fakeWeb } from "./harness";

const PROJECT = { id: "p1", parent_id: null, name: "Cars", position: 0 };
const GROUP = { id: "g1", parent_id: "p1", name: "Turbo", position: 0 };
const NO_PACING = { gapMs: () => 0, rateLimitWaitsMs: [5, 5] };

afterEach(() => vi.restoreAllMocks());

describe("classifyLink", () => {
  it("routes each kind like the desktop's Add links", () => {
    expect(classifyLink("https://grokipedia.com/page/Turbocharger")).toBe("grokipedia");
    expect(classifyLink("https://en.wikipedia.org/wiki/Turbocharger")).toBe("wikipedia");
    expect(classifyLink("https://x.com/a/status/1")).toBe("x");
    expect(classifyLink("https://www.youtube.com/watch?v=aircAruvnKk")).toBe("source");
    expect(classifyLink("https://www.youtube.com/playlist?list=PLabc")).toBe("youtube_list");
    expect(classifyLink("https://name.substack.com/p/a-post")).toBe("substack");
    expect(classifyLink("https://name.substack.com")).toBe("publication");
    expect(classifyLink("https://example.com/article")).toBe("source");
  });
});

describe("checkDuplicate", () => {
  it("always refuses same-group duplicate even when allowDuplicates is true", () => {
    const same = { exists: true, folder_name: "Turbo" };
    expect(checkDuplicate(same, false)).toEqual({
      isDuplicate: true,
      message: "Already saved in Turbo",
    });
    expect(checkDuplicate(same, true)).toEqual({
      isDuplicate: true,
      message: "Already saved in Turbo",
    });
  });

  it("refuses cross-group duplicate when allowDuplicates is false naming the group path", () => {
    const cross = {
      exists: false,
      elsewhere: { item_id: "other", folder_id: "g2", folder_path: "Cars › Engines" },
    };
    expect(checkDuplicate(cross, false)).toEqual({
      isDuplicate: true,
      message: "Already saved in Cars › Engines",
    });
  });

  it("allows cross-group duplicate when allowDuplicates is true", () => {
    const cross = {
      exists: false,
      elsewhere: { item_id: "other", folder_id: "g2", folder_path: "Cars › Engines" },
    };
    expect(checkDuplicate(cross, true)).toEqual({
      isDuplicate: false,
      message: "",
    });
  });
});

describe("assertPublicUrl", () => {
  const resolveTo = (address: string) => async () => [{ address }];
  it("refuses this computer and the local network", async () => {
    await expect(
      assertPublicUrl(new URL("http://127.0.0.1:23456/api/agent/status")),
    ).rejects.toThrow(BlockedAddressError);
    await expect(assertPublicUrl(new URL("http://localhost/"))).rejects.toThrow(
      BlockedAddressError,
    );
    await expect(
      assertPublicUrl(new URL("https://sneaky.example.com/"), resolveTo("192.168.1.5")),
    ).rejects.toThrow(BlockedAddressError);
    await expect(
      assertPublicUrl(new URL("https://example.com/"), resolveTo("93.184.215.14")),
    ).resolves.toBeUndefined();
  });
});

function grokipediaWeb(existing: Set<string> = new Set()) {
  let n = 0;
  return fakeWeb({
    "GET /folders": () => ({ json: { data: [PROJECT, GROUP] } }),
    "POST /items/check": ({ body }) => {
      const url = (body as { url: string }).url;
      return { json: { data: { exists: existing.has(url), folder_name: "Turbo" } } };
    },
    "POST /grokipedia": ({ body }) => {
      n += 1;
      return {
        status: 201,
        json: {
          data: {
            item: { id: `item-${n}`, title: `Article ${n}`, url: (body as { url: string }).url },
          },
        },
      };
    },
  });
}

describe("add_links", () => {
  it("saves, reports duplicates and skips X posts", async () => {
    const web = grokipediaWeb(new Set(["https://grokipedia.com/page/Old"]));
    const desktop = fakeDesktop();
    const h = await connect((server, ctx) => void registerAddTools(server, ctx, NO_PACING), {
      web,
      desktop,
    });
    const result = await h.call("add_links", {
      group_id: "g1",
      links: [
        "https://grokipedia.com/page/Turbocharger https://grokipedia.com/page/Old",
        "https://x.com/someone/status/123",
      ],
    });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("Adding to Cars › Turbo");
    expect(result.text).toContain("3 of 3 links done (1 saved, 1 already saved, 1 skipped)");
    expect(result.text).toContain("saved [item-1]: Article 1");
    expect(result.text).toContain("Already saved in Turbo");
    expect(result.text).toMatch(/X posts are saved with the Sourcefold extension/);
    expect(result.text).toContain("Finished.");
    // The app is told after each save and once more when the tool answers.
    expect(desktop.changed).toHaveBeenCalled();
  });

  it("refuses a project as the target", async () => {
    const h = await connect((server, ctx) => void registerAddTools(server, ctx, NO_PACING), {
      web: grokipediaWeb(),
    });
    const result = await h.call("add_links", {
      group_id: "p1",
      links: ["https://grokipedia.com/page/Turbocharger"],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Cars is a project/);
  });

  it("answers while the job runs, and get_add_progress finds it", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(saveLinkModule, "saveLink").mockImplementation(async () => {
      await gate;
      return { status: "saved", title: "Slow", itemId: "slow-1" };
    });
    const h = await connect((server, ctx) => void registerAddTools(server, ctx, NO_PACING), {
      web: grokipediaWeb(),
    });
    const first = await h.call("add_links", {
      group_id: "g1",
      links: ["https://grokipedia.com/page/Slow"],
      wait_seconds: 0,
    });
    expect(first.text).toContain("Still running in the background");
    const jobId = /job ([0-9a-f]{8})/.exec(first.text)?.[1];
    expect(jobId).toBeTruthy();

    release();
    const done = await h.call("get_add_progress", { job_id: jobId, wait_seconds: 5 });
    expect(done.text).toContain("1 of 1 link done (1 saved)");
    expect(done.text).toContain("Finished.");

    const listed = await h.call("get_add_progress", {});
    expect(listed.text).toContain(`job ${jobId}: finished`);
  });
});

describe("AddJobs pacing", () => {
  const deps = { desktop: fakeDesktop() } as unknown as LinkDeps;

  async function finished(jobs: AddJobs, job: AddJob) {
    await jobs.waitForEnd(job, 5_000);
    return job;
  }

  it("waits and tries a video again when YouTube pushes back", async () => {
    const spy = vi
      .spyOn(saveLinkModule, "saveLink")
      .mockRejectedValueOnce(new SourceError("blocked", YOUTUBE_BLOCKED_MESSAGE))
      .mockResolvedValueOnce({ status: "saved", title: "Video", itemId: "v1" });
    const jobs = new AddJobs(async () => deps, NO_PACING);
    const job = await finished(
      jobs,
      jobs.start(
        "g1",
        "Cars › Turbo",
        [{ url: "https://www.youtube.com/watch?v=aircAruvnKk", kind: "source" }],
        {
          limitPerCollection: 50,
          publishedAfter: null,
          publishedBefore: null,
        },
      ),
    );
    expect(spy).toHaveBeenCalledTimes(2);
    expect(job.rows[0]).toMatchObject({ status: "saved", itemId: "v1" });
  });

  it("leaves the other videos waiting when YouTube keeps refusing", async () => {
    vi.spyOn(saveLinkModule, "saveLink").mockRejectedValue(
      new SourceError("blocked", YOUTUBE_BLOCKED_MESSAGE),
    );
    const jobs = new AddJobs(async () => deps, NO_PACING);
    const job = await finished(
      jobs,
      jobs.start(
        "g1",
        "Cars › Turbo",
        [
          { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", kind: "source" },
          { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", kind: "source" },
        ],
        { limitPerCollection: 50, publishedAfter: null, publishedBefore: null },
      ),
    );
    expect(job.rows[0]?.status).toBe("failed");
    expect(job.rows[0]?.message).toMatch(/still limiting requests/);
    expect(job.rows[1]).toMatchObject({
      status: "waiting",
      message: "Not tried: YouTube was limiting requests.",
    });
  });

  it("stops after the current link", async () => {
    let calls = 0;
    vi.spyOn(saveLinkModule, "saveLink").mockImplementation(async () => {
      calls += 1;
      return { status: "saved", title: "A", itemId: `a${calls}` };
    });
    const jobs = new AddJobs(async () => deps, { gapMs: () => 50, rateLimitWaitsMs: [] });
    const job = jobs.start(
      "g1",
      "Cars › Turbo",
      ["a", "b", "c"].map((id) => ({
        url: `https://www.youtube.com/watch?v=${id.repeat(11)}`,
        kind: "source" as const,
      })),
      { limitPerCollection: 50, publishedAfter: null, publishedBefore: null },
    );
    await new Promise((r) => setTimeout(r, 10));
    jobs.stop(job.id);
    await finished(jobs, job);
    expect(job.state).toBe("stopped");
    expect(job.rows.filter((r) => r.status === "waiting").length).toBeGreaterThan(0);
  });
});
