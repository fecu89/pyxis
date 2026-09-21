import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getPrisma } from "@/lib/prisma";
import { decryptOptionalUserPii, decryptUserLoginIdentifier, maskLoginIdentifier } from "@/lib/security/pii-crypto";
import { toPublicAuthorDTO } from "@/lib/users/repository";

const CANDIDATE_LIMIT = 20;
const SCHOOL_SCAN_LIMIT = 500;

export type BoardMemberCandidate = {
  id: string;
  role: string;
  name: string | null;
  loginIdentifier: string;
};

/** 보드 멤버 초대·목록 API가 공유하는 응답 DTO. 단건 초대(members/route.ts)와 학급·부서
 * 일괄 추가(members/groups/route.ts)가 같은 모양을 반환하도록 여기 하나로 둡니다. */
export function boardMemberDTO(member: {
  role: "OWNER" | "ADMIN" | "EDITOR" | "MEMBER" | "VIEWER";
  user: { id: string; loginIdentifierEncrypted: string; nameEncrypted: string | null; imageEncrypted: string | null };
}) {
  return {
    role: member.role,
    user: {
      ...toPublicAuthorDTO(member.user),
      loginIdentifier: maskLoginIdentifier(decryptUserLoginIdentifier(member.user.id, member.user.loginIdentifierEncrypted)),
    },
  };
}

export function boardMemberCandidateScope(current: CurrentUser): { where: Prisma.UserWhereInput; note: null } | { where: null; note: string } {
  // 전체관리자는 학교 소속과 무관하게 전체 구성원이 초대 대상입니다 — 부트스트랩 계정처럼
  // 학교가 비어 있어도 검색이 막히면 안 됩니다.
  if (current.role === "SUPER_ADMIN") return { where: {}, note: null };
  if (!current.school) return { where: null, note: "소속 학교 정보가 없어 후보를 찾을 수 없습니다." };
  if (current.role === "STUDENT") {
    if (!current.schoolGroup) return { where: null, note: "소속 학급 정보가 없어 후보를 찾을 수 없습니다." };
    return { where: { schoolGroupId: current.schoolGroup.id }, note: null };
  }
  return { where: { schoolId: current.school.id }, note: null };
}

/** 설정의 멤버 초대와 새 패드 생성이 같은 조직 범위·마스킹 규칙을 사용합니다. */
export async function listBoardMemberCandidates(
  current: CurrentUser,
  options: { query?: string; excludeUserIds?: string[] } = {},
): Promise<{ candidates: BoardMemberCandidate[]; note?: string }> {
  const scope = boardMemberCandidateScope(current);
  if (!scope.where) return { candidates: [], note: scope.note };

  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  const excluded = new Set([current.id, ...(options.excludeUserIds ?? [])]);
  const pool = await getPrisma().user.findMany({
    where: { ...scope.where, status: "ACTIVE" },
    select: { id: true, nameEncrypted: true, loginIdentifierEncrypted: true, role: true },
    take: SCHOOL_SCAN_LIMIT,
  });

  const candidates = pool
    .filter((user) => !excluded.has(user.id))
    .map((user) => {
      const loginIdentifier = decryptUserLoginIdentifier(user.id, user.loginIdentifierEncrypted);
      return {
        id: user.id,
        role: user.role,
        name: decryptOptionalUserPii(user.id, "name", user.nameEncrypted),
        loginIdentifier,
      };
    })
    .filter((user) => !query || user.name?.toLocaleLowerCase().includes(query) || user.loginIdentifier.toLocaleLowerCase().includes(query))
    .sort((left, right) => (left.name ?? left.loginIdentifier).localeCompare(right.name ?? right.loginIdentifier, "ko"))
    .slice(0, CANDIDATE_LIMIT)
    .map((user) => ({ ...user, loginIdentifier: maskLoginIdentifier(user.loginIdentifier) }));

  return { candidates };
}
