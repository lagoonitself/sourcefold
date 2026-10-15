import { browser } from "wxt/browser";

export const NATIVE_HOST_NAME = "com.sourcefold.native";
export const NATIVE_TIMEOUT_MS = 5000;

export async function sendNativeMessage<T>(
  payload: any,
  timeoutMs: number = NATIVE_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Native messaging timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const sendPromise = new Promise<T>((resolve, reject) => {
    try {
      const chromeRuntime = (globalThis as any)?.chrome?.runtime;

      if (typeof browser !== "undefined" && browser?.runtime?.sendNativeMessage) {
        browser.runtime
          .sendNativeMessage(NATIVE_HOST_NAME, payload)
          .then((res: any) => resolve(res))
          .catch((err: any) => {
            const error = err instanceof Error ? err : new Error(String(err));
            reject(error);
          });
      } else if (chromeRuntime?.sendNativeMessage) {
        chromeRuntime.sendNativeMessage(NATIVE_HOST_NAME, payload, (response: any) => {
          if (chromeRuntime.lastError) {
            reject(new Error(chromeRuntime.lastError.message || "Native messaging error"));
          } else {
            resolve(response);
          }
        });
      } else {
        reject(new Error("Native messaging is not supported in this environment"));
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      reject(error);
    }
  });

  try {
    const raw = (await Promise.race([sendPromise, timeoutPromise])) as any;
    if (raw === undefined || raw === null) {
      throw new Error("No response received from native messaging host");
    }
    if (typeof raw === "object") {
      const obj = raw as Record<string, any>;
      if ("error" in obj && obj.error) {
        const msg =
          typeof obj.error === "string"
            ? obj.error
            : obj.error?.message || JSON.stringify(obj.error);
        const err: any = new Error(msg);
        if (typeof obj.error === "object") {
          err.code = obj.error.code;
          err.folderName = obj.error.folder_name;
        }
        throw err;
      }
      if ("ok" in obj && obj.ok === false) {
        throw new Error(obj.error || "Native messaging request failed");
      }
      if ("data" in obj && obj.data !== undefined) {
        return obj.data as T;
      }
    }
    return raw as T;
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}
