export interface DriveStatus {
  unsaved: number;
  last_saved_at: string | null;
  root_folder_id: string | null;
  connected: boolean;
  is_syncing?: boolean;
  error?: string | null;
}

export interface DriveSaveResult {
  processed: number;
  remaining: number;
  done: boolean;
  failed: Array<{
    id: string;
    title: string;
    message: string;
  }>;
}
