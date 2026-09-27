"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, type UIEvent } from "react";
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { FileText, Heart, MessageCircle, Paperclip, Pin, Plus } from "lucide-react";
import { attachmentSummary } from "@/components/pad/attachments/file-kind";
import { Avatar } from "@/components/ui/avatar";
import { SectionColumn } from "@/components/pad/section-column";
import { sectionBoardCollisionDetection } from "@/components/pad/section-board-collision";
import { useBoardDragAutoScroll } from "@/components/pad/use-board-drag-auto-scroll";
import type { PostFieldConfig } from "@/components/pad/settings/types";
import type { PadCapabilities, PadSortMode, PostData, SectionData } from "@/components/pad/types";
import { restorePostDragOrigin, type PostDragOrigin } from "@/components/pad/reconcile-sections";
import { requestJson } from "@/lib/api-client";
import { attachmentImageUrl } from "@/lib/files/attachment-url";

// SECTIONS 레이아웃(드래그로 순서 바꾸는 보드)에서만 쓰는 @dnd-kit 의존 코드를 이 파일 하나로
// 모았습니다. 이렇게 분리해 둬야 pad-canvas.tsx가 next/dynamic으로 이 컴포넌트를 지연 로드할 때
// 이 레이아웃의 @dnd-kit도 함께 지연 로드됩니다. WALL/GRID는 자기 전용 평면 DnD 청크를 받고,
// STREAM/TIMELINE/TABLE은 @dnd-kit을 받지 않습니다(webpack 빌드 기준, Turbopack은 debug.md 참고).
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

function SectionDragPreview({ section }: { section: SectionData }) {
  return (
    <section className="section-column dragging drag-overlay-card">
      <header className="section-header"><div><h2>{section.title}</h2><p>{section.description || "생각을 모아보세요."}</p></div><span className="section-count">{section.posts.length}</span></header>
    </section>
  );
}

