"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { GripVertical } from "lucide-react";

type SortableItem = { id: string; text: string };

type DragState = {
  id: string;
  pointerId: number;
  currentY: number;
  grabOffsetY: number;
  left: number;
  width: number;
  height: number;
  targetIndex: number;
};

const AUTO_SCROLL_EDGE_PX = 56;
const AUTO_SCROLL_STEP_PX = 12;

function moveItem(items: SortableItem[], itemId: string, targetIndex: number) {
  const sourceIndex = items.findIndex((item) => item.id === itemId);
  if (sourceIndex < 0) return items;
  const next = items.filter((item) => item.id !== itemId);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, items[sourceIndex]);
  return next;
}

function DropIndicator({ game }: { game: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-1 -top-[5px] z-20 flex items-center" aria-hidden="true">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${game ? "bg-info-300 shadow-[0_0_12px_rgba(112,232,238,.9)]" : "bg-brand-600 shadow-[0_0_10px_rgba(0,114,201,.45)]"}`} />
      <span className={`h-1 flex-1 ${game ? "bg-info-300 shadow-[0_0_12px_rgba(112,232,238,.7)]" : "bg-brand-600"}`} />
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${game ? "bg-info-300 shadow-[0_0_12px_rgba(112,232,238,.9)]" : "bg-brand-600 shadow-[0_0_10px_rgba(0,114,201,.45)]"}`} />
    </div>
  );
}

// 카드 전체가 손잡이입니다. floating은 끌려다니는 복제본이라 포커스도 이벤트도 받지 않습니다.
function OrderCard({
  item,
  position,
  total,
  game,
  disabled,
  floating,
  instructionId,
  setRef,
  onPointerDown,
  onKeyDown,
}: {
  item: SortableItem;
  position: number;
  total: number;
  game: boolean;
  disabled: boolean;
  floating: boolean;
  instructionId: string;
  setRef?: (node: HTMLDivElement | null) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const grabbable = !floating && !disabled;
  return (
    <div
      ref={setRef}
      role={floating ? undefined : "button"}
      tabIndex={grabbable ? 0 : undefined}
      aria-label={floating ? undefined : `${item.text}. 현재 ${total}개 중 ${position}번째. 끌어서 옮기거나 위아래 방향키로 이동합니다.`}
      aria-describedby={floating ? undefined : instructionId}
      onPointerDown={grabbable ? onPointerDown : undefined}
      onKeyDown={grabbable ? onKeyDown : undefined}
      // 카드 위에서는 브라우저 제스처(스크롤)를 완전히 끕니다. 누르는 즉시 드래그가 시작되고,
      // 목록 스크롤은 카드 사이 여백이나 드래그 중 가장자리 자동 스크롤이 맡습니다.
      style={grabbable ? { touchAction: "none" } : undefined}
      className={`flex min-h-[clamp(2.9rem,11vw,4rem)] select-none items-center gap-3 rounded-2xl border p-2 shadow-lg outline-none transition-[border-color,background-color,box-shadow,transform] duration-200 sm:p-2.5 ${game ? "border-white/12 bg-white/10 text-white shadow-brand-950/20" : "border-line bg-white text-content shadow-content/5"} ${floating ? game ? "border-info-300/70 bg-white/15" : "border-brand-500 bg-brand-50" : ""} ${grabbable ? `cursor-grab active:scale-[.99] active:cursor-grabbing ${game ? "hover:border-info-300/40 hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-info-300" : "hover:border-brand-400 hover:bg-brand-50/60 focus-visible:ring-2 focus-visible:ring-brand-500"}` : ""} ${!floating && disabled ? "cursor-not-allowed" : ""}`}
    >
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl font-mono text-[10px] font-black sm:h-10 sm:w-10 sm:text-xs ${game ? "bg-info-300 text-brand-950" : "bg-brand-100 text-brand-800"}`}>{position}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[clamp(.8rem,3.4vw,.875rem)] font-black leading-5">{item.text}</span>
      {/* 잡는 곳이 아니라 "끌 수 있다"는 표시일 뿐이라 이벤트를 받지 않습니다. */}
      <span aria-hidden="true" className={`pointer-events-none grid h-9 w-9 shrink-0 place-items-center rounded-xl sm:h-12 sm:w-12 ${floating ? game ? "bg-white/15 text-info-200" : "bg-brand-100 text-brand-800" : game ? "text-brand-100/45" : "text-content-subtle"} ${!floating && disabled ? "opacity-35" : ""}`}>
        <GripVertical className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.6} />
      </span>
    </div>
  );
}

