import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as saveLinkModule from "../links/save-link";
import { formatJob } from "../tools/add";
import {
  ADD_JOBS_FILE,
  AddJobs,
  fileJobStore,
  inMemoryJobStore,
  memoryJobStore,
  type AddJob,
  type JobRow,
} from "../tools/add-jobs";

function makeFakeJob(overrides: Partial<AddJob> = {}): AddJob {
  return {
    id: "testjob1",
    groupId: "grp1",
    groupPath: "Project / Group",
    state: "finished",
    createdAt: 1000,
    finishedAt: 2000,
    options: {
      limitPerCollection: 50,
      publishedAfter: null,
      publishedBefore: null,
      allowDuplicates: false,
    },
    rows: [
      {
        url: "https://en.wikipedia.org/wiki/Test",
        kind: "wikipedia",
        status: "saved",
        title: "Test",
        message: null,
        itemId: "item1",
        resumeAt: null,
      },
    ],
    ...overrides,
  };
}

describe("AddJobs store and persistence", () => {
  it("exports ADD_JOBS_FILE constant and memoryJobStore alias", () => {
    expect(ADD_JOBS_FILE).toBe("mcp-add-jobs.json");
    expect(memoryJobStore).toBe(inMemoryJobStore);
  });

  it("in-memory store saves and loads jobs", () => {
    const job1 = makeFakeJob({ id: "job1", createdAt: 1000 });
    const store = inMemoryJobStore([job1]);

    expect(store.load()).toEqual([job1]);

    const job2 = makeFakeJob({ id: "job2", createdAt: 2000 });
    store.save([job2, job1]);
    expect(store.load()).toEqual([job2, job1]);
  });

  it("file store saves atomically and loads jobs", () => {
    const dir = mkdtempSync(join(tmpdir(), "sourcefold-test-jobs-"));
    const path = join(dir, "mcp-add-jobs.json");

    try {
      const store = fileJobStore(path);
      // Non-existent file loads empty without error
      expect(store.load()).toEqual([]);

      const job = makeFakeJob({ id: "filejob1" });
      store.save([job]);

      expect(existsSync(path)).toBe(true);
      expect(existsSync(`${path}.tmp`)).toBe(false);
      expect(store.load()).toEqual([job]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("corrupt store file returns empty without throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "sourcefold-test-jobs-corrupt-"));
    const path = join(dir, "mcp-add-jobs.json");

    try {
      writeFileSync(path, "NOT_JSON_{{[", "utf8");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const store = fileJobStore(path);
      const loaded = store.load();
      expect(loaded).toEqual([]);
      expect(errorSpy).toHaveBeenCalled();

      // AddJobs starts cleanly with corrupt file
      const jobs = new AddJobs(async () => ({}) as any, undefined, store);
      jobs.restore();
      expect(jobs.list()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restore requeues an interrupted job and turns saving/finding/paused rows back to waiting", async () => {
    const interruptedJob: AddJob = makeFakeJob({
      id: "interrupted",
      state: "running",
      createdAt: 1000,
      rows: [
        {
          url: "https://example.com/1",
          kind: "source",
          status: "saved",
          title: "First",
          message: null,
          itemId: "item-1",
          resumeAt: null,
        },
        {
          url: "https://example.com/2",
          kind: "source",
          status: "saving",
          title: "Second",
          message: "saving now",
          itemId: null,
          resumeAt: null,
        },
        {
          url: "https://example.com/3",
          kind: "source",
          status: "finding",
          title: "Third",
          message: "expanding",
          itemId: null,
          resumeAt: null,
        },
        {
          url: "https://example.com/4",
          kind: "source",
          status: "paused",
          title: "Fourth",
          message: "rate limited",
          itemId: null,
          resumeAt: 999999,
        },
        {
          url: "https://example.com/5",
          kind: "source",
          status: "waiting",
          title: null,
          message: null,
          itemId: null,
          resumeAt: null,
        },
        {
          url: "https://example.com/6",
          kind: "source",
          status: "failed",
          title: "Sixth",
          message: "404 not found",
          itemId: null,
          resumeAt: null,
        },
      ],
    });

    const finishedJob = makeFakeJob({ id: "finished1", state: "finished", createdAt: 500 });
    const stoppedJob = makeFakeJob({ id: "stopped1", state: "stopped", createdAt: 600 });

    const store = inMemoryJobStore([interruptedJob, finishedJob, stoppedJob]);

    // Mock saveLink to instantly save rows when run
    const saveLinkSpy = vi.spyOn(saveLinkModule, "saveLink").mockImplementation(async (url) => ({
      status: "saved",
      title: `Saved: ${url}`,
      itemId: "id-new",
    }));

    const jobs = new AddJobs(
      async () => ({ desktop: { changed: vi.fn() } }) as any,
      { gapMs: () => 0, rateLimitWaitsMs: [] },
      store,
    );

    jobs.restore();

    // The restored job should be in the list
    const restored = jobs.get("interrupted");
    expect(restored).toBeDefined();

    // Check rows reset: saving, finding, paused were turned back to waiting
    expect(restored!.rows[0]!.status).toBe("saved");
    expect(restored!.rows[1]!.status).toBe("waiting");
    expect(restored!.rows[1]!.message).toBeNull();
    expect(restored!.rows[2]!.status).toBe("waiting");
    expect(restored!.rows[2]!.message).toBeNull();
    expect(restored!.rows[3]!.status).toBe("waiting");
    expect(restored!.rows[3]!.resumeAt).toBeNull();
    expect(restored!.rows[3]!.message).toBeNull();
    expect(restored!.rows[4]!.status).toBe("waiting");
    expect(restored!.rows[5]!.status).toBe("failed");
    expect(restored!.rows[5]!.message).toBe("404 not found");

    // Finished and stopped jobs remain untouched
    expect(jobs.get("finished1")?.state).toBe("finished");
    expect(jobs.get("stopped1")?.state).toBe("stopped");

    // Wait for the restored queued job to complete
    await jobs.waitForEnd(restored!, 2000);
    expect(restored!.state).toBe("finished");
    expect(saveLinkSpy).toHaveBeenCalled();
  });

  it("ahead() returns jobs queued or running before it, and formatJob shows queue position", () => {
    const job1: AddJob = makeFakeJob({
      id: "job1",
      state: "running",
      createdAt: 1000,
      rows: [
        {
          url: "u1",
          kind: "source",
          status: "saved",
          title: null,
          message: null,
          itemId: null,
          resumeAt: null,
        },
        {
          url: "u2",
          kind: "source",
          status: "waiting",
          title: null,
          message: null,
          itemId: null,
          resumeAt: null,
        },
        {
          url: "u3",
          kind: "source",
          status: "saving",
          title: null,
          message: null,
          itemId: null,
          resumeAt: null,
        },
      ],
    });

    const job2: AddJob = makeFakeJob({
      id: "job2",
      state: "queued",
      createdAt: 2000,
      rows: [
        {
          url: "u4",
          kind: "source",
          status: "waiting",
          title: null,
          message: null,
          itemId: null,
          resumeAt: null,
        },
      ],
    });

    const jobs = new AddJobs(async () => ({}) as any, undefined, inMemoryJobStore([job1, job2]));
    // Manually register in map for testing ahead()
    (jobs as any).jobs.set(job1.id, job1);
    (jobs as any).jobs.set(job2.id, job2);

    const aheadJobs = jobs.ahead(job2);
    expect(aheadJobs).toEqual([job1]);

    // 2 links still to save in job1 (u2 waiting, u3 saving)
    const formatted = formatJob(job2, Date.now(), aheadJobs);
    expect(formatted).toContain("Waiting behind 1 earlier add job with 2 links still to save.");

    // Test plural forms
    const job3: AddJob = makeFakeJob({
      id: "job3",
      state: "queued",
      createdAt: 3000,
      rows: [
        {
          url: "u5",
          kind: "source",
          status: "waiting",
          title: null,
          message: null,
          itemId: null,
          resumeAt: null,
        },
      ],
    });
    (jobs as any).jobs.set(job3.id, job3);

    const aheadJob3 = jobs.ahead(job3);
    expect(aheadJob3).toHaveLength(2);
    // job1 has 2 links to save, job2 has 1 link to save => 3 links total
    const formattedJob3 = formatJob(job3, Date.now(), aheadJob3);
    expect(formattedJob3).toContain(
      "Waiting behind 2 earlier add jobs with 3 links still to save.",
    );
  });

  it("fails a link if per-link timeout signal fires", async () => {
    vi.spyOn(saveLinkModule, "saveLink").mockImplementation(async (_u, _k, _g, _d, signal) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve({ status: "saved", itemId: "item-ok", title: "OK" });
        }, 1000);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error("Timeout"));
        });
      });
    });

    const jobs = new AddJobs(async () => ({ desktop: { changed: vi.fn() } }) as any, {
      gapMs: () => 0,
      rateLimitWaitsMs: [],
      linkTimeoutMs: 30, // short timeout for test
    });

    const job = jobs.start("grp1", "Path", [{ url: "https://slow.example.com", kind: "source" }], {
      limitPerCollection: 50,
      publishedAfter: null,
      publishedBefore: null,
    });

    await jobs.waitForEnd(job, 3000);

    expect(job.state).toBe("finished");
    expect(job.rows[0]!.status).toBe("failed");
    expect(job.rows[0]!.message).toBe("The site took too long to answer (over 2 minutes).");
  });

  it("formatJob includes Substack paid hint when rows have status 'paid'", () => {
    const jobWithPaid = makeFakeJob({
      rows: [
        {
          url: "https://example.substack.com/p/paid-post",
          kind: "substack",
          status: "paid",
          title: "Paid Post",
          message: "Requires subscription",
          itemId: null,
          resumeAt: null,
        },
      ],
    });

    const textWithPaid = formatJob(jobWithPaid);
    expect(textWithPaid).toContain(
      "Paid posts need the user's Substack cookie: in the Sourcefold desktop app, Settings → Substack. Then add those links again.",
    );

    const jobWithoutPaid = makeFakeJob({
      rows: [
        {
          url: "https://example.substack.com/p/free-post",
          kind: "substack",
          status: "saved",
          title: "Free Post",
          message: null,
          itemId: "item-free",
          resumeAt: null,
        },
      ],
    });

    const textWithoutPaid = formatJob(jobWithoutPaid);
    expect(textWithoutPaid).not.toContain("Paid posts need the user's Substack cookie");
  });
});
