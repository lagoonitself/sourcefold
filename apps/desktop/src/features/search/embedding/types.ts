export type MeaningState = "off" | "downloading" | "loading" | "ready" | "error";

export interface MeaningSearchInfo {
  /** The owner's switch in Settings → Search. */
  enabled: boolean;
  state: MeaningState;
  /** "webgpu" (GPU) or "wasm" (CPU) once the model has loaded. */
  device: "webgpu" | "wasm" | null;
  /** Download progress 0–1 while downloading. */
  progress: number | null;
  message: string | null;
  /** Measured while the background loop is embedding. */
  passagesPerSecond: number | null;
}
