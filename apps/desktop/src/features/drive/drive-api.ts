import { isRemoteConfigured, remoteFetch } from "@/lib/remote-client";
import type { DriveSaveResult, DriveStatus } from "./types";

/**
 * Queries the Drive status endpoint (/api/drive/status) on the configured remote URL.
 * In offline mode or when not signed in, Google Drive sync is disabled.
 */
export async function fetchDriveStatus(): Promise<DriveStatus> {
  if (!isRemoteConfigured()) {
    return {
      unsaved: 0,
      last_saved_at: null,
      root_folder_id: null,
      connected: false,
    };
  }

  try {
    return await remoteFetch<DriveStatus>("/api/drive/status");
  } catch (err: any) {
    return {
      unsaved: 0,
      last_saved_at: null,
      root_folder_id: null,
      connected: false,
      error: err?.message || "Failed to reach remote Drive sync endpoint",
    };
  }
}

/**
 * Queries POST /api/drive/save to trigger a Drive synchronization.
 */
export async function triggerDriveSave(budget?: number): Promise<DriveSaveResult> {
  if (!isRemoteConfigured()) {
    return {
      processed: 0,
      remaining: 0,
      done: true,
      failed: [],
    };
  }

  const body = JSON.stringify(budget !== undefined ? { budget } : {});
  return await remoteFetch<DriveSaveResult>("/api/drive/save", {
    method: "POST",
    body,
  });
}
