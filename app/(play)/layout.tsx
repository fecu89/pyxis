import type { ReactNode } from "react";

/**
 * 참여 구역(`/j`, `/j/[pin]`, `/p/[sessionId]`, `/b/[slug]`, `/i/[token]`)의 전체 높이 프레임입니다.
 *
 * 이 구역에는 지금까지 layout.tsx가 없어서 루트 레이아웃만 걸렸습니다. 그런데 여기 화면들은
 * quiz에서 이식하면서 `<main className="... flex-1 ...">`으로 "남는 높이를 다 먹겠다"고 선언했고,
 * 그 부모는 `body`인데 `body`는 `min-height:100dvh`만 있을 뿐 `display:block`입니다 —
 * 플렉스 컨테이너가 아니니 `flex-1`이 아무 일도 하지 않습니다. 그래서 1280×900에서 `/j`의
 * main이 688px에 그치고 화면 아래쪽에 배경색 띠가 남았습니다(사용자 신고: "div 높이가 화면을
 * 다 차지하지 못하고 위로 몰려있어").
 *
 * `body`를 통째로 flex로 바꾸면 workspace·auth·marketing까지 영향이 가므로, 이 구역에만
 * 프레임을 하나 세워 `flex-1`이 기대대로 동작하게 합니다(workspace에서 `.app-frame`이 하는 일과
 * 같습니다). 자기 높이를 이미 스스로 정하는 화면(`.board-page`, `.post-page`,
 * `h-[var(--vvh,100dvh)]`를 쓰는 풀이 화면)은 이 프레임 아래에서도 그대로 동작합니다.
 */
export default function PlayZoneLayout({ children }: { children: ReactNode }) {
  return <div className="zone-frame">{children}</div>;
}
