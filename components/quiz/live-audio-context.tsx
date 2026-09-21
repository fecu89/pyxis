"use client";

import { createContext, useContext, type ReactNode } from "react";

const noScoreSound = () => undefined;
const QuizScoreSoundContext = createContext<() => void>(noScoreSound);

/** 점수 숫자 UI가 전체 오디오 엔진을 import하지 않고 공유 효과음만 호출하는 작은 경계입니다. */
export function useQuizScoreSound() {
  return useContext(QuizScoreSoundContext);
}

export function QuizScoreSoundProvider({ play, children }: { play: () => void; children: ReactNode }) {
  return <QuizScoreSoundContext.Provider value={play}>{children}</QuizScoreSoundContext.Provider>;
}
