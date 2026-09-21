"use client";

import { useCallback, useEffect, useRef } from "react";

/** 마지막 호출만 지연 실행합니다. 값 정규화는 호출부가 맡고, 항상 최신 콜백을 씁니다. */
export function useDebouncedCallback<Args extends unknown[]>(callback: (...args: Args) => void, delay = 200) {
  const callbackRef = useRef(callback);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const schedule = useCallback((...args: Args) => {
    cancel();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      callbackRef.current(...args);
    }, delay);
  }, [cancel, delay]);

  useEffect(() => cancel, [cancel, delay]);

  return { schedule, cancel };
}
