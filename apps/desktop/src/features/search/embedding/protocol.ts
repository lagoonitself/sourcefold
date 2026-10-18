// Messages between the app and the embedding worker.

export const MODEL_ID = "onnx-community/embeddinggemma-2-ONNX";
/** Cache Storage name Transformers.js uses (`env.cacheKey`); "Delete model" clears it. */
export const MODEL_CACHE_NAME = "transformers-cache";

export type EmbedDevice = "webgpu" | "wasm";

export type ToWorker =
  | { type: "load" }
  /** Background batch of documents; yields to queries between batches. */
  | { type: "embed"; id: number; texts: string[] }
  /** One query; runs before any waiting background batch. */
  | { type: "query"; id: number; text: string };

export type FromWorker =
  /** Download progress, 0 to 1, across all model files. */
  | { type: "progress"; progress: number }
  | { type: "device"; device: EmbedDevice }
  | { type: "ready"; device: EmbedDevice }
  | { type: "load-error"; message: string }
  | { type: "result"; id: number; vectors: Float32Array[] }
  | { type: "failure"; id: number; message: string };