export function SortableOrderAnswer({ items, disabled, variant, onSubmit }: { items: string[]; disabled: boolean; variant: "game" | "light"; onSubmit: (orderedItems: string[]) => void }) {
  const game = variant === "game";
  const instructionId = useId();
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const listRef = useRef<HTMLOListElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const [orderedItems, setOrderedItems] = useState<SortableItem[]>(() => items.map((text, index) => ({ id: `order-${index}`, text })));
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const movePointer = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;

      const candidates = orderedItems.filter((item) => item.id !== current.id);
      let targetIndex = 0;
      for (const candidate of candidates) {
        const rect = itemRefs.current.get(candidate.id)?.getBoundingClientRect();
        if (rect && event.clientY >= rect.top + rect.height / 2) targetIndex += 1;
      }

      // 목록이 자체 스크롤 상자 안에 있으면 그 상자를, 아니면 페이지를 가장자리에서 밀어 줍니다.
      const list = listRef.current;
      if (list && list.scrollHeight > list.clientHeight + 1) {
        const rect = list.getBoundingClientRect();
        if (event.clientY < rect.top + AUTO_SCROLL_EDGE_PX) list.scrollBy({ top: -AUTO_SCROLL_STEP_PX });
        else if (event.clientY > rect.bottom - AUTO_SCROLL_EDGE_PX) list.scrollBy({ top: AUTO_SCROLL_STEP_PX });
      } else if (event.clientY < AUTO_SCROLL_EDGE_PX) {
        window.scrollBy({ top: -AUTO_SCROLL_STEP_PX });
      } else if (event.clientY > window.innerHeight - AUTO_SCROLL_EDGE_PX) {
        window.scrollBy({ top: AUTO_SCROLL_STEP_PX });
      }

      const next = { ...current, currentY: event.clientY, targetIndex };
      dragRef.current = next;
      if (dragFrameRef.current === null) {
        dragFrameRef.current = window.requestAnimationFrame(() => {
          dragFrameRef.current = null;
          setDrag(dragRef.current);
        });
      }
      if (targetIndex !== current.targetIndex) setAnnouncement(`${targetIndex + 1}번째 위치`);
    };

    const finishPointer = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      event.preventDefault();
      const movedItem = orderedItems.find((item) => item.id === current.id);
      setOrderedItems((currentItems) => moveItem(currentItems, current.id, current.targetIndex));
      setAnnouncement(`${movedItem?.text ?? "항목"}을 ${current.targetIndex + 1}번째에 놓았습니다.`);
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
      dragRef.current = null;
      setDrag(null);
      window.requestAnimationFrame(() => itemRefs.current.get(current.id)?.focus());
    };

    const cancelCurrentDrag = () => {
      const current = dragRef.current;
      if (!current) return;
      setAnnouncement("순서 이동을 취소했습니다.");
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
      dragRef.current = null;
      setDrag(null);
      window.requestAnimationFrame(() => itemRefs.current.get(current.id)?.focus());
    };

    const cancelPointer = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      cancelCurrentDrag();
    };

    window.addEventListener("pointermove", movePointer, { passive: true });
    window.addEventListener("pointerup", finishPointer, { passive: false });
    window.addEventListener("pointercancel", cancelPointer);
    window.addEventListener("blur", cancelCurrentDrag);
    return () => {
      window.removeEventListener("pointermove", movePointer);
      window.removeEventListener("pointerup", finishPointer);
      window.removeEventListener("pointercancel", cancelPointer);
      window.removeEventListener("blur", cancelCurrentDrag);
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    };
  }, [orderedItems]);

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    // non-passive pointer/touchmove는 브라우저의 스크롤 최적화를 막으므로 실제 순서 이동 중에만 둡니다.
    const blockPointerScroll = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) event.preventDefault();
    };
    const blockTouchScroll = (event: TouchEvent) => event.preventDefault();
    window.addEventListener("pointermove", blockPointerScroll, { passive: false });
    window.addEventListener("touchmove", blockTouchScroll, { passive: false });
    return () => {
      window.removeEventListener("pointermove", blockPointerScroll);
      window.removeEventListener("touchmove", blockTouchScroll);
    };
  }, [dragging]);

  useEffect(() => {
    if (!dragging) return;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [dragging]);

  function startPointerDrag(event: ReactPointerEvent<HTMLDivElement>, item: SortableItem) {
    if (disabled || !event.isPrimary || event.pointerType === "mouse" && event.button !== 0) return;
    const card = itemRefs.current.get(item.id);
    if (!card) return;
    if (event.pointerType === "mouse") event.preventDefault();
    event.currentTarget.focus();
    if (event.pointerType !== "mouse") navigator.vibrate?.(10);
    const rect = card.getBoundingClientRect();
    const next: DragState = {
      id: item.id,
      pointerId: event.pointerId,
      currentY: event.clientY,
      grabOffsetY: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
      left: rect.left,
      width: rect.width,
      height: rect.height,
      targetIndex: orderedItems.findIndex((candidate) => candidate.id === item.id),
    };
    dragRef.current = next;
    setDrag(next);
    setAnnouncement(`${item.text} 이동 시작. 현재 ${next.targetIndex + 1}번째입니다.`);
  }

  function moveWithKeyboard(event: KeyboardEvent<HTMLDivElement>, item: SortableItem) {
    const currentIndex = orderedItems.findIndex((candidate) => candidate.id === item.id);
    const lastIndex = orderedItems.length - 1;
    let targetIndex = currentIndex;
    if (event.key === "ArrowUp") targetIndex = Math.max(0, currentIndex - 1);
    else if (event.key === "ArrowDown") targetIndex = Math.min(lastIndex, currentIndex + 1);
    else if (event.key === "Home") targetIndex = 0;
    else if (event.key === "End") targetIndex = lastIndex;
    else return;
    event.preventDefault();
    if (targetIndex === currentIndex) return;
    setOrderedItems((current) => moveItem(current, item.id, targetIndex));
    setAnnouncement(`${item.text}을 ${targetIndex + 1}번째로 이동했습니다.`);
  }

  const visibleItems = drag ? orderedItems.filter((item) => item.id !== drag.id) : orderedItems;
  const draggedItem = drag ? orderedItems.find((item) => item.id === drag.id) : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <p id={instructionId} className={`mb-2.5 text-center text-xs font-bold leading-5 ${game ? "text-brand-100/65" : "text-content-muted"}`}>카드를 아무 데나 잡고 원하는 위치로 옮겨 주세요.</p>
      <p className="sr-only" aria-live="polite">{announcement}</p>
      {/* 항목이 많아도 문제 화면이 한 화면을 넘지 않도록, 목록은 이 상자 안에서만 스크롤됩니다. */}
      <ol ref={listRef} className="max-h-[calc(var(--vvh,100dvh)*0.52)] list-none space-y-2 overflow-y-auto overscroll-contain pr-0.5" aria-label="순서 정렬 답안">
        {visibleItems.map((item, index) => {
          const position = drag && index >= drag.targetIndex ? index + 2 : index + 1;
          return (
            <li key={item.id} className="relative">
              {drag && drag.targetIndex === index ? <DropIndicator game={game} /> : null}
              <OrderCard
                item={item}
                position={position}
                total={orderedItems.length}
                game={game}
                disabled={disabled}
                floating={false}
                instructionId={instructionId}
                setRef={(node) => { if (node) itemRefs.current.set(item.id, node); else itemRefs.current.delete(item.id); }}
                onPointerDown={(event) => startPointerDrag(event, item)}
                onKeyDown={(event) => moveWithKeyboard(event, item)}
              />
            </li>
          );
        })}
        {drag && drag.targetIndex === visibleItems.length ? <li className="relative h-0"><DropIndicator game={game} /></li> : null}
      </ol>

      {drag && draggedItem ? (
        <div className="pointer-events-none fixed z-[100]" style={{ left: drag.left, top: drag.currentY - drag.grabOffsetY, width: drag.width, height: drag.height }} aria-hidden="true">
          <div className={`scale-[1.025] rounded-2xl ring-2 ${game ? "ring-info-300 shadow-[0_22px_55px_rgba(0,0,0,.42)]" : "ring-brand-500 shadow-[0_22px_55px_rgba(15,23,42,.2)]"}`}>
            <OrderCard item={draggedItem} position={drag.targetIndex + 1} total={orderedItems.length} game={game} disabled={false} floating instructionId={instructionId} />
          </div>
        </div>
      ) : null}

      <button type="button" onClick={() => onSubmit(orderedItems.map((item) => item.text))} disabled={disabled || orderedItems.length === 0 || Boolean(drag)} className={`mt-3 min-h-[clamp(2.9rem,12vw,3.5rem)] w-full shrink-0 rounded-2xl px-5 text-sm font-black shadow-lg transition hover:-translate-y-0.5 active:translate-y-0 disabled:translate-y-0 disabled:opacity-40 ${game ? "bg-info-300 text-brand-950 shadow-info-300/10" : "bg-brand-950 text-on-brand"}`}>정답 제출</button>
    </div>
  );
}
