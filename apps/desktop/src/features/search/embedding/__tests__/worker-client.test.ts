import { beforeEach, describe, expect, it } from "vitest";
import type { FromWorker, ToWorker } from "../protocol";
import { getInfo, resetStore, setEnabled } from "../store";
import { createEmbedClient, type WorkerLike } from "../worker-client";

class FakeWorker implements WorkerLike {
  sent: ToWorker[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(message: ToWorker) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(message: FromWorker) {
    this.onmessage?.({ data: message } as MessageEvent<FromWorker>);
  }
}

describe("embed client", () => {
  beforeEach(() => {
    resetStore();
    setEnabled(true);
  });

  it("starts the worker only on first use", () => {
    let created = 0;
    createEmbedClient(() => {
      created += 1;
      return new FakeWorker();
    });
    expect(created).toBe(0);
  });

  it("reports download progress, then the device when ready", async () => {
    const worker = new FakeWorker();
    const client = createEmbedClient(() => worker);
    const loaded = client.load();
    expect(worker.sent).toEqual([{ type: "load" }]);
    worker.reply({ type: "progress", progress: 0.4 });
    expect(getInfo().state).toBe("downloading");
    expect(getInfo().progress).toBe(0.4);
    worker.reply({ type: "ready", device: "wasm" });
    await expect(loaded).resolves.toBe("wasm");
    expect(getInfo()).toMatchObject({ state: "ready", device: "wasm", progress: null });
    expect(client.isReady()).toBe(true);
  });

  it("shows a readable error when the model can't load, and can try again", async () => {
    const worker = new FakeWorker();
    const client = createEmbedClient(() => worker);
    const first = client.load();
    worker.reply({ type: "load-error", message: "Failed to fetch" });
    await expect(first).rejects.toThrow("Couldn't download the model");
    expect(getInfo().state).toBe("error");
    void client.load().catch(() => {});
    expect(worker.sent.filter((m) => m.type === "load")).toHaveLength(2);
  });

  it("matches results to calls by id", async () => {
    const worker = new FakeWorker();
    const client = createEmbedClient(() => worker);
    const a = client.embed(["one"]);
    const q = client.query("two");
    const [first, second] = worker.sent as { id: number }[];
    worker.reply({ type: "result", id: second.id, vectors: [new Float32Array([1, 0])] });
    worker.reply({ type: "result", id: first.id, vectors: [new Float32Array([0, 1])] });
    expect(Array.from(await q)).toEqual([1, 0]);
    expect((await a).map((v) => Array.from(v))).toEqual([[0, 1]]);
  });

  it("fails pending calls when stopped", async () => {
    const worker = new FakeWorker();
    const client = createEmbedClient(() => worker);
    const call = client.embed(["one"]);
    client.terminate();
    await expect(call).rejects.toThrow();
    expect(worker.terminated).toBe(true);
  });
});
