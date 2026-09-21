/**
 * 클라이언트가 그대로 쓰는 **고정 경로 상수**입니다.
 *
 * `lib/routes.ts`에서 값 하나만 import해도 라우트 표 47개가 통째로 클라이언트 번들에 실립니다
 * (그 함수·상수들이 매니페스트를 참조하므로 트리셰이킹이 지우지 못합니다). 그런데 클라이언트
 * 컴포넌트 대부분이 실제로 필요한 건 이 문자열 두세 개뿐이라, 그것만 여기로 뺐습니다.
 *
 * **이 파일은 아무것도 import하지 않습니다.** 규칙이 깨지면 위 보장도 함께 깨집니다.
 * 매니페스트가 정본이고(`lib/routes.ts`), 그쪽이 이 값들을 다시 내보내며 빌드 시점에 서로
 * 일치하는지 검사합니다.
 */
export const DASHBOARD_PATH = "/dashboard";
/** 패드 목록. 예전 DASHBOARD_PATH가 이 뜻이었으므로 "내 패드"를 가리키는 링크는 이쪽입니다. */
export const PAD_HOME_PATH = "/pad";
export const COURSE_LIST_PATH = "/courses";
export const QUIZ_ASSIGNMENTS_PATH = "/quiz/assignments";

/** 퀴즈 상세. 동적 세그먼트가 하나뿐이라 매니페스트 없이도 안전하게 만들 수 있습니다. */
export function quizDetailPath(quizId: string): string {
  return `/quiz/${encodeURIComponent(quizId)}`;
}
