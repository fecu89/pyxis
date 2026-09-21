"use client";

import { useLayoutEffect, useRef } from "react";

/** 입력 내용만큼 자라되 카드나 모바일 화면을 끝없이 밀지 않도록 지정 높이에서 멈춥니다. */
export function useAutoResizeTextarea(value: string, maximumHeight: number, active = true) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (!active) return;
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    const nextHeight = Math.min(textarea.scrollHeight, maximumHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maximumHeight ? "auto" : "hidden";
  }, [active, maximumHeight, value]);

  return ref;
}
