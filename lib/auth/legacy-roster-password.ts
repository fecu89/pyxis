import "server-only";

/**
 * 2026-08-13 이전 명렬 업로드가 잠시 사용했던 초기 비밀번호 규칙입니다. 새 계정에는 쓰지
 * 않고, 아직 비밀번호를 바꾸지 않은 기존 학생이 현재 안내값(아이디)을 입력했을 때 저장된
 * 해시가 정말 이 값인지 확인하는 호환 로그인에만 사용합니다.
 */
export function legacyRosterInitialPassword(name: string, loginId: string) {
  const firstCharacter = Array.from(name.trim())[0];
  if (!firstCharacter || loginId.length < 5) return null;
  return `${firstCharacter}${loginId.slice(-5)}`;
}
