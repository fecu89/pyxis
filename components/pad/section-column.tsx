"use client";

import { memo, useEffect, useRef, useState, type FormEvent, type KeyboardEventHandler } from "react";
import { CSS } from "@dnd-kit/utilities";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { GripHorizontal, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/app-dialog";
import { Modal } from "@/components/ui/modal";
import { useGuestIdentity } from "@/components/pad/guest-identity";
import { PostCard } from "@/components/pad/post-card";
import { SortablePostCard } from "@/components/pad/sortable-post-card";
import { LazyPostComposer, preloadPostComposer } from "@/components/pad/lazy-post-composer";
import type { PostFieldConfig } from "@/components/pad/settings/types";
import type { PadCapabilities, SectionData } from "@/components/pad/types";
import { requestJson } from "@/lib/api-client";

export const SectionColumn = memo(function SectionColumn({ section, capabilities, currentUserId, fieldConfig, reactionPolicy, showAuthor, showTimestamp, accentColor, index, filtering, postSortingEnabled, onLoadMore, loadingMore = false }: {
  section: SectionData;
  capabilities: PadCapabilities;
  currentUserId: string | null;
  fieldConfig: PostFieldConfig;
  reactionPolicy: "SINGLE" | "MULTIPLE";
  showAuthor: boolean;
  showTimestamp: boolean;
  accentColor?: string | null;
  index: number;
  filtering: boolean;
  /** 하나라도 이동 가능한 글이 있을 때만 모든 카드의 위치를 DnD 엔진에 등록합니다. */
  postSortingEnabled: boolean;
  onLoadMore?: (sectionId: string) => Promise<void>;
  loadingMore?: boolean;
}) {
  const confirm = useConfirm();
  const guest = useGuestIdentity();
  const [composing, setComposing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  // pad-more-menu.tsx와 같은 바깥 클릭 감지 패턴. 이게 없으면 메뉴를 연 채로 다른 곳을
  // 클릭해도(다른 카드, 스크롤, 다른 섹션 메뉴 열기) 계속 열려 있는 상태로 남습니다.
  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  const canManage = capabilities.manageBoard;
  // 손님(currentUserId 없음)도 보드가 열려 있으면 쓸 수 있습니다. 이름은 버튼을 누른 뒤 묻습니다.
  const canPost = capabilities.createPost && (!!currentUserId || guest.guestWriteOpen);

  async function startComposing() {
    // 손님이면 여기서 이름을 한 번 묻습니다. 취소하면 작성창을 열지 않습니다.
    if (!(await guest.ensureName())) return;
    setComposing(true);
  }
  const sortable = useSortable({ id: `section:${section.id}`, data: { type: "section", sectionId: section.id }, disabled: !canManage || filtering });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  // post-card.tsx와 같은 이유로 onKeyDown만 따로 떼어 키보드 전용 그립 아이콘에 붙입니다 — 헤더
  // 전체가 포인터/터치 드래그 대상이라, 리스너를 통째로 붙이면 헤더에 포커스가 있을 때 Space가
  // "더블클릭 편집"과 무관하게 dnd-kit의 키보드 드래그 시작으로 먼저 먹힐 수 있습니다.
  const { onKeyDown: dragKeyDown, ...dragPointerListeners } = sortable.listeners ?? {};
  const dragHandleKeyDown = dragKeyDown as KeyboardEventHandler<HTMLSpanElement> | undefined;

  async function updateSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await requestJson(`/api/sections/${section.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: data.get("title"), description: data.get("description") }) });
    } catch (reason) {
      return setError(reason instanceof Error ? reason.message : "섹션을 수정하지 못했습니다.");
    }
    setEditing(false);
  }

  async function deleteSection() {
    if (!(await confirm(`'${section.title}' 섹션과 안의 게시물을 삭제할까요? 글은 7일 안에 복구할 수 있지만 첨부파일은 즉시 영구 삭제됩니다.`))) return;
    try {
      await requestJson(`/api/sections/${section.id}`, { method: "DELETE" });
    } catch (reason) {
      return setError(reason instanceof Error ? reason.message : "섹션을 삭제하지 못했습니다.");
    }
  }

  return (
    <>
      <section id={`section-${section.id}`} ref={sortable.setNodeRef} style={style} className={`section-column column-${index % 5} ${sortable.isDragging ? "dragging" : ""}`}>
        <header className="section-header" {...sortable.attributes} {...dragPointerListeners}>
          <div onDoubleClick={() => canManage && setEditing(true)} title={canManage ? "더블클릭하면 제목·안내 문구를 바꿀 수 있어요" : undefined}>
            <h2>{section.title}</h2>
          </div>
          <span className="section-count">{section.totalPostCount}</span>
          <div className="section-header-actions">
            {canManage && !filtering && <span className="drag-handle" role="button" tabIndex={0} aria-label="섹션 순서 이동 (스페이스바로 드래그 시작)" onKeyDown={dragHandleKeyDown}><GripHorizontal size={15} /></span>}
            {canManage && <div className="section-menu-wrap" ref={menuRef}><button className="icon-button small" onClick={() => setMenuOpen((value) => !value)} aria-label="섹션 메뉴"><MoreHorizontal size={17} /></button>{menuOpen && <div className="mini-menu"><button onClick={() => { setEditing(true); setMenuOpen(false); }}><Pencil size={14} />수정</button><button className="danger-text" onClick={deleteSection}><Trash2 size={14} />삭제</button></div>}</div>}
          </div>
        </header>
        <button type="button" className="section-add-trigger" style={accentColor ? { background: accentColor } : undefined} title={canPost ? "이 섹션에 게시 추가" : currentUserId ? "읽기 전용 섹션이에요" : "로그인 후 글을 쓸 수 있어요"} onPointerEnter={preloadPostComposer} onFocus={preloadPostComposer} onClick={startComposing} disabled={!canPost}><Plus size={20} /></button>
        <div className="post-list">
          <SortableContext items={section.posts.map((post) => `post:${post.id}`)} strategy={verticalListSortingStrategy}>
            {section.posts.map((post) => {
              const dragDisabled = !capabilities.editAnyPost && (!capabilities.editOwnContent || !post.isMine);
              const props = { post, sectionId: section.id, reactionPolicy, showAuthor, showTimestamp, capabilities };
              // 정렬이 켜진 목록에서는 이동 불가 카드도 droppable 위치로 등록해야, 소유한 글을
              // 그 카드의 앞뒤에 정확히 놓을 수 있습니다. 정렬 자체가 꺼졌을 때만 순수 카드를 씁니다.
              return postSortingEnabled
                ? <SortablePostCard key={post.id} {...props} dragDisabled={dragDisabled} />
                : <PostCard key={post.id} {...props} />;
            })}
          </SortableContext>
          {!section.posts.length && <div className="section-empty"><span><Sparkles size={20} /></span><b>아직 조용한 공간이에요</b><p>첫 번째 생각을 남겨보세요.</p></div>}
          {section.nextCursor && onLoadMore ? <button type="button" disabled={loadingMore} onClick={() => void onLoadMore(section.id)} className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-xs font-black text-content-muted shadow-sm disabled:opacity-50">{loadingMore ? <span className="spin">↻</span> : <Plus size={14} />}{loadingMore ? "불러오는 중…" : `이전 글 더 보기 (${section.posts.length}/${section.totalPostCount})`}</button> : null}
        </div>
      </section>
      {composing && <LazyPostComposer open={composing} onClose={() => setComposing(false)} sectionId={section.id} sectionTitle={section.title} fieldConfig={fieldConfig} />}
      <Modal open={editing} onClose={() => setEditing(false)} title="섹션 다듬기" description="제목과 안내 문구를 바꿀 수 있어요.">
        <form className="stack-form" onSubmit={updateSection}><label>섹션 제목<input name="title" defaultValue={section.title} required maxLength={80} /></label><label>안내 문구<textarea name="description" defaultValue={section.description ?? ""} rows={3} maxLength={240} /></label>{error && <p className="form-error">{error}</p>}<button className="button primary full">변경 내용 저장</button></form>
      </Modal>
    </>
  );
});
