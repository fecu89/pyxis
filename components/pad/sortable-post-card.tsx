"use client";

import { useEffect, useRef, type CSSProperties, type HTMLAttributes, type KeyboardEventHandler } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PostCard, type PostCardDragBindings, type PostCardProps } from "@/components/pad/post-card";

/**
 * 수동 정렬을 실제로 제공하는 동적 레이아웃 전용 래퍼입니다. 읽기 전용 카드와
 * STREAM/TIMELINE/TABLE은 이 파일을 import하지 않아 @dnd-kit 훅·컨텍스트 구독 비용이 없습니다.
 */
export function SortablePostCard({ dragDisabled, ...props }: PostCardProps & { dragDisabled: boolean }) {
  const sortable = useSortable({
    id: `post:${props.post.id}`,
    data: { type: "post", postId: props.post.id, sectionId: props.sectionId },
    disabled: dragDisabled,
  });
  const { onKeyDown, ...pointerListeners } = sortable.listeners ?? {};
  const wasDraggingRef = useRef(false);

  useEffect(() => {
    if (sortable.isDragging) {
      wasDraggingRef.current = true;
      return;
    }
    // mouseup에서 바로 발생하는 click만 차단합니다. dnd-kit의 capture 리스너가 그 클릭을
    // 먼저 소비하더라도 플래그가 다음 정상 클릭까지 남지 않도록 다음 task에서 해제합니다.
    const timer = setTimeout(() => { wasDraggingRef.current = false; }, 0);
    return () => clearTimeout(timer);
  }, [sortable.isDragging]);

  const drag: PostCardDragBindings = {
    enabled: !dragDisabled,
    setNodeRef: sortable.setNodeRef,
    style: {
      transform: CSS.Transform.toString(sortable.transform),
      transition: sortable.transition,
    } as CSSProperties,
    isDragging: sortable.isDragging,
    attributes: dragDisabled ? {} : sortable.attributes as HTMLAttributes<HTMLElement>,
    pointerListeners: dragDisabled ? {} : pointerListeners as unknown as HTMLAttributes<HTMLElement>,
    keyDown: dragDisabled ? undefined : onKeyDown as KeyboardEventHandler<HTMLSpanElement> | undefined,
    consumeClickAfterDrag: () => {
      if (dragDisabled || !wasDraggingRef.current) return false;
      wasDraggingRef.current = false;
      return true;
    },
  };

  return <PostCard {...props} drag={drag} />;
}
