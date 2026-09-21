"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

type DragKind = "post" | "section";
type Point = { x: number; y: number };

const EDGE_SIZE = 64;
const MAX_SCROLL_STEP = 20;

function eventPoint(event: Event): Point | null {
  if ("touches" in event) {
    const touchEvent = event as TouchEvent;
    const touch = touchEvent.touches[0] ?? touchEvent.changedTouches[0];
    if (touch) return { x: touch.clientX, y: touch.clientY };
  }
  if ("clientX" in event && "clientY" in event) {
    const pointerEvent = event as MouseEvent;
    return { x: pointerEvent.clientX, y: pointerEvent.clientY };
  }
  return null;
}

function edgeScrollDelta(position: number, start: number, end: number) {
  const edge = Math.min(EDGE_SIZE, Math.max(0, (end - start) / 3));
  if (!edge) return 0;
  if (position < start + edge) return -Math.min(MAX_SCROLL_STEP, Math.ceil((start + edge - position) / 3));
  if (position > end - edge) return Math.min(MAX_SCROLL_STEP, Math.ceil((position - (end - edge)) / 3));
  return 0;
}

function visibleBounds(element: HTMLElement, axis: "x" | "y") {
  const rect = element.getBoundingClientRect();
  const viewportEnd = axis === "x" ? window.innerWidth : window.innerHeight;
  return {
    start: Math.max(0, axis === "x" ? rect.left : rect.top),
    end: Math.min(viewportEnd, axis === "x" ? rect.right : rect.bottom),
  };
}

function scrollNearEdge(element: HTMLElement, axis: "x" | "y", position: number) {
  const { start, end } = visibleBounds(element, axis);
  const delta = edgeScrollDelta(position, start, end);
  if (!delta) return;

  if (axis === "x") {
    if ((delta < 0 && element.scrollLeft <= 0) || (delta > 0 && element.scrollLeft >= element.scrollWidth - element.clientWidth - 1)) return;
    element.scrollLeft += delta;
    return;
  }
  if ((delta < 0 && element.scrollTop <= 0) || (delta > 0 && element.scrollTop >= element.scrollHeight - element.clientHeight - 1)) return;
  element.scrollTop += delta;
}

function postListAtPointer(canvas: HTMLElement, point: Point) {
  const pointed = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>(".post-list");
  if (pointed && canvas.contains(pointed)) return pointed;

  const canvasRect = canvas.getBoundingClientRect();
  let closest: { element: HTMLElement; distance: number } | null = null;
  for (const element of canvas.querySelectorAll<HTMLElement>(".post-list")) {
    const rect = element.getBoundingClientRect();
    const left = Math.max(0, canvasRect.left, rect.left);
    const right = Math.min(window.innerWidth, canvasRect.right, rect.right);
    if (right <= left) continue;
    const distance = point.x < left ? left - point.x : point.x > right ? point.x - right : 0;
    if (!closest || distance < closest.distance) closest = { element, distance };
  }
  return closest?.element ?? null;
}

/**
 * 섹션 보드의 중첩 스크롤을 포인터 기준으로 움직입니다. 가로 캔버스와 현재 섹션의 세로 목록은
 * 서로 다른 요소라 dnd-kit 기본 자동 스크롤 하나로는 가장자리 이동이 안정적이지 않습니다.
 */
export function useBoardDragAutoScroll(canvasRef: RefObject<HTMLDivElement | null>) {
  const pointerRef = useRef<Point | null>(null);
  const dragKindRef = useRef<DragKind | null>(null);
  const frameRef = useRef<number | null>(null);
  const stepRef = useRef<() => void>(() => {});
  const [pointerDragActive, setPointerDragActive] = useState(false);

  const stop = useCallback(() => {
    dragKindRef.current = null;
    pointerRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    setPointerDragActive(false);
  }, []);

  const start = useCallback((kind: DragKind, activatorEvent: Event) => {
    const point = eventPoint(activatorEvent);
    if (!point) {
      dragKindRef.current = null;
      pointerRef.current = null;
      setPointerDragActive(false);
      return;
    }
    dragKindRef.current = kind;
    pointerRef.current = point;
    setPointerDragActive(true);
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(() => stepRef.current());
  }, []);

  useEffect(() => {
    const updatePointer = (event: MouseEvent | PointerEvent | TouchEvent) => {
      if (!dragKindRef.current) return;
      const point = eventPoint(event);
      if (point) pointerRef.current = point;
    };
    const step = () => {
      const canvas = canvasRef.current;
      const point = pointerRef.current;
      const kind = dragKindRef.current;
      if (!canvas || !point || !kind) {
        frameRef.current = null;
        return;
      }

      scrollNearEdge(canvas, "x", point.x);
      if (kind === "post") {
        const postList = postListAtPointer(canvas, point);
        if (postList) scrollNearEdge(postList, "y", point.y);
      }
      frameRef.current = requestAnimationFrame(step);
    };
    stepRef.current = step;

    window.addEventListener("mousemove", updatePointer, { passive: true });
    window.addEventListener("pointermove", updatePointer, { passive: true });
    window.addEventListener("touchmove", updatePointer, { passive: true });
    return () => {
      window.removeEventListener("mousemove", updatePointer);
      window.removeEventListener("pointermove", updatePointer);
      window.removeEventListener("touchmove", updatePointer);
      dragKindRef.current = null;
      pointerRef.current = null;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [canvasRef]);

  return { pointerDragActive, start, stop };
}
