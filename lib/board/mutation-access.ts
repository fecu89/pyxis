import "server-only";

import { AuthorizationError, canReadEffectiveBoard, hasSystemPermission, type AuthorizationUser } from "@/lib/auth/authorization";
import { hasVerifiedBoardPassword } from "@/lib/board/board-password";
import { getBoardAccess } from "@/lib/board/permissions";

/** 콘텐츠 변경은 페이지와 같은 접근·비밀번호 경계를 통과한 뒤 개별 작업 권한을 검사합니다. */
export async function getBoardMutationAccess(boardId: string, user: AuthorizationUser | null) {
  const access = await getBoardAccess(boardId, user?.id ?? null);
  if (!access) return null;
  if (!canReadEffectiveBoard(user, access)) throw new AuthorizationError("패드에 접근할 권한이 없습니다.");
  const bypassPassword = access.role !== null || Boolean(user && hasSystemPermission(user, "VIEW_ALL_BOARDS"));
  if (!bypassPassword && access.board.passwordHash && !(await hasVerifiedBoardPassword(boardId, access.board.passwordHash))) {
    throw new AuthorizationError("패드 비밀번호를 먼저 확인해 주세요.");
  }
  return access;
}
