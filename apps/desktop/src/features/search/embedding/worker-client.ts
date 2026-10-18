// Promise-based calls to the one shared embedding worker. The worker starts on first use.

import { describeEmbeddingError } from "./errors";
import type { EmbedDevice, FromWorker, ToWorker } from "./protocol";
import { patchInfo } from "./store";

interface Pending {
  resolve: (vectors: Float32Array[]) => void;
  reject: (error: Error) => void;
}

/** The slice of `Worker` the client uses, so tests can pass a fake. */
export interface WorkerLike {
  postMessage(message: ToWorker): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface EmbedClient {
  /** Starts the worker if needed and resolves when the model can answer. */
  load(): Promise<EmbedDevice>;
  embed(texts: string[]): Promise<Float32Array[]>;
  query(text: string): Promise<Float32Array>;
  /** Stops the worker and frees the model's memory. Pending calls fail. */
  terminate(): void;
  isReady(): boolean;
}

export function createEmbedClient(createWorker: () => WorkerLike): EmbedClient {
  let worker: WorkerLike | null = null;
  let loadPromise: Promise<EmbedDevice> | null = null;
  let ready = false;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  let settleLoad: { resolve: (d: EmbedDevice) => void; reject: (e: Error) => void } | null = null;

  function failAll(error: Error) {
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  }

  function failLoad(message: string) {
    ready = false;
    loadPromise = null;
    patchInfo({ state: "error", progress: null, message });
    settleLoad?.reject(new Error(message));
    settleLoad = null;
  }

  function handle(message: FromWorker) {
    switch (message.type) {
      case "progress":
        if (!ready) {
          patchInfo(
            message.progress < 1
              ? { state: "downloading", progress: message.progress }
              : { state: "loading", progress: null },
          );
        }
        break;
      case "device":
        patchInfo({ device: message.device });
        break;
      case "ready":
        ready = true;
        patchInfo({ state: "ready", device: message.device, progress: null, message: null });
        settleLoad?.resolve(message.device);
        settleLoad = null;
        break;
      case "load-error":
        failLoad(describeEmbeddingError(new Error(message.message)));
        break;
      case "result": {
        const call = pending.get(message.id);
        pending.delete(message.id);
        call?.resolve(message.vectors);
        break;
      }
      case "failure": {
        const call = pending.get(message.id);
        pending.delete(message.id);
        call?.reject(new Error(message.message));
        break;
      }
    }
  }

  function ensureWorker(): WorkerLike {
    if (worker) return worker;
    const created = createWorker();
    created.onmessage = (event) => handle(event.data);
    created.onerror = (event) => {
      // The worker itself died (out of memory, a script error). The next call starts a new one.
      const message = describeEmbeddingError(new Error(event.message));
      worker?.terminate();
      worker = null;
      failAll(new Error(message));
      failLoad(message);
    };
    worker = created;
    return created;
  }

  function call(message: (id: number) => ToWorker): Promise<Float32Array[]> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        ensureWorker().postMessage(message(id));
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  return {
    load() {
      if (ready && loadPromise) return loadPromise;
      if (!loadPromise) {
        patchInfo({ state: "loading", message: null });
        loadPromise = new Promise<EmbedDevice>((resolve, reject) => {
          settleLoad = { resolve, reject };
        });
        // Callers that don't wait for the promise shouldn't trigger an unhandled rejection.
        loadPromise.catch(() => {});
        try {
          ensureWorker().postMessage({ type: "load" });
        } catch (error) {
          failLoad(describeEmbeddingError(error));
        }
      }
      return loadPromise ?? Promise.reject(new Error("The model didn't start."));
    },
    embed: (texts) => call((id) => ({ type: "embed", id, texts })),
    async query(text) {
      const [vector] = await call((id) => ({ type: "query", id, text }));
      return vector;
    },
    terminate() {
      worker?.terminate();
      worker = null;
      ready = false;
      loadPromise = null;
      settleLoad?.reject(new Error("Search by meaning was stopped."));
      settleLoad = null;
      failAll(new Error("Search by meaning was stopped."));
    },
    isReady: () => ready,
  };
}

let shared: EmbedClient | null = null;

/** The single worker for the app. */
export function getEmbedClient(): EmbedClient {
  shared ??= createEmbedClient(
    () =>
      new Worker(new URL("./embed.worker.ts", import.meta.url), {
        type: "module",
      }) as unknown as WorkerLike,
  );
  return shared;
}

/** Stops the shared worker if it was ever started. */
export function terminateEmbedClient(): void {
  shared?.terminate();
}
