"use client";

import { MemberCandidateSearch, type MemberCandidate } from "@/components/pad/settings/member-candidate-search";
import { requestJson } from "@/lib/api-client";

// 예전에는 window.prompt로 이메일을 아무거나 받아서 초대했습니다 — 누가 이미 있는지도 안
// 보이고, 다른 학교 사람도 그대로 초대됐습니다(사용자 피드백 "최악이다"). 같은 학교 소속만
// 검색해 보여주고(교사는 같은 학교, 학생 소유자는 같은 학급), 목록에서 바로 눌러 추가합니다.
export function MemberInvitePicker({ boardId, onInvited }: { boardId: string; onInvited: () => void | Promise<void> }) {
  async function invite(candidate: MemberCandidate) {
    await requestJson(`/api/boards/${boardId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: candidate.id, role: "MEMBER" }),
    });
    await onInvited();
  }

  return <MemberCandidateSearch endpoint={`/api/boards/${boardId}/members/candidates`} onSelect={invite} />;
}
