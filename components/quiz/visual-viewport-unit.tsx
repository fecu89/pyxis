"use client";

import { useEffect } from "react";

// dvh는 "브라우저 UI(주소창)"만 반영하고 가상 키보드는 반영하지 못하는 브라우저가 있습니다
// (iOS 사파리가 대표적 — 키보드는 뷰포트를 덮을 뿐 dvh를 줄이지 않습니다). 실제로 보이는
// 높이는 visualViewport가 유일하게 정확해서, 그 값을 --vvh로 흘려 h-[var(--vvh,100dvh)]처럼
// 씁니다. 값이 없거나 스크립트가 늦는 동안에는 100dvh 폴백이 동작합니다.
export function VisualViewportUnit() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    // scale을 곱해야 핀치줌에 면역이 됩니다. 줌인하면 height는 절반이 되지만 scale이 2가 되어
    // 곱은 레이아웃 기준 높이로 유지됩니다(키보드·주소창 변화는 scale=1이라 그대로 반영).
    // 곱하지 않으면 줌 순간 --vvh가 쪼그라들어 화면 아래 여백과 스크롤이 생깁니다.
    const update = () => document.documentElement.style.setProperty("--vvh", `${viewport.height * viewport.scale}px`);
    viewport.addEventListener("resize", update);
    // iOS는 키보드가 뜰 때 resize 없이 스크롤 오프셋만 바뀌는 경우가 있어 scroll도 함께 듣습니다.
    viewport.addEventListener("scroll", update);
    update();
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      document.documentElement.style.removeProperty("--vvh");
    };
  }, []);
  return null;
}
