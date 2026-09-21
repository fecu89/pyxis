"use client";

import { useEffect, useRef, useState } from "react";

// 목록 항목을 끌어서 순서를 바꾸는 훅. 퀴즈 편집기의 문제 썸네일 레일과 설문 편집기의 질문
// 카드 목록이 함께 씁니다. 원래는 quiz-editor.tsx 안의 `useThumbnailDrag`였습니다.
//
// HTML5 Drag and Drop을 쓰지 않은 이유 — 터치에서 아예 동작하지 않고, 목록 가장자리에서
// 자동 스크롤을 넣을 방법이 없습니다. 둘 다 이 화면에서는 없으면 안 되는 것입니다.
// (@dnd-kit도 의존성에 있지만 패드 보드가 쓰는 설정과 요구가 달라 여기서는 쓰지 않습니다.
//  이 훅은 "끌어서 순서만 바꾸기"에 필요한 것만 담아 훨씬 작습니다.)
//
// 다루는 까다로운 지점 셋:
//   1. 마우스는 6px 움직이면 바로 시작하지만, 터치는 280ms 길게 누른 뒤에만 시작합니다.
//      터치에서 즉시 시작하면 목록을 스크롤하려는 손짓이 전부 드래그가 됩니다.
//   2. 목록이 스크롤돼도 카드가 손가락을 따라오도록 스크롤 변화량을 매 프레임 보정합니다.
//   3. 드래그가 끝나면 브라우저가 click을 한 번 더 보냅니다. 그대로 두면 "놓은 자리의 항목이
//      선택됨"으로 오작동해서, 캡처 단계에서 한 번 삼킵니다.

export type ListDragAxis = "x" | "y";

type ScrollTarget = HTMLElement | Window;

export type ListDrag = {
  /** 지금 끌고 있는 항목의 index. 없으면 null. */
  dragIndex: number | null;
  /** 강조선을 그릴 자리(그 index **앞**). 목록 길이면 맨 뒤, 제자리면 null. */
  indicator: number | null;
  handlePointerDown: (index: number) => (event: React.PointerEvent) => void;
  suppressClickAfterDrag: (event: React.MouseEvent) => void;
  setItemRef: (index: number) => (node: HTMLElement | null) => void;
};

/** 가장자리에서 자동 스크롤을 시작하는 폭(px)과 한 프레임 최대 이동량. */
const EDGE = 56;
const MAX_SCROLL_STEP = 20;
const TOUCH_HOLD_MS = 280;
const MOUSE_START_SLOP = 6;
const TOUCH_CANCEL_SLOP = 8;