export function SectionsBoardView({
  boardId,
  sortMode,
  baseSections,
  sections,
  filteredSections,
  query,
  canManage,
  capabilities,
  currentUserId,
  fieldConfig,
  reactionPolicy,
  showAuthor,
  showTimestamp,
  accentColor,
  setLocalSections,
  onPostDragChange,
  onPostMove,
  setError,
  onAddSection,
  onActiveSectionChange,
  onLoadMore,
  loadingPostPages,
}: {
  boardId: string;
  sortMode: PadSortMode;
  baseSections: SectionData[];
  sections: SectionData[];
  filteredSections: SectionData[];
  query: string;
  canManage: boolean;
  capabilities: PadCapabilities;
  currentUserId: string | null;
  fieldConfig: PostFieldConfig;
  reactionPolicy: "SINGLE" | "MULTIPLE";
  showAuthor: boolean;
  showTimestamp: boolean;
  accentColor?: string | null;
  setLocalSections: (updater: SectionData[] | null | ((current: SectionData[] | null) => SectionData[] | null)) => void;
  onPostDragChange: (postId: string | null) => void;
  onPostMove: (postId: string, move: { targetSectionId: string; previousItemId: string | null; nextItemId: string | null }, origin: PostDragOrigin | null) => void;
  setError: (message: string) => void;
  onAddSection: () => void;
  onActiveSectionChange?: (sectionId: string) => void;
  onLoadMore?: (sectionId: string) => Promise<void>;
  loadingPostPages: Set<string>;
}) {
  const paginationIncomplete = sections.some((section) => Boolean(section.nextCursor));
  const postSortingEnabled = !query
    && !paginationIncomplete
    && sortMode === "MANUAL"
    && (capabilities.editAnyPost || (capabilities.editOwnContent && sections.some((section) => section.posts.some((post) => post.isMine))));
  const [activeDrag, setActiveDrag] = useState<{ type: "post"; postId: string } | { type: "section"; sectionId: string } | null>(null);
  const postDragOriginRef = useRef<PostDragOrigin | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragAutoScroll = useBoardDragAutoScroll(canvasRef);
  const scrollFrameRef = useRef<number | null>(null);
  // 마우스는 거리 기준(8px 움직이면 바로 드래그)으로 즉각 반응하게 두고, 터치는 지연 기준(누른 채
  // 250ms 유지)으로 분리합니다. 터치에서 거리 기준을 쓰면 스크롤하려고 살짝 스와이프한 손가락도
  // 드래그로 잡혀버리는데, 지연 기준은 그 시간 동안 손가락이 tolerance 이상 움직이면 드래그를
  // 취소하고 기본 스크롤에 넘겨줍니다 — "카드를 길게 눌러 순서를 바꿀 수 있어요" 안내 문구가
  // 실제 동작이 되도록 하는 핵심 설정입니다.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    onPostDragChange(null);
  }, [onPostDragChange]);

  function onCanvasScroll(event: UIEvent<HTMLDivElement>) {
    if (!onActiveSectionChange || query || scrollFrameRef.current !== null) return;
    const scroller = event.currentTarget;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const left = scroller.getBoundingClientRect().left;
      let closest: { id: string; distance: number } | null = null;
      for (const section of filteredSections) {
        const element = document.getElementById(`section-${section.id}`);
        if (!element) continue;
        const distance = Math.abs(element.getBoundingClientRect().left - left);
        if (!closest || distance < closest.distance) closest = { id: section.id, distance };
      }
      if (closest) onActiveSectionChange(closest.id);
    });
  }

  function onDragStart(event: DragStartEvent) {
    const { active } = event;
    const type = active.data.current?.type;
    if (type === "post") {
      dragAutoScroll.start("post", event.activatorEvent);
      const postId = active.data.current?.postId as string;
      onPostDragChange(postId);
      const sectionId = active.data.current?.sectionId as string;
      const source = sections.find((section) => section.id === sectionId);
      const index = source?.posts.findIndex((post) => post.id === postId) ?? -1;
      postDragOriginRef.current = source && index >= 0 ? {
        postId,
        sectionId,
        index,
        previousItemId: source.posts[index - 1]?.id ?? null,
        nextItemId: source.posts[index + 1]?.id ?? null,
      } : null;
      setActiveDrag({ type: "post", postId });
    } else if (type === "section") {
      dragAutoScroll.start("section", event.activatorEvent);
      postDragOriginRef.current = null;
      setActiveDrag({ type: "section", sectionId: active.data.current?.sectionId as string });
    }
  }

  function onDragCancel() {
    onPostDragChange(null);
    dragAutoScroll.stop();
    setActiveDrag(null);
    const origin = postDragOriginRef.current;
    postDragOriginRef.current = null;
    if (origin) setLocalSections((current) => restorePostDragOrigin(current ?? baseSections, origin));
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || active.data.current?.type !== "post") return;
    const overType = over.data.current?.type;
    const overSectionId = overType === "post" || overType === "section" ? (over.data.current?.sectionId as string) : null;
    const activeSectionId = active.data.current?.sectionId as string;
    if (!overSectionId || overSectionId === activeSectionId) return;
    const postId = active.data.current?.postId as string;
    setLocalSections((current) => {
      const base = current ?? baseSections;
      const next = base.map((section) => ({ ...section, posts: [...section.posts] }));
      const source = next.find((section) => section.id === activeSectionId);
      const target = next.find((section) => section.id === overSectionId);
      const movingIndex = source?.posts.findIndex((post) => post.id === postId) ?? -1;
      if (!source || !target || movingIndex < 0) return current;
      const [moving] = source.posts.splice(movingIndex, 1);
      const overPostId = overType === "post" ? (over.data.current?.postId as string) : null;
      const overIndex = overPostId ? target.posts.findIndex((post) => post.id === overPostId) : target.posts.length;
      target.posts.splice(overIndex < 0 ? target.posts.length : overIndex, 0, moving);
      return next;
    });
    // 같은 드래그 동작 안에서 반복 호출될 때 다음 비교 기준이 되도록 현재 컨테이너를 갱신해 둡니다.
    active.data.current.sectionId = overSectionId;
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    dragAutoScroll.stop();
    setActiveDrag(null);
    const activeType = active.data.current?.type;
    const origin = postDragOriginRef.current;
    postDragOriginRef.current = null;
    onPostDragChange(null);
    const restorePost = () => {
      if (origin) setLocalSections((current) => restorePostDragOrigin(current ?? baseSections, origin));
    };
    if (sortMode !== "MANUAL" || !over || query) {
      if (activeType === "post") restorePost();
      return;
    }
    if (activeType === "section") {
      const oldIndex = sections.findIndex((section) => `section:${section.id}` === active.id);
      const overSectionId = over.data.current?.sectionId as string | undefined;
      const newIndex = sections.findIndex((section) => section.id === overSectionId || `section:${section.id}` === over.id);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      const nextSections = arrayMove(sections, oldIndex, newIndex);
      setLocalSections(nextSections);
      const moved = nextSections[newIndex];
      try {
        await requestJson(`/api/sections/${moved.id}/reorder`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ previousItemId: nextSections[newIndex - 1]?.id ?? null, nextItemId: nextSections[newIndex + 1]?.id ?? null }) });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "섹션 순서를 바꾸지 못했습니다.");
        setLocalSections(null);
      }
      return;
    }
    if (activeType !== "post") return;
    const postId = active.data.current?.postId as string;
    // onDragOver가 드래그 도중 컨테이너 이동을 이미 반영해 두었으므로, 여기서는 최종 컨테이너 안에서의 순서만 확정합니다.
    const sectionId = active.data.current?.sectionId as string;
    const sourceSectionId = origin?.sectionId;
    const overType = over.data.current?.type;
    // 같은 섹션의 같은 카드에 놓은 것은 무변경입니다. 다른 섹션으로 넘어간 뒤에는 dnd-kit이
    // 움직인 카드 자체를 over로 돌려주기도 하므로 active.id === over.id여도 저장해야 합니다.
    if (active.id === over.id && sourceSectionId === sectionId) {
      restorePost();
      return;
    }
    if (!sectionId) { restorePost(); return; }
    const nextSections = sections.map((section) => section.id === sectionId ? { ...section, posts: [...section.posts] } : section);
    const target = nextSections.find((section) => section.id === sectionId);
    const oldIndex = target?.posts.findIndex((post) => post.id === postId) ?? -1;
    if (!target || oldIndex < 0) { restorePost(); return; }
    const overPostId = overType === "post" ? (over.data.current?.postId as string) : null;
    const rawIndex = overPostId ? target.posts.findIndex((post) => post.id === overPostId) : target.posts.length - 1;
    const newIndex = rawIndex < 0 ? target.posts.length - 1 : rawIndex;
    target.posts = arrayMove(target.posts, oldIndex, newIndex);
    setLocalSections(nextSections);
    const movedIndex = target.posts.findIndex((post) => post.id === postId);
    onPostMove(postId, { targetSectionId: sectionId, previousItemId: target.posts[movedIndex - 1]?.id ?? null, nextItemId: target.posts[movedIndex + 1]?.id ?? null }, origin);
  }

  return (
    <DndContext id={`board-dnd-${boardId}`} sensors={sensors} autoScroll={!dragAutoScroll.pointerDragActive} collisionDetection={sectionBoardCollisionDetection} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <SortableContext items={filteredSections.map((section) => `section:${section.id}`)} strategy={horizontalListSortingStrategy}>
        <div ref={canvasRef} className={`pad-canvas ${activeDrag ? "dragging" : ""}`} onScroll={onCanvasScroll}>
          {filteredSections.map((section, index) => (
            <SectionColumn
              key={section.id}
              section={section}
              capabilities={capabilities}
              currentUserId={currentUserId}
              fieldConfig={fieldConfig}
              reactionPolicy={reactionPolicy}
              showAuthor={showAuthor}
              showTimestamp={showTimestamp}
              accentColor={accentColor}
              index={index}
              filtering={Boolean(query) || sortMode !== "MANUAL"}
              postSortingEnabled={postSortingEnabled}
              onLoadMore={onLoadMore}
              loadingMore={loadingPostPages.has(section.id)}
            />
          ))}
          {!filteredSections.length && (query || !canManage) && (
            <div className="pad-canvas-empty">
              <span><Plus size={18} /></span>
              <b>{query ? "검색 결과가 없어요" : "아직 섹션이 없어요"}</b>
              <small>{query ? "다른 검색어를 입력해 보세요." : "관리자가 섹션을 만들면 여기에 표시됩니다."}</small>
            </div>
          )}
          {canManage && !query && <button type="button" className="add-section-card" onClick={onAddSection}><span><Plus /></span><b>새 섹션</b><small>생각을 나눌 주제를 추가해요</small></button>}
        </div>
      </SortableContext>
      <DragOverlay style={{ pointerEvents: "none" }}>
        {activeDrag?.type === "post" && (() => {
          const post = sections.flatMap((section) => section.posts).find((item) => item.id === activeDrag.postId);
          return post ? <PostDragPreview post={post} /> : null;
        })()}
        {activeDrag?.type === "section" && (() => {
          const section = sections.find((item) => item.id === activeDrag.sectionId);
          return section ? <SectionDragPreview section={section} /> : null;
        })()}
      </DragOverlay>
    </DndContext>
  );
}
