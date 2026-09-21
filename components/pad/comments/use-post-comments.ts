"use client";

import { useCallback, useState } from "react";
import type { AttachmentViewData } from "@/components/pad/attachments/types";
import type { ThreadCommentData } from "@/components/pad/comments/types";
import { requestJson } from "@/lib/api-client";

type CommentPage = { comments: ThreadCommentData[]; hasMore: boolean; nextCursor: string | null };

/**
 * 댓글 요청은 게시물 상세와 카드가 함께 씁니다. 요청 자체는 상태가 필요 없으므로 먼저 함수로
 * 두고, 목록을 들고 다녀야 하는 상세 화면만 아래 훅으로 감쌉니다. 카드는 목록을 서버에서
 * 이미 받아 오기 때문에(`post.comments`) 훅 대신 이 함수들만 씁니다.
 */

export async function fetchComments(postId: string, cursor?: string | null) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return requestJson<CommentPage>(`/api/posts/${postId}/comments${query}`);
}

/**
 * 댓글을 만들고 첨부를 차례로 올립니다. 일부 첨부가 실패해도 이미 저장된 댓글을 다시
 * 전송하지 않도록 성공한 첨부와 실패한 파일명을 함께 돌려줍니다.
 */
export async function createComment(
  postId: string,
  body: string,
  parentId: string | null,
  mentionedUserIds: string[],
  files: File[] = [],
) {
  const result = await requestJson<{ comment: ThreadCommentData; commentCount: number }>(`/api/posts/${postId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, parentId, mentionedUserIds }),
  });
  const failed: string[] = [];
  const uploadedAttachments: AttachmentViewData[] = [];
  for (const file of files) {
    const payload = new FormData();
    payload.append("file", file);
    try {
      const upload = await fetch(`/api/comments/${result.comment.id}/attachments`, { method: "POST", body: payload });
      if (!upload.ok) {
        failed.push(file.name);
        continue;
      }
      const uploaded = await upload.json().catch(() => null) as { attachment?: AttachmentViewData } | null;
      if (uploaded?.attachment) uploadedAttachments.push(uploaded.attachment);
      else failed.push(file.name);
    } catch {
      failed.push(file.name);
    }
  }
  return {
    comment: {
      ...result.comment,
      attachments: [...(result.comment.attachments ?? []), ...uploadedAttachments],
    },
    commentCount: result.commentCount,
    failedUploads: failed,
  };
}

export async function patchComment(commentId: string, body: string, mentionedUserIds: string[]) {
  const result = await requestJson<{ comment: Partial<ThreadCommentData> }>(`/api/comments/${commentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, mentionedUserIds }),
  });
  return result.comment;
}

export async function removeComment(commentId: string) {
  await requestJson(`/api/comments/${commentId}`, { method: "DELETE" });
}

/**
 * 게시물 상세 화면의 댓글 목록 상태입니다. 최신 20개씩, 커서로 과거 방향으로 이어 붙입니다
 * (대댓글 깊이와 무관한 한 흐름).
 */
export function usePostComments(postId: string) {
  const [comments, setComments] = useState<ThreadCommentData[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchComments(postId);
      setComments(result.comments);
      setHasMore(result.hasMore);
      setCursor(result.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchComments(postId, cursor);
      setComments((current) => [...result.comments, ...current]);
      setHasMore(result.hasMore);
      setCursor(result.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, postId]);

  const create = useCallback(async (body: string, parentId: string | null, files: File[], mentionedUserIds: string[]) => {
    const { comment, failedUploads } = await createComment(postId, body, parentId, mentionedUserIds, files);
    setComments((current) => [...current, comment]);
    // 첨부는 댓글이 만들어진 다음에 올라가므로 최종 모습을 다시 읽습니다.
    if (files.length) await load();
    if (failedUploads.length) throw new Error(`댓글은 저장됐지만 다음 파일은 올리지 못했습니다: ${failedUploads.join(", ")}`);
    return comment;
  }, [load, postId]);

  const update = useCallback(async (commentId: string, body: string, mentionedUserIds: string[]) => {
    const patched = await patchComment(commentId, body, mentionedUserIds);
    setComments((current) => current.map((comment) => comment.id === commentId ? { ...comment, ...patched } : comment));
  }, []);

  const remove = useCallback(async (commentId: string) => {
    await removeComment(commentId);
    setComments((current) => current.filter((comment) => comment.id !== commentId));
  }, []);

  return { comments, loading, loadingMore, hasMore, load, loadMore, create, update, remove };
}
