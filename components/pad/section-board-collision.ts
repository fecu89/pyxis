import {
  closestCenter,
  pointerWithin,
  type CollisionDetection,
} from "@dnd-kit/core";

/**
 * 섹션과 게시물이 같은 DndContext에 있어도 섹션 이동 중에는 게시물을 충돌 후보에서 제외합니다.
 * 내부 목록의 스크롤 위치에 따라 게시물이 먼저 잡히면 섹션 순서 저장이 무시될 수 있습니다.
 */
export const sectionBoardCollisionDetection: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type;
  const droppableContainers = activeType === "section"
    ? args.droppableContainers.filter((container) => container.data.current?.type === "section")
    : args.droppableContainers;
  const scopedArgs = { ...args, droppableContainers };
  const pointerCollisions = pointerWithin(scopedArgs);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return closestCenter(scopedArgs);
};
