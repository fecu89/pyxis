"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/app-dialog";
import { ContentCardMenu, ContentCardMenuItem } from "@/components/ui/content-card-menu";
import { LazyPostComposer, preloadPostComposer } from "@/components/pad/lazy-post-composer";
import type { PadCapabilities, PadData, PostData, SectionData } from "@/components/pad/types";
import { requestJson } from "@/lib/api-client";

type ActionState = { sections: SectionData[]; capabilities: PadCapabilities; frozen: boolean };
type Actions = {
  canEdit: (post: PostData) => boolean;
  canDelete: (post: PostData) => boolean;
  edit: (postId: string) => void;
  remove: (postId: string) => Promise<void>;
  pending: boolean;
};
const PostCardActionsContext = createContext<Actions | null>(null);

function canEditPost({ capabilities, frozen }: Pick<ActionState, "capabilities" | "frozen">, post: PostData) {
  return !frozen && (capabilities.editAnyPost || (capabilities.editOwnContent && post.isMine));
}

function canDeletePost(state: Pick<ActionState, "capabilities" | "frozen">, post: PostData) {
  return !state.frozen && (Boolean(state.capabilities.deleteAnyPost) || canEditPost(state, post));
}

function findActionablePost(state: ActionState, postId: string, action: "edit" | "delete" = "edit") {
  const section = state.sections.find((item) => item.posts.some((post) => post.id === postId));
  const post = section?.posts.find((item) => item.id === postId);
  const allowed = action === "edit" ? canEditPost : canDeletePost;
  return section && post && allowed(state, post) ? { section, post } : null;
}

/** 레이아웃별로 편집기·삭제 로직을 복제하지 않고 패드 한 곳에서 공유합니다. */
export function PostCardActionsProvider({ sections, capabilities, frozen, fieldConfig, onEditStarted, onSaved, onDeleted, onError, children }: ActionState & {
  fieldConfig: PadData["postFieldConfig"];
  onEditStarted: (postId: string) => void;
  onSaved: (post: PostData) => void;
  onDeleted: (postId: string, sectionId: string) => void;
  onError: (message: string) => void;
  children: ReactNode;
}) {
  const confirm = useConfirm();
  // 편집 시작 시 본문·버전을 고정합니다. SSE 갱신으로 초안을 지우거나 충돌 검사를 우회하지 않습니다.
  const [editing, setEditing] = useState<{ section: SectionData; post: PostData } | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const latest = useRef<ActionState>({ sections, capabilities, frozen });
  useEffect(() => { latest.current = { sections, capabilities, frozen }; }, [sections, capabilities, frozen]);

  const canKeepEditing = !editing || Boolean(findActionablePost({ sections, capabilities, frozen }, editing.post.id));
  // 동결·권한 회수·삭제 뒤 다시 허용돼도 이전 편집기가 저절로 다시 열리지 않게 합니다.
  if (editing && !canKeepEditing) setEditing(null);

  const edit = useCallback((postId: string) => {
    const target = findActionablePost(latest.current, postId);
    if (pendingRef.current || !target) return;
    onEditStarted(postId);
    preloadPostComposer();
    setEditing(target);
  }, [onEditStarted]);

  const remove = useCallback(async (postId: string) => {
    if (pendingRef.current || !findActionablePost(latest.current, postId, "delete")) return;
    pendingRef.current = true;
    setPending(true);
    onError("");
    try {
      if (!(await confirm({
        title: "게시물 삭제",
        description: "이 게시물을 삭제할까요? 글과 댓글은 7일 안에 복구할 수 있지만 첨부파일은 즉시 영구 삭제됩니다.",
        confirmLabel: "삭제",
        danger: true,
      }))) return;
      // 확인창이 열린 동안 도착한 동결·멤버십 변경도 반영합니다. 서버는 다시 권한을 검사합니다.
      const target = findActionablePost(latest.current, postId, "delete");
      if (!target) return;
      await requestJson(`/api/posts/${postId}`, { method: "DELETE" });
      onDeleted(postId, target.section.id);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "게시물을 삭제하지 못했습니다.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [confirm, onDeleted, onError]);

  const actions = useMemo<Actions>(() => ({
    canEdit: (post) => canEditPost({ capabilities, frozen }, post),
    canDelete: (post) => canDeletePost({ capabilities, frozen }, post),
    edit, remove, pending,
  }), [capabilities, frozen, edit, remove, pending]);

  return (
    <PostCardActionsContext.Provider value={actions}>
      {children}
      {editing && canKeepEditing && <LazyPostComposer
        key={editing.post.id}
        open
        onClose={() => setEditing(null)}
        post={editing.post}
        sectionId={editing.section.id}
        sectionTitle={editing.section.title}
        fieldConfig={fieldConfig}
        onSaved={onSaved}
      />}
    </PostCardActionsContext.Provider>
  );
}

export function PostCardActions({ post }: { post: PostData }) {
  const actions = useContext(PostCardActionsContext);
  const [open, setOpen] = useState(false);
  const canEdit = actions?.canEdit(post);
  const canDelete = actions?.canDelete(post);
  if (!actions || (!canEdit && !canDelete)) {
    if (open) setOpen(false);
    return null;
  }
  // 메뉴 포털에서 온 클릭도 React 트리로 전파되므로 상세 이동·DnD 시작을 여기서 차단합니다.
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <div className="post-card-actions" onClick={stop} onPointerDown={stop} onMouseDown={stop} onTouchStart={stop}>
      <ContentCardMenu title={post.title || "제목 없는 생각"} open={open} onOpenChange={setOpen}>
        {canEdit && <ContentCardMenuItem icon={<Pencil size={15} />} disabled={actions.pending} onClick={() => { setOpen(false); actions.edit(post.id); }}>게시물 수정</ContentCardMenuItem>}
        {canDelete && <ContentCardMenuItem icon={<Trash2 size={15} />} danger disabled={actions.pending} onClick={() => { setOpen(false); void actions.remove(post.id); }}>게시물 삭제</ContentCardMenuItem>}
      </ContentCardMenu>
    </div>
  );
}
