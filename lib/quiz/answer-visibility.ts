import type { LivePhase, SessionMode, SessionStatus } from "@/generated/prisma/enums";

// 리포트·응시 기록 API는 정답(correctAnswerText)을 그대로 담아 내려보내므로, 아직 진행 중인
// 세션에서 호출하면 소켓 계층이 감추고 있는 정답이 REST로 새어 나갑니다. 참여자 본인 화면에는
// "이미 공개가 끝난 문항"만 채워 넣기 위한 공통 판정입니다.
//
// - 세션이 끝났거나 참여자가 완주했으면 전 문항 공개
// - ASYNC: 본인이 이미 제출을 마친 문항(currentQuestionIndex 이전)까지만
// - LIVE: 호스트가 지나간 문항까지만. 현재 문항은 정답 공개(QUESTION_REVEAL) 이후에만

type VisibilitySession = {
  mode: SessionMode;
  status: SessionStatus;
  livePhase: LivePhase | null;
  currentQuestionIndex: number | null;
};

type VisibilityParticipant = {
  status: string;
  currentQuestionIndex: number;
};

export function revealedQuestionCount(session: VisibilitySession, participant: VisibilityParticipant, totalQuestions: number): number {
  if (session.status === "FINISHED" || session.status === "CANCELLED") return totalQuestions;
  if (participant.status === "COMPLETED") return totalQuestions;

  if (session.mode === "ASYNC") {
    return Math.max(0, Math.min(totalQuestions, participant.currentQuestionIndex));
  }

  const index = session.currentQuestionIndex ?? -1;
  const currentRevealed = session.livePhase === "QUESTION_REVEAL" || session.livePhase === "LEADERBOARD" || session.livePhase === "ENDED";
  return Math.max(0, Math.min(totalQuestions, currentRevealed ? index + 1 : index));
}
