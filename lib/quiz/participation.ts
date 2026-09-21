import type { QuestionType } from "@/generated/prisma/enums";

// 참여형 문항: 정답이 없어 점수를 만들지 않고, 응답 분포 자체가 결과인 유형들입니다.
// "점수 없음"을 유형마다 따로 판정하면 채점(grading)·순위(leaderboard)·진행(host:next-question)이
// 서로 다른 목록을 들고 갈라지므로, 판정을 여기 한 곳에만 둡니다.
//
// SLIDE는 참여형이 아닙니다 — 응답 자체가 없는 감상용 화면이라 별도로 다룹니다.
export const PARTICIPATION_TYPES = ["SURVEY", "WORD_CLOUD", "DROP_PIN", "LIKERT"] as const;

export type ParticipationType = (typeof PARTICIPATION_TYPES)[number];

export function isParticipationType(type: QuestionType | string): type is ParticipationType {
  return (PARTICIPATION_TYPES as readonly string[]).includes(type);
}

/** 점수가 붙지 않는 문항(참여형 + 슬라이드). 배점 UI와 총점 계산에서 제외합니다. */
export function isUnscoredType(type: QuestionType | string) {
  return type === "SLIDE" || isParticipationType(type);
}

/** 이미지 위에 핀을 놓는 유형. 채점형(PIN_ANCHOR)과 참여형(DROP_PIN)이 입력 방식을 공유합니다. */
export function isPinType(type: QuestionType | string) {
  return type === "PIN_ANCHOR" || type === "DROP_PIN";
}

/**
 * 실시간 집계를 보여줄 수 있는 유형인지. 참여형만 해당합니다 — 채점형은 답이 공개되기 전에
 * 분포가 보이면 아직 답하지 않은 참가자에게 정답 힌트가 됩니다.
 */
export function supportsLiveResponses(type: QuestionType | string) {
  return isParticipationType(type);
}
