import type { ItemTldr, ItemTldrInput } from "@sourcefold/core";
import { isTauri, shouldUseTauri } from "@/lib/api";
import { isRemoteConfigured, remoteFetch } from "@/lib/remote-client";

// TL;DRs (docs/dev/PLAN-tldr.md). Storage follows the app's mode: offline the SQLite table
// (Rust `list_tldrs`/`put_tldr`/`delete_tldr`), signed in `/api/tldrs` in the local API. The model
// is always called from Rust (`ai_*`, `chatgpt_*`), which keeps the keys and tokens.

export type AiProviderId = "chatgpt" | "openrouter" | "opencode";

export interface ModelChoice {
  id: string;
  name: string;
}

export interface ProviderStatus {
  id: AiProviderId;
  name: string;
  connected: boolean;
  account: string | null;
  plan_usage: boolean | null;
  model: ModelChoice | null;
}

export interface AiStatus {
  provider: AiProviderId | null;
  ready: boolean;
  providers: ProviderStatus[];
}

export interface ModelInfo {
  id: string;
  name: string;
  free: boolean;
  price_in: number | null;
  price_out: number | null;
  context: number | null;
}

export interface Completion {
  text: string;
  model: string;
  provider: AiProviderId;
}

export type AiErrorCode =
  | "not_configured"
  | "auth"
  | "not_eligible"
  | "limit"
  | "unavailable"
  | "bad_request"
  | "cancelled"
  | "network"
  | "other";

/** A failed model call, with what kind of failure it was. */
export class AiCallError extends Error {
  readonly code: AiErrorCode;
  readonly retryAfter: number | null;
  constructor(code: AiErrorCode, message: string, retryAfter: number | null = null) {
    super(message);
    this.name = "AiCallError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

function toAiError(err: unknown): AiCallError {
  if (err instanceof AiCallError) return err;
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const e = err as { code: string; message: string; retry_after?: number | null };
    return new AiCallError(e.code as AiErrorCode, String(e.message), e.retry_after ?? null);
  }
  return new AiCallError("other", err instanceof Error ? err.message : String(err));
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new AiCallError("not_configured", "TL;DRs need the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    throw toAiError(err);
  }
}

// ----------------- Storage -----------------

export async function listTldrs(
  scope: { folderId: string } | { projectId: string },
): Promise<ItemTldr[]> {
  if (shouldUseTauri()) {
    return await tauriInvoke<ItemTldr[]>("list_tldrs", {
      folderId: "folderId" in scope ? scope.folderId : undefined,
      projectId: "projectId" in scope ? scope.projectId : undefined,
    });
  }
  if (!isRemoteConfigured()) return [];
  const query =
    "folderId" in scope
      ? `folder=${encodeURIComponent(scope.folderId)}`
      : `project=${encodeURIComponent(scope.projectId)}`;
  return await remoteFetch<ItemTldr[]>(`/api/tldrs?${query}`);
}

export async function putTldr(itemId: string, input: ItemTldrInput): Promise<ItemTldr> {
  if (shouldUseTauri()) {
    return await tauriInvoke<ItemTldr>("put_tldr", { itemId, input });
  }
  return await remoteFetch<ItemTldr>(`/api/tldrs/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteTldr(itemId: string): Promise<void> {
  if (shouldUseTauri()) {
    await tauriInvoke<null>("delete_tldr", { itemId });
    return;
  }
  await remoteFetch<unknown>(`/api/tldrs/${encodeURIComponent(itemId)}`, { method: "DELETE" });
}

// ----------------- The model -----------------

export function getAiStatus(): Promise<AiStatus> {
  return tauriInvoke<AiStatus>("ai_status");
}

export function setAiProvider(provider: AiProviderId): Promise<AiStatus> {
  return tauriInvoke<AiStatus>("ai_set_provider", { provider });
}

export function setAiModel(provider: AiProviderId, model: ModelChoice | null): Promise<AiStatus> {
  return tauriInvoke<AiStatus>("ai_set_model", {
    provider,
    modelId: model?.id ?? null,
    modelName: model?.name ?? null,
  });
}

export function setAiApiKey(provider: AiProviderId, key: string): Promise<AiStatus> {
  return tauriInvoke<AiStatus>("ai_set_api_key", { provider, key });
}

export function clearAiApiKey(provider: AiProviderId): Promise<AiStatus> {
  return tauriInvoke<AiStatus>("ai_clear_api_key", { provider });
}

export function listAiModels(provider: AiProviderId): Promise<ModelInfo[]> {
  return tauriInvoke<ModelInfo[]>("ai_list_models", { provider });
}

export function aiComplete(instructions: string, input: string): Promise<Completion> {
  return tauriInvoke<Completion>("ai_complete", { instructions, input });
}

export function chatgptSignIn(): Promise<AiStatus> {
  return tauriInvoke<AiStatus>("chatgpt_sign_in");
}

export function chatgptCancelSignIn(): Promise<void> {
  return tauriInvoke<void>("chatgpt_cancel_sign_in");
}

export function chatgptSignOut(): Promise<AiStatus> {
  return tauriInvoke<AiStatus>("chatgpt_sign_out");
}
