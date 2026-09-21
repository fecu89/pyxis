import "server-only";

import { canDownloadAttachment, canManageBoardSettings, getEffectiveBoardAccess, type EffectiveBoardAccess } from "@/lib/auth/authorization";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";

export type ExportAccessResult =
  | { ok: true; user: CurrentUser; access: EffectiveBoardAccess }
  | { ok: false; status: 401 | 403 | 404; error: string };

// CSV/XLSX/전체 첨부 ZIP은 보드 전체(승인 대기·거절 포함)를 구조화된 한 파일로 묶어 내려주므로,
// 이미 화면에서 읽을 수 있는 정보라도 대량 반출은 보드 관리자(소유자·관리자)로만 제한합니다(padupgrade.md 8.3).
export async function requireBoardExportAccess(boardId: string): Promise<ExportAccessResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, error: "로그인이 필요합니다." };
  const access = await getEffectiveBoardAccess(boardId, user);
  if (!access) return { ok: false, status: 404, error: "패드를 찾을 수 없습니다." };
  if (!canManageBoardSettings(user, access)) {
    return { ok: false, status: 403, error: "이 내보내기는 패드 관리자만 사용할 수 있습니다." };
  }
  return { ok: true, user, access };
}

// 첨부파일 ZIP은 위 관리자 검사에 더해, 보드의 첨부 다운로드 정책(READERS|MEMBERS|EDITORS|DISABLED)도
// 그대로 지킵니다 — 관리자라도 정책을 DISABLED로 걸어두면 첨부 원본은 받을 수 없습니다(전역 EDIT_ANY_CONTENT
// 권한자·전체관리자는 예외, `canDownloadAttachment` 자체 규칙을 따릅니다).
export async function requireAttachmentZipAccess(boardId: string): Promise<ExportAccessResult> {
  const result = await requireBoardExportAccess(boardId);
  if (!result.ok) return result;
  if (!canDownloadAttachment(result.user, result.access)) {
    return { ok: false, status: 403, error: "이 패드는 첨부파일 다운로드가 꺼져 있습니다." };
  }
  return result;
}
