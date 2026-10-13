"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export type QueueItemStatus = "waiting" | "saving" | "saved" | "duplicate" | "failed";

export type QueueItem = {
  id: string;
  url: string;
  title?: string;
  status: QueueItemStatus;
  message?: string;
};

export type QueueState = "idle" | "running" | "stopped" | "finished";

export function useLinkQueue() {
  const router = useRouter();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [status, setStatus] = useState<QueueState>("idle");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  const itemsRef = useRef<QueueItem[]>([]);
  const statusRef = useRef<QueueState>("idle");
  const isStoppingRef = useRef(false);
  const isRunningRef = useRef(false);
  const folderIdRef = useRef<string>("");
  const sessionExpiredRef = useRef(false);

  const updateItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    itemsRef.current = itemsRef.current.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    );
    setItems([...itemsRef.current]);
  }, []);

  const runQueue = useCallback(async () => {
    if (isRunningRef.current) return;
    if (sessionExpiredRef.current) return;

    isRunningRef.current = true;
    isStoppingRef.current = false;
    setIsStopping(false);
    statusRef.current = "running";
    setStatus("running");

    let savedInThisRun = 0;
    let batchSavesSinceRefresh = 0;

    try {
      while (!isStoppingRef.current && !sessionExpiredRef.current) {
        const nextIndex = itemsRef.current.findIndex((item) => item.status === "waiting");
        if (nextIndex === -1) {
          break;
        }

        const currentItem = itemsRef.current[nextIndex];
        updateItem(currentItem.id, { status: "saving" });

        let res: Response | null = null;
        let json: {
          data?: { item?: { id?: string; title?: string; folder_id?: string } };
          error?: { message?: string; code?: string };
          folder_name?: string;
        } | null = null;
        let fetchFailed = false;
        let errorMessage: string | null = null;

        try {
          res = await fetch("/api/grokipedia", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              url: currentItem.url,
              folder_id: folderIdRef.current,
            }),
          });

          try {
            json = await res.json();
          } catch {
            json = null;
          }
        } catch (err: unknown) {
          fetchFailed = true;
          errorMessage = err instanceof Error ? err.message : "Network error";
        }

        if (fetchFailed || !res) {
          updateItem(currentItem.id, {
            status: "failed",
            message: errorMessage ?? "Failed to reach server.",
          });
        } else if (res.status === 401) {
          const msg = json?.error?.message ?? "Your session ended. Sign in again.";
          updateItem(currentItem.id, {
            status: "failed",
            message: msg,
          });
          sessionExpiredRef.current = true;
          setSessionExpired(true);
          isStoppingRef.current = true;
          break;
        } else if (res.status === 201 || (res.ok && json?.data?.item)) {
          const title = json?.data?.item?.title;
          updateItem(currentItem.id, {
            status: "saved",
            title: title || undefined,
          });
          savedInThisRun += 1;
          batchSavesSinceRefresh += 1;
          if (batchSavesSinceRefresh >= 5) {
            router.refresh();
            batchSavesSinceRefresh = 0;
          }
        } else if (res.status === 409 || json?.error?.code === "duplicate") {
          const duplicateMsg =
            json?.error?.message ??
            (json?.folder_name ? `Already saved in "${json.folder_name}".` : "Already saved.");
          updateItem(currentItem.id, {
            status: "duplicate",
            message: duplicateMsg,
          });
        } else {
          const msg = json?.error?.message ?? "Failed to save link.";
          updateItem(currentItem.id, {
            status: "failed",
            message: msg,
          });
        }

        const hasMoreWaiting = itemsRef.current.some((item) => item.status === "waiting");
        if (hasMoreWaiting && !isStoppingRef.current && !sessionExpiredRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
    } finally {
      isRunningRef.current = false;
      setIsStopping(false);

      const hasWaiting = itemsRef.current.some((item) => item.status === "waiting");
      const nextStatus: QueueState = isStoppingRef.current && hasWaiting ? "stopped" : "finished";
      statusRef.current = nextStatus;
      setStatus(nextStatus);

      router.refresh();

      if (savedInThisRun > 0) {
        toast.success(savedInThisRun === 1 ? "Added 1 link" : `Added ${savedInThisRun} links`);
      }
    }
  }, [router, updateItem]);

  const start = useCallback(
    (urls: string[], folderId: string) => {
      if (urls.length === 0 || !folderId) return;

      const newItems: QueueItem[] = urls.map((url, index) => ({
        id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        url,
        status: "waiting",
      }));

      folderIdRef.current = folderId;
      itemsRef.current = newItems;
      setItems(newItems);
      isStoppingRef.current = false;
      setIsStopping(false);
      sessionExpiredRef.current = false;
      setSessionExpired(false);

      void runQueue();
    },
    [runQueue],
  );

  const stop = useCallback(() => {
    if (!isRunningRef.current) return;
    isStoppingRef.current = true;
    setIsStopping(true);
  }, []);

  const retry = useCallback(
    (itemId: string) => {
      if (sessionExpiredRef.current) return;

      itemsRef.current = itemsRef.current.map((item) =>
        item.id === itemId ? { ...item, status: "waiting" as const, message: undefined } : item,
      );
      setItems([...itemsRef.current]);

      if (!isRunningRef.current) {
        void runQueue();
      }
    },
    [runQueue],
  );

  const reset = useCallback(() => {
    isStoppingRef.current = true;
    isRunningRef.current = false;
    itemsRef.current = [];
    setItems([]);
    statusRef.current = "idle";
    setStatus("idle");
    setIsStopping(false);
    sessionExpiredRef.current = false;
    setSessionExpired(false);
  }, []);

  const savedCount = items.filter((item) => item.status === "saved").length;
  const totalCount = items.length;

  return {
    items,
    status,
    isRunning: status === "running",
    isStopping,
    sessionExpired,
    savedCount,
    totalCount,
    start,
    stop,
    retry,
    reset,
  };
}
