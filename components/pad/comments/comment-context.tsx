"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { CommentMentionCandidate } from "@/components/pad/comments/types";
import type { PadData } from "@/components/pad/types";

/**
 * 카드 안 댓글이 쓰는 두 값 — 지금 보는 사람과 멘션 후보 — 을 한곳에서 내려줍니다.
 *
 * 카드는 섹션 컬럼과 평면 보드 두 경로로 그려지고 레이아웃마다 렌더 함수가 따로 있어서,
 * 프롭으로 내리면 같은 값을 세 군데에 손으로 이어야 합니다. 값이 보드 단위로 한 번 정해지고
 * 카드마다 다르지 않으니 컨텍스트가 맞습니다.
 */

type PadCommentContextValue = {
  currentUserId: string | null;
  mentionCandidates: CommentMentionCandidate[];
};

const PadCommentContext = createContext<PadCommentContextValue>({ currentUserId: null, mentionCandidates: [] });

export function usePadCommentContext() {
  return useContext(PadCommentContext);
}

/** 보드 소유자와 멤버 미리보기에서 멘션 후보를 만듭니다. 이름이 없는 계정은 부를 수 없으니 뺍니다. */
export function buildMentionCandidates(board: Pick<PadData, "owner" | "members">): CommentMentionCandidate[] {
  const candidates = new Map<string, CommentMentionCandidate>();
  if (board.owner.name) candidates.set(board.owner.id, { id: board.owner.id, name: board.owner.name });
  for (const member of board.members) {
    if (member.user.name) candidates.set(member.user.id, { id: member.user.id, name: member.user.name });
  }
  return Array.from(candidates.values());
}

export function PadCommentProvider({ board, currentUserId, children }: {
  board: Pick<PadData, "owner" | "members">;
  currentUserId: string | null;
  children: ReactNode;
}) {
  // 제목·배경·정렬 같은 보드 설정이 바뀌어도 멘션 후보는 그대로입니다. board 객체 전체를
  // 의존성으로 두면 이런 변경마다 모든 PostCard 컨텍스트 소비자가 연쇄 리렌더됩니다.
  const { members, owner } = board;
  const mentionCandidates = useMemo(() => buildMentionCandidates({ members, owner }), [members, owner]);
  const value = useMemo<PadCommentContextValue>(
    () => ({ currentUserId, mentionCandidates }),
    [currentUserId, mentionCandidates],
  );
  return <PadCommentContext.Provider value={value}>{children}</PadCommentContext.Provider>;
}
