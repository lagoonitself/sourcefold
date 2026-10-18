/// <reference lib="webworker" />
// Loads EmbeddingGemma 2 (text only) and embeds documents and queries off the main thread.
// WebGPU first; if it can't start or its first run fails, the CPU (WASM) takes over.

import { AutoConfig, AutoModel, AutoTokenizer, env } from "@huggingface/transformers";
import { EMBEDDING_DIMS } from "../search-api";
import {
  MODEL_CACHE_NAME,
  MODEL_ID,
  type EmbedDevice,
  type FromWorker,
  type ToWorker,
} from "./protocol";
import {
  BATCH_TOKEN_BUDGET,
  MAX_INPUT_TOKENS,
  planSortedBatches,
  truncateAndNormalize,
} from "./vectors";

// The library's types are loose for this model; these stay untyped on purpose.
type Model = any;
type Tokenizer = any;

const ctx = self as unknown as DedicatedWorkerGlobalScope;
env.cacheKey = MODEL_CACHE_NAME;

function post(message: FromWorker, transfer: Transferable[] = []) {
  ctx.postMessage(message, transfer);
}

function messageOf(error: unknown): string {
  return String((error as Error)?.message ?? error);
}

let tokenizer: Tokenizer | null = null;
let model: Model | null = null;
let device: EmbedDevice | null = null;
let loading: Promise<void> | null = null;

async function webGpuAvailable(): Promise<boolean> {
  const gpu = (ctx.navigator as any).gpu;
  if (!gpu) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function textOnlyConfig(): Promise<any> {
  const config: any = await AutoConfig.from_pretrained(MODEL_ID);
  config.vision_config = config.audio_config = null; // text only (175 MB at q4)
  return config;
}

async function loadModel(target: EmbedDevice, config: any): Promise<Model> {
  return AutoModel.from_pretrained(MODEL_ID, {
    config,
    device: target,
    dtype: "q4",
    progress_callback: (info: any) => {
      if (info?.status === "progress_total" && typeof info.progress === "number") {
        post({ type: "progress", progress: Math.min(1, Math.max(0, info.progress / 100)) });
      }
    },
  });
}

async function disposeModel() {
  const old = model;
  model = null;
  try {
    await old?.dispose?.();
  } catch {
    // Nothing useful to do if freeing fails.
  }
}

async function start(): Promise<void> {
  const config = await textOnlyConfig();
  tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);

  if (await webGpuAvailable()) {
    try {
      model = await loadModel("webgpu", config);
      device = "webgpu";
      await runBatch(["warm up"]); // a broken GPU path shows up on the first run
      post({ type: "device", device });
      return;
    } catch (error) {
      console.warn("WebGPU failed, using the CPU instead", error);
      await disposeModel();
    }
  }
  model = await loadModel("wasm", config);
  device = "wasm";
  post({ type: "device", device });
}

/** Resolves once the model is ready; a failed attempt can be retried by asking again. */
function ensureLoaded(): Promise<void> {
  if (!loading) {
    loading = start().then(
      () => post({ type: "ready", device: device as EmbedDevice }),
      (error) => {
        loading = null;
        tokenizer = null;
        void disposeModel();
        throw error;
      },
    );
  }
  return loading;
}

async function countTokens(text: string): Promise<number> {
  const encoded = await tokenizer(text, { truncation: true, max_length: MAX_INPUT_TOKENS });
  return encoded.input_ids.dims[1] as number;
}

async function runBatch(texts: string[]): Promise<Float32Array[]> {
  const inputs = await tokenizer(texts, {
    padding: true,
    truncation: true,
    max_length: MAX_INPUT_TOKENS,
  });
  const output = await model(inputs);
  const tensor = output.sentence_embedding;
  const [rows, width] = tensor.dims as [number, number];
  const data = (
    tensor.location && tensor.location !== "cpu" ? await tensor.ort_tensor.getData() : tensor.data
  ) as Float32Array;
  const vectors: Float32Array[] = [];
  for (let r = 0; r < rows; r++) {
    const row = data.subarray(r * width, r * width + EMBEDDING_DIMS);
    vectors.push(truncateAndNormalize(row));
  }
  for (const value of Object.values(output) as any[]) {
    try {
      value?.dispose?.();
    } catch {
      // Already freed.
    }
  }
  return vectors;
}

/** One batch, with a single move to the CPU if the GPU fails after it had started. */
async function runWithFallback(texts: string[]): Promise<Float32Array[]> {
  try {
    return await runBatch(texts);
  } catch (error) {
    if (device !== "webgpu") throw error;
    console.warn("WebGPU run failed, using the CPU instead", error);
    await disposeModel();
    model = await loadModel("wasm", await textOnlyConfig());
    device = "wasm";
    post({ type: "device", device });
    return runBatch(texts);
  }
}

interface BackgroundJob {
  id: number;
  texts: string[];
  batches: number[][] | null;
  next: number;
  results: Float32Array[];
}

const queries: { id: number; text: string }[] = [];
const background: BackgroundJob[] = [];
let pumping = false;

async function handleQuery(query: { id: number; text: string }) {
  try {
    await ensureLoaded();
    const [vector] = await runWithFallback([query.text]);
    post({ type: "result", id: query.id, vectors: [vector] }, [vector.buffer]);
  } catch (error) {
    post({ type: "failure", id: query.id, message: messageOf(error) });
  }
}

async function stepBackground(job: BackgroundJob) {
  try {
    await ensureLoaded();
    if (!job.batches) {
      const counts = await Promise.all(job.texts.map(countTokens));
      job.batches = planSortedBatches(counts, BATCH_TOKEN_BUDGET, MAX_INPUT_TOKENS);
    }
    const batch = job.batches[job.next++];
    if (batch) {
      const vectors = await runWithFallback(batch.map((i) => job.texts[i]));
      batch.forEach((index, k) => (job.results[index] = vectors[k]));
    }
    if (job.next >= job.batches.length) {
      background.shift();
      post(
        { type: "result", id: job.id, vectors: job.results },
        job.results.map((v) => v.buffer),
      );
    }
  } catch (error) {
    background.shift();
    post({ type: "failure", id: job.id, message: messageOf(error) });
  }
}

// One batch at a time, so a query that arrives mid-job runs before the next background batch.
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const query = queries.shift();
      if (query) {
        await handleQuery(query);
        continue;
      }
      const job = background[0];
      if (!job) break;
      await stepBackground(job);
    }
  } finally {
    pumping = false;
  }
}

ctx.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case "load":
      ensureLoaded().catch((error) => post({ type: "load-error", message: messageOf(error) }));
      break;
    case "query":
      queries.push({ id: message.id, text: message.text });
      void pump();
      break;
    case "embed":
      background.push({
        id: message.id,
        texts: message.texts,
        batches: null,
        next: 0,
        results: [],
      });
      void pump();
      break;
  }
};
