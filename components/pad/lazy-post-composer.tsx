"use client";

import { lazy, Suspense } from "react";
import { Modal } from "@/components/ui/modal";
import type { PostComposerProps } from "@/components/pad/post-composer";

const loadPostComposer = () => import("@/components/pad/post-composer");
const PostComposer = lazy(() => loadPostComposer().then((mod) => ({ default: mod.PostComposer })));

/** 포인터·키보드 포커스가 작성 버튼에 닿으면 클릭 전에 큰 작성기 청크를 미리 받습니다. */
export function preloadPostComposer() {
  void loadPostComposer();
}

/** 첨부·업로드·초안 복구까지 포함한 작성기는 실제 작성/수정 때만 마운트합니다. */
export function LazyPostComposer(props: PostComposerProps) {
  return (
    <Suspense fallback={
      props.presentation === "inline"
        ? <div className="post-inline-composer-loading" role="status">편집기를 불러오는 중…</div>
        : <Modal open onClose={props.onClose} title={props.post ? "게시물 수정" : "새 글 작성"}>
            <div className="grid min-h-44 place-items-center text-sm font-bold text-content-muted" role="status">글쓰기 도구를 불러오는 중…</div>
          </Modal>
    }>
      <PostComposer {...props} />
    </Suspense>
  );
}
