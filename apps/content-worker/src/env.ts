export interface R2ObjectBodyLike {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  size: number;
}

export interface R2PutOptions {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>;
  put(key: string, value: ArrayBuffer | Uint8Array, options?: R2PutOptions): Promise<unknown>;
}

export interface Env {
  CONTENT: R2BucketLike;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  /** The website's shared secret, or (preferred) only its SHA-256 in lowercase hex. */
  SERVICE_SECRET?: string;
  SERVICE_SECRET_SHA256?: string;
  STORAGE_LIMIT_BYTES?: string | number;
}
