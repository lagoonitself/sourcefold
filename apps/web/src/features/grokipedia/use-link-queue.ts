"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export type QueueItemStatus = "waiting" | "saving" | "saved" | "duplicate" | "failed";

export interface QueueItem {
  id: string;
  url: string;
  title?: string;
  status: QueueItemStatus;
  message?: string;
  savedItem?: { id: string; title: string; folder_id: string };
  duplicateItem?: { folder_id: string; folder_name?: string };
}

export type QueueState = "idle" | "running" | "stopped" | "finished";

export function useLinkQueue() {
  const router = useRouter();

  const [items, setItems] = useState<QueueItem[]>([]);
  const [status, setStatus] = useState<QueueState>("idle");
  const [isStopping, setIsStopping] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  const itemsRef = useRef<QueueItem[]>([]);
  const isRunningRef = useRef(false);
  const isStoppingRef = useRef(false);
  const statusRef = useRef<QueueState>("idle");
  const folderIdRef = useRef<string>("");
  const sessionExpiredRef = useRef(false);
  const runIdRef = useRef(0);

  const updateItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    itemsRef.current = itemsRef.current.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    );
    setItems([...itemsRef.current]);
  }, []);

  const runQueue = useCallback(async () => {
    if (isRunningRef.current) return;
    if (sessionExpiredRef.current) return;

    const currentRunId = ++runIdRef.current;
    isRunningRef.current = true;
    isStoppingRef.current = false;
    setIsStopping(false);
    statusRef.current = "running";
    setStatus("running");

    let savedInThisRun = 0;
    let batchSavesSinceRefresh = 0;

    try {
      while (
        !isStoppingRef.current &&
        !sessionExpiredRef.current &&
        runIdRef.current === currentRunId
      ) {
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
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: currentItem.url,
              folder_id: folderIdRef.current,
            }),
          });
          json = await res.json();
        } catch {
          fetchFailed = true;
        }

        // Abort processing if queue was reset or superseded while fetching
        if (runIdRef.current !== currentRunId) {
          break;
        }

        if (res?.status === 401) {
          sessionExpiredRef.current = true;
          setSessionExpired(true);
          updateItem(currentItem.id, {
            status: "failed",
            message: "Session expired. Sign in again to continue saving.",
          });
          toast.error("Session expired. Sign in again to continue saving.");
          break;
        }

        if (fetchFailed || !res) {
          updateItem(currentItem.id, {
            status: "failed",
            message: "Could not reach server. Check your connection and retry.",
          });
        } else if (res.status === 409) {
          updateItem(currentItem.id, {
            status: "duplicate",
            message: json?.error?.message ?? "Already saved",
            duplicateItem: {
              folder_id: "",
              folder_name: json?.folder_name ?? json?.error?.message ?? undefined,
            },
          });
        } else if (res.ok && json?.data?.item) {
          const item = json.data.item;
          updateItem(currentItem.id, {
            status: "saved",
            title: item.title || undefined,
            savedItem: {
              id: item.id || "",
              title: item.title || "",
              folder_id: item.folder_id || folderIdRef.current,
            },
          });
          savedInThisRun++;
          batchSavesSinceRefresh++;

          if (batchSavesSinceRefresh >= 3) {
            batchSavesSinceRefresh = 0;
            router.refresh();
          }
        } else {
          errorMessage = json?.error?.message ?? `Saving failed (${res.status}). Try again.`;
          updateItem(currentItem.id, {
            status: "failed",
            message: errorMessage,
          });
        }

        const hasMoreWaiting = itemsRef.current.some((item) => item.status === "waiting");
        if (
          hasMoreWaiting &&
          !isStoppingRef.current &&
          !sessionExpiredRef.current &&
          runIdRef.current === currentRunId
        ) {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
    } finally {
      if (runIdRef.current === currentRunId) {
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
    runIdRef.current++;
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
