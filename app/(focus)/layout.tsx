import type { ReactNode } from "react";

/**
 * 몰입 구역(`/quiz/[quizId]/edit`, `/quiz/host/[sessionId]`)의 전체 높이 프레임입니다.
 *
 * `(play)`와 똑같은 이유로 필요합니다 — 호스트 콘솔의 무대(`live-game-surface`)가 `flex-1`로
 * 늘어나려 하는데 부모가 `display:block`인 `body`라 늘어나지 못했습니다. 실측에서 1280×900의
 * 호스트 로비가 747px, 문항 진행 중에는 400px에 그쳐 어두운 무대 아래로 밝은 배경이 드러났습니다.
 * 자세한 배경은 `app/(play)/layout.tsx` 주석 참고.
 */
export default function FocusZoneLayout({ children }: { children: ReactNode }) {
  return <div className="zone-frame">{children}</div>;
}
