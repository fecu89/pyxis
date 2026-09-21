/** 발견 범위와 방문자의 참여 권한을 구분하는 공용 정책(서버·설정 UI·목록). */
export type BoardVisitorSettings = {
  discoveryScope: "PRIVATE" | "LINK" | "PUBLIC";
  visitorPermission: "NO_ACCESS" | "READER" | "COMMENTER" | "WRITER";
  loginRequired: boolean;
};

const RANK = { NO_ACCESS: 0, READER: 1, COMMENTER: 2, WRITER: 3 } as const;

export function visitorGrantsPermission(board: BoardVisitorSettings, level: keyof typeof RANK) {
  if (board.discoveryScope === "PRIVATE") return false;
  // LINK의 과거 loginRequired=true 행은 읽기만 허용합니다. 새 설정은 항상 false로 저장합니다.
  if (board.discoveryScope === "LINK" && board.loginRequired && level !== "READER") return false;
  return RANK[board.visitorPermission] >= RANK[level];
}

export function boardAcceptsGuestPosts(board: BoardVisitorSettings) {
  return !board.loginRequired && visitorGrantsPermission(board, "WRITER");
}
