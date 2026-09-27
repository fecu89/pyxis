"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, MouseSensor, pointerWithin, TouchSensor, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { FileText, Heart, MessageCircle, Paperclip, Pin } from "lucide-react";
import { attachmentSummary } from "@/components/pad/attachments/file-kind";
import { Avatar } from "@/components/ui/avatar";
import { PadLayoutRenderer } from "@/components/pad/layouts/pad-layout-renderer";
import { sortLayoutPosts } from "@/components/pad/layouts/sort-posts";
import { SortablePostCard } from "@/components/pad/sortable-post-card";
import type { LayoutSection, PadAppearance } from "@/components/pad/layouts/types";
import type { PadCapabilities, PadSortMode, PostData, SectionData } from "@/components/pad/types";
import { requestJson } from "@/lib/api-client";
import { attachmentImageUrl } from "@/lib/files/attachment-url";

// WALL/GRID(드래그로 순서를 바꾸는 담벼락·격자 레이아웃)에서만 쓰는 @dnd-kit 의존 코드입니다.
// pad-sections-board.tsx와 같은 이유로 이 파일 하나로 모아 next/dynamic 지연 로드 대상으로 둡니다.
function PostDragPreview({ post }: { post: PostData }) {
  const firstImage = post.attachments.find((attachment) => attachment.type === "IMAGE");
  return (
    <article className="post-card dragging drag-overlay-card">
      <div className="post-card-meta"><Avatar name={post.author.name} image={post.author.image} /><span>{post.author.name || "이름 없는 친구"}</span>{post.isPinned && <span className="pin"><Pin size={12} />고정</span>}</div>
      {firstImage && <img className="post-cover" src={attachmentImageUrl(firstImage, "thumbnail")} alt={firstImage.originalName} loading="lazy" />}
      <div className="post-card-copy">{post.title && <h3>{post.title}</h3>}{post.body && <p>{post.body.replace(/[#*_>`\-[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 132)}</p>}</div>
      {post.attachments.length > 0 && <div className="post-files"><span>{post.attachments.some((item) => item.type === "IMAGE") ? <Paperclip size={14} /> : <FileText size={14} />}{attachmentSummary(post.attachments)}</span></div>}
      <footer><span className={post.viewerReacted ? "liked" : ""}><Heart size={16} fill={post.viewerReacted ? "currentColor" : "none"} />{post.reactionCount || "응원"}</span><span><MessageCircle size={16} />{post.commentCount || "댓글"}</span></footer>
    </article>
  );
}

// pad-sections-board.tsx와 같은 이유(레이아웃이 흔들리면 pointer 기준 "가장 가까운 컨테이너"가
// 커서를 안 움직여도 뒤집힐 수 있음)로 pointerWithin을 우선 씁니다.
const collisionDetectionStrategy: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return closestCenter(args);
};

function renumberPositions(posts: PostData[]): PostData[] {
  return posts.map((post, index) => ({ ...post, position: (index + 1) * 1024 }));
}

export function FlatDragBoardView({
  boardId,
  layout,
  sortMode,
  newPostPlacement,
  sections,
  filteredSections,
  query,
  capabilities,
  reactionPolicy,
  appearance,
  onEditSection,
  setLocalSections,
  setError,
  paginationIncomplete,
}: {
  boardId: string;
  layout: "WALL" | "GRID";
  sortMode: PadSortMode;
  newPostPlacement: "START" | "END";
  sections: SectionData[];
  filteredSections: SectionData[];
  query: string;
  capabilities: PadCapabilities;
  reactionPolicy: "SINGLE" | "MULTIPLE";
  appearance: PadAppearance;
  onEditSection?: (section: LayoutSection<PostData>) => void;
  setLocalSections: (updater: SectionData[] | null | ((current: SectionData[] | null) => SectionData[] | null)) => void;
  setError: (message: string) => void;
  paginationIncomplete: boolean;
}) {
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // 일부 카드만 받은 상태에서 목록 끝으로 옮기면 아직 보이지 않는 카드와의 이웃 관계를
  // 정확히 계산할 수 없습니다. 모든 페이지를 받은 뒤에만 수동 정렬을 허용합니다.
  const filtering = Boolean(query) || sortMode !== "MANUAL" || paginationIncomplete;

  // wall-layout.tsx/grid-layout.tsx가 화면에 그리는 순서와 반드시 같아야 dnd-kit이 실제 카드
  // 위치와 어긋나지 않습니다 — 두 레이아웃도 내부적으로 섹션별 sortLayoutPosts 후 이어붙입니다.
  const flatEntries = filteredSections.flatMap((section) => (
    sortLayoutPosts(section.posts, sortMode, newPostPlacement).map((post) => ({ section, post }))
  ));
  const itemIds = flatEntries.map((entry) => `post:${entry.post.id}`);

  function onDragStart(event: DragStartEvent) {
    setActivePostId(event.active.data.current?.postId as string ?? null);
  }

  function onDragCancel() {
    setActivePostId(null);
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActivePostId(null);
    if (filtering || !over || active.id === over.id) return;
    const oldIndex = flatEntries.findIndex((entry) => `post:${entry.post.id}` === active.id);
    const newIndex = flatEntries.findIndex((entry) => `post:${entry.post.id}` === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const postId = flatEntries[oldIndex].post.id;
    const sourceSectionId = flatEntries[oldIndex].section.id;

    const reordered = [...flatEntries];
    const [movedEntry] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, movedEntry);
    const movedPosition = reordered.findIndex((entry) => entry.post.id === postId);

    // wall/grid는 섹션별로 이어붙여 나열하므로(위 flatEntries) 바로 옆 항목이 곧 그 섹션 블록입니다
    // — 뒤 이웃을 우선하고, 목록 끝이면 앞 이웃, 둘 다 없으면(섹션이 통째로 비어 있던 경우) 원래 섹션.
    const targetSectionId = reordered[movedPosition + 1]?.section.id ?? reordered[movedPosition - 1]?.section.id ?? sourceSectionId;
    let previousItemId: string | null = null;
    let nextItemId: string | null = null;
    for (let i = movedPosition - 1; i >= 0; i -= 1) {
      if (reordered[i].section.id === targetSectionId) { previousItemId = reordered[i].post.id; break; }
    }
    for (let i = movedPosition + 1; i < reordered.length; i += 1) {
      if (reordered[i].section.id === targetSectionId) { nextItemId = reordered[i].post.id; break; }
    }

    const nextSections = sections.map((section) => ({
      ...section,
      posts: sortLayoutPosts(section.posts, sortMode, newPostPlacement),
    }));
    const sourceSection = nextSections.find((section) => section.id === sourceSectionId);
    const targetSection = nextSections.find((section) => section.id === targetSectionId);
    if (!sourceSection || !targetSection) return;
    const movingIndex = sourceSection.posts.findIndex((post) => post.id === postId);
    if (movingIndex < 0) return;
    const [moving] = sourceSection.posts.splice(movingIndex, 1);
    const insertIndex = previousItemId
      ? targetSection.posts.findIndex((post) => post.id === previousItemId) + 1
      : nextItemId
        ? Math.max(0, targetSection.posts.findIndex((post) => post.id === nextItemId))
        : targetSection.posts.length;
    targetSection.posts.splice(insertIndex, 0, moving);
    targetSection.posts = renumberPositions(targetSection.posts);
    setLocalSections(nextSections);

    try {
      await requestJson(`/api/posts/${postId}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetSectionId, previousItemId, nextItemId }),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "순서를 바꾸지 못했습니다.");
      setLocalSections(null);
    }
  }

  const activePost = activePostId ? flatEntries.find((entry) => entry.post.id === activePostId)?.post : null;

  return (
    <DndContext id={`board-dnd-${boardId}`} sensors={sensors} collisionDetection={collisionDetectionStrategy} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <SortableContext items={itemIds} strategy={rectSortingStrategy}>
        <PadLayoutRenderer
          layout={layout}
          sections={filteredSections}
          sortMode={sortMode}
          newPostPlacement={newPostPlacement}
          appearance={appearance}
          onEditSection={onEditSection}
          renderPost={(post, context) => {
            const dragDisabled = filtering || (!capabilities.editAnyPost && (!capabilities.editOwnContent || !post.isMine));
            const props = {
              post,
              sectionId: context.section.id,
              reactionPolicy,
              capabilities,
              showAuthor: appearance.showAuthor ?? true,
              showTimestamp: appearance.showTimestamp ?? true,
            };
            // 이 컴포넌트는 실제로 이동 가능한 글이 하나라도 있을 때만 마운트됩니다. 이동할 수
            // 없는 카드도 drop 기준 위치로는 필요하므로 측정 전용 sortable을 유지합니다.
            return <SortablePostCard key={post.id} {...props} dragDisabled={dragDisabled} />;
          }}
        />
      </SortableContext>
      <DragOverlay>{activePost && <PostDragPreview post={activePost} />}</DragOverlay>
    </DndContext>
  );
}
