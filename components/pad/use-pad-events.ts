"use client";

import { useEffect, useRef, useState } from "react";
import type { BoardEvent } from "@/lib/realtime/board-events";

/**
 * 패드 SSE 연결만 관리합니다. 이벤트는 호출자가 로컬 상태에 적용하고, 재연결처럼 이벤트를
 * 놓쳤을 가능성이 있을 때만 onResync가 전용 JSON 스냅샷을 가져옵니다. Server Component
 * 전체를 다시 실행하는 router refresh는 이 경로에서 사용하지 않습니다.
 */
export function usePadEvents(
  boardId: string,
  onEvent?: (event: BoardEvent) => void,
  onResync?: () => void,
  identityKey?: string | null,
) {
  const eventHandler = useRef(onEvent);
  const resyncHandler = useRef(onResync);
  const previousIdentityKey = useRef(identityKey);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    eventHandler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    resyncHandler.current = onResync;
  }, [onResync]);

  useEffect(() => {
    // 이 라우트도 뷰어당 연결을 6개로 제한하고 넘으면 429를 돌려줍니다. EventSource는 비-2xx를
    // 받으면 스스로 재연결하지 않고 CLOSED로 끝낼 수 있어 지수 백오프로 직접 다시 엽니다.
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;
    let hasConnectedBefore = false;
    let syncAfterVisibilityPause = document.visibilityState !== "visible";
    let syncAfterConnectionError = false;
    const identityChanged = previousIdentityKey.current !== identityKey;
    previousIdentityKey.current = identityKey;

    const handleChange = (message: MessageEvent<string>) => {
      try {
        eventHandler.current?.(JSON.parse(message.data) as BoardEvent);
      } catch {
        // 손상되거나 미래 버전의 이벤트 하나 때문에 전체 페이지를 새로고침하지 않습니다.
        // 현재 사용자가 볼 수 있는 패드 데이터만 다시 받아 정본으로 수렴합니다.
        resyncHandler.current?.();
      }
    };

    const handleReady = () => {
      setConnected(true);
      attempt = 0;
      const shouldSync = hasConnectedBefore || syncAfterVisibilityPause || syncAfterConnectionError || identityChanged;
      hasConnectedBefore = true;
      syncAfterVisibilityPause = false;
      syncAfterConnectionError = false;
      if (shouldSync) resyncHandler.current?.();
    };

    const connect = () => {
      // 보이지 않는 탭은 연결을 놓고, 돌아올 때 전용 스냅샷 한 번으로 그 사이 변경에 수렴합니다.
      if (disposed || document.visibilityState !== "visible") return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      source?.close();
      source = new EventSource(`/api/boards/${boardId}/events`);
      source.addEventListener("ready", handleReady);
      source.addEventListener("board-change", handleChange);
      source.addEventListener("error", () => {
        setConnected(false);
        syncAfterConnectionError = true;
        if (disposed || document.visibilityState !== "visible" || source?.readyState !== EventSource.CLOSED) return;
        source.close();
        source = null;
        attempt += 1;
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 5 * 60_000);
        retryTimer = setTimeout(connect, backoff * (0.7 + Math.random() * 0.6));
      });
    };

    const onVisibilityChange = () => {
      if (disposed) return;
      if (document.visibilityState !== "visible") {
        syncAfterVisibilityPause = true;
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        source?.close();
        source = null;
        setConnected(false);
        return;
      }
      if (source === null || source.readyState === EventSource.CLOSED) {
        attempt = 0;
        connect();
      }
    };

    if (document.visibilityState === "visible") connect();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
      source = null;
    };
  }, [boardId, identityKey]);

  return connected;
}