export function useListDrag({ axis, count, listRef, onReorder }: {
  axis: ListDragAxis;
  count: number;
  listRef: React.RefObject<HTMLElement | null>;
  onReorder: (from: number, to: number) => void;
}): ListDrag {
  const itemRefs = useRef(new Map<number, HTMLElement>());
  const pointerRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{
    index: number;
    pointerId: number;
    startPos: number;
    startScroll: number;
    scrollTarget: ScrollTarget;
  } | null>(null);
  const holdRef = useRef<{ index: number; pointerId: number; x: number; y: number; timer: number } | null>(null);
  const pressRef = useRef<{ index: number; pointerId: number; x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const gapRef = useRef<number | null>(null);
  const draggedRecentlyRef = useRef(false);
  const countRef = useRef(count);
  const onReorderRef = useRef(onReorder);
  useEffect(() => {
    countRef.current = count;
    onReorderRef.current = onReorder;
  });
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [gap, setGap] = useState<number | null>(null);
  // 길게 누르기 타이머(렌더 바깥)에서 최신 beginDrag를 부를 수 있도록 ref로 연결합니다.
  const beginDragRef = useRef<(index: number, pointerId: number) => void>(() => { });

  useEffect(() => {
    const posOf = (x: number, y: number) => (axis === "y" ? y : x);
    const isWindow = (target: ScrollTarget): target is Window => target === window;
    const scrollOf = (target: ScrollTarget) => {
      if (isWindow(target)) return axis === "y" ? window.scrollY : window.scrollX;
      return axis === "y" ? target.scrollTop : target.scrollLeft;
    };
    const findScrollTarget = (list: HTMLElement): ScrollTarget => {
      let node: HTMLElement | null = list;
      while (node && node !== document.body && node !== document.documentElement) {
        const style = window.getComputedStyle(node);
        const overflow = axis === "y" ? style.overflowY : style.overflowX;
        const canScroll = axis === "y"
          ? node.scrollHeight > node.clientHeight + 1
          : node.scrollWidth > node.clientWidth + 1;
        if (/^(auto|scroll|overlay)$/.test(overflow) && canScroll) return node;
        node = node.parentElement;
      }
      return window;
    };
    const scrollBounds = (target: ScrollTarget) => {
      if (isWindow(target)) {
        return { start: 0, end: axis === "y" ? window.innerHeight : window.innerWidth };
      }
      const rect = target.getBoundingClientRect();
      const viewportEnd = axis === "y" ? window.innerHeight : window.innerWidth;
      return {
        start: Math.max(0, axis === "y" ? rect.top : rect.left),
        end: Math.min(viewportEnd, axis === "y" ? rect.bottom : rect.right),
      };
    };
    const scrollBy = (target: ScrollTarget, delta: number) => {
      if (isWindow(target)) {
        window.scrollBy(axis === "y" ? { top: delta } : { left: delta });
      } else if (axis === "y") {
        target.scrollTop += delta;
      } else {
        target.scrollLeft += delta;
      }
    };
    const blockTouchScroll = (event: TouchEvent) => event.preventDefault();
    const blockPointerScroll = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) event.preventDefault();
    };
    let touchScrollBlocked = false;
    const startBlockingTouchScroll = () => {
      if (touchScrollBlocked) return;
      touchScrollBlocked = true;
      window.addEventListener("pointermove", blockPointerScroll, { passive: false });
      window.addEventListener("touchmove", blockTouchScroll, { passive: false });
    };
    const stopBlockingTouchScroll = () => {
      if (!touchScrollBlocked) return;
      touchScrollBlocked = false;
      window.removeEventListener("pointermove", blockPointerScroll);
      window.removeEventListener("touchmove", blockTouchScroll);
    };

    const step = () => {
      const drag = dragRef.current;
      if (!drag) return;
      const list = listRef.current;
      const pos = posOf(pointerRef.current.x, pointerRef.current.y);
      if (list) {
        const { start, end } = scrollBounds(drag.scrollTarget);
        let delta = 0;
        if (pos < start + EDGE) delta = -Math.min(MAX_SCROLL_STEP, Math.ceil((start + EDGE - pos) / 3));
        else if (pos > end - EDGE) delta = Math.min(MAX_SCROLL_STEP, Math.ceil((pos - (end - EDGE)) / 3));
        if (delta) scrollBy(drag.scrollTarget, delta);
        const card = itemRefs.current.get(drag.index);
        if (card) {
          // 목록이나 페이지가 스크롤돼도 카드가 손가락을 계속 따라오도록 변화량을 보정합니다.
          const translate = pos - drag.startPos + (scrollOf(drag.scrollTarget) - drag.startScroll);
          card.style.transform = axis === "y" ? `translateY(${translate}px)` : `translateX(${translate}px)`;
        }
      }
      let nextGap = 0;
      for (let index = 0; index < countRef.current; index++) {
        if (index === drag.index) continue;
        const item = itemRefs.current.get(index);
        if (!item) continue;
        const rect = item.getBoundingClientRect();
        const mid = axis === "y" ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
        if (pos >= mid) nextGap += 1;
      }
      if (gapRef.current !== nextGap) {
        gapRef.current = nextGap;
        setGap(nextGap);
      }
      frameRef.current = requestAnimationFrame(step);
    };

    const beginDrag = (index: number, pointerId: number) => {
      const list = listRef.current;
      if (!list) return;
      const scrollTarget = findScrollTarget(list);
      dragRef.current = {
        index,
        pointerId,
        startPos: posOf(pointerRef.current.x, pointerRef.current.y),
        startScroll: scrollOf(scrollTarget),
        scrollTarget,
      };
      gapRef.current = null;
      setDragIndex(index);
      setGap(null);
      document.body.style.userSelect = "none";
      startBlockingTouchScroll();
      frameRef.current = requestAnimationFrame(step);
    };
    beginDragRef.current = beginDrag;

    const finishDrag = (commit: boolean) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      const card = itemRefs.current.get(drag.index);
      if (card) card.style.transform = "";
      document.body.style.userSelect = "";
      stopBlockingTouchScroll();
      draggedRecentlyRef.current = true;
      const to = gapRef.current;
      if (commit && to !== null && to !== drag.index) onReorderRef.current(drag.index, to);
      gapRef.current = null;
      setDragIndex(null);
      setGap(null);
    };

    const move = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      const hold = holdRef.current;
      if (hold && event.pointerId === hold.pointerId) {
        // 길게 누르기를 기다리는 중에 움직이면 스크롤 의도로 보고 놓아 줍니다.
        if (Math.abs(event.clientX - hold.x) > TOUCH_CANCEL_SLOP || Math.abs(event.clientY - hold.y) > TOUCH_CANCEL_SLOP) {
          window.clearTimeout(hold.timer);
          holdRef.current = null;
        }
        return;
      }
      const press = pressRef.current;
      if (press && event.pointerId === press.pointerId) {
        if (Math.abs(event.clientX - press.x) > MOUSE_START_SLOP || Math.abs(event.clientY - press.y) > MOUSE_START_SLOP) {
          pressRef.current = null;
          beginDrag(press.index, event.pointerId);
        }
        return;
      }
    };
    const up = (event: PointerEvent) => {
      if (holdRef.current?.pointerId === event.pointerId) { window.clearTimeout(holdRef.current.timer); holdRef.current = null; }
      if (pressRef.current?.pointerId === event.pointerId) pressRef.current = null;
      if (dragRef.current?.pointerId === event.pointerId) finishDrag(true);
    };
    const cancel = (event: PointerEvent) => {
      if (holdRef.current?.pointerId === event.pointerId) { window.clearTimeout(holdRef.current.timer); holdRef.current = null; }
      if (pressRef.current?.pointerId === event.pointerId) pressRef.current = null;
      if (dragRef.current?.pointerId === event.pointerId) finishDrag(false);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      stopBlockingTouchScroll();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (holdRef.current) window.clearTimeout(holdRef.current.timer);
      document.body.style.userSelect = "";
    };
    // axis는 컴포넌트별 상수이고 나머지는 ref로 읽으므로 등록은 한 번이면 됩니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis]);

  const handlePointerDown = (index: number) => (event: React.PointerEvent) => {
    if (!event.isPrimary) return;
    pointerRef.current = { x: event.clientX, y: event.clientY };
    if (event.pointerType === "mouse") {
      if (event.button !== 0) return;
      pressRef.current = { index, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      return;
    }
    holdRef.current = {
      index,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        holdRef.current = null;
        navigator.vibrate?.(10);
        beginDragRef.current(index, event.pointerId);
      }, TOUCH_HOLD_MS),
    };
  };

  // 드래그 직후 따라오는 click이 "선택"으로 오작동하지 않게 캡처 단계에서 삼킵니다.
  const suppressClickAfterDrag = (event: React.MouseEvent) => {
    if (!draggedRecentlyRef.current) return;
    draggedRecentlyRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const setItemRef = (index: number) => (node: HTMLElement | null) => {
    if (node) itemRefs.current.set(index, node);
    else itemRefs.current.delete(index);
  };

  // 강조선을 그릴 위치: 앞에 선을 그을 항목 index(= count면 마지막 뒤). 제자리 드롭이면 null.
  const indicator = dragIndex === null || gap === null || gap === dragIndex ? null : gap < dragIndex ? gap : gap + 1;
  return { dragIndex, indicator, handlePointerDown, suppressClickAfterDrag, setItemRef };
}
