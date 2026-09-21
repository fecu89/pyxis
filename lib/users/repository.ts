import "server-only";

import type { Prisma, RegistrationApprovalStatus, SystemPermission, UserRole, UserStatus } from "@/generated/prisma/client";
import {
  createLoginIdentifierLookup,
  createNicknameLookup,
  decryptOptionalUserPii,
  decryptUserLoginIdentifier as decryptStoredLoginIdentifier,
} from "@/lib/security/pii-crypto";
import { getPrisma } from "@/lib/prisma";
import { normalizeProfileImageUrl } from "@/lib/users/profile-image-url";

export type PublicAuthorDTO = {
  id: string;
  name: string | null;
  image: string | null;
};

export type PrivateUserDTO = PublicAuthorDTO & {
  loginIdentifier: string;
  loginType: "LOGIN_ID" | "KAKAO_EMAIL";
  loginId: string | null;
  email: string | null;
  role: UserRole;
  status: UserStatus;
  registrationApprovalStatus: RegistrationApprovalStatus;
  registrationReviewReason: string | null;
  registrationReviewedAt: Date | null;
  authVersion: number;
  hasPasswordCredential: boolean;
  mustChangePassword: boolean;
  studentNumber: number | null;
  onboardingCompletedAt: Date | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  systemPermissions: SystemPermission[];
  school: { id: string; name: string } | null;
  schoolGroup: { id: string; name: string; type: "CLASS" | "DEPARTMENT" } | null;
  isSchoolRepresentative: boolean;
};

export type AdminUserDTO = {
  id: string;
  name: string | null;
  loginIdentifier: string;
  loginType: "LOGIN_ID" | "KAKAO_EMAIL";
  role: UserRole;
  status: UserStatus;
  authVersion: number;
  hasPasswordCredential: boolean;
  mustChangePassword: boolean;
  studentNumber: number | null;
  lastLoginAt: string | null;
  createdAt: string;
  ownedBoardCount: number;
  memberBoardCount: number;
  systemPermissions: SystemPermission[];
  school: { id: string; name: string } | null;
  schoolGroup: { id: string; name: string; type: "CLASS" | "DEPARTMENT" } | null;
  isSchoolRepresentative: boolean;
};

export type AdminUserListFilters = {
  page: number;
  pageSize: number;
  role?: UserRole;
  status?: UserStatus;
  query?: string;
  schoolId?: string;
  schoolGroupId?: string;
};

export const ADMIN_USER_SEARCH_SCAN_LIMIT = 1_000;

const ADMIN_USER_SELECT = {
  id: true,
  loginIdentifierEncrypted: true,
  nameEncrypted: true,
  role: true,
  status: true,
  authVersion: true,
  passwordHash: true,
  mustChangePassword: true,
  studentNumber: true,
  lastLoginAt: true,
  createdAt: true,
  systemPermissions: { select: { permission: true }, orderBy: { permission: "asc" as const } },
  school: { select: { id: true, name: true } },
  schoolGroup: { select: { id: true, name: true, type: true } },
  isSchoolRepresentative: true,
  _count: { select: { ownedBoards: true, memberships: true } },
} as const;

const ADMIN_USER_SEARCH_SELECT = {
  id: true,
  loginIdentifierEncrypted: true,
  nameEncrypted: true,
  createdAt: true,
} as const;

type AdminUserRow = Prisma.UserGetPayload<{ select: typeof ADMIN_USER_SELECT }>;

export type EncryptedPublicUser = {
  id: string;
  nameEncrypted: string | null;
  imageEncrypted: string | null;
};

export function toPublicAuthorDTO(user: EncryptedPublicUser): PublicAuthorDTO {
  return {
    id: user.id,
    name: decryptOptionalUserPii(user.id, "name", user.nameEncrypted),
    image: normalizeProfileImageUrl(decryptOptionalUserPii(user.id, "image", user.imageEncrypted)),
  };
}

// 소유자 계정이 삭제됐는데 승계 대상을 못 찾은 패드는 owner가 비어 있습니다(lib/board/succession.ts).
// 화면·DTO는 소유자 자리가 늘 채워져 있다고 가정하므로, 여기서 자리표시자로 바꿔 줍니다.
// id는 빈 문자열이라 어떤 사용자 id와도 일치하지 않습니다 — 소유자 비교가 참이 되는 사고를 막습니다.
export const ORPHAN_OWNER_DTO: PublicAuthorDTO = { id: "", name: "소유자 없음", image: null };

export function toPublicOwnerDTO(owner: EncryptedPublicUser | null): PublicAuthorDTO {
  return owner ? toPublicAuthorDTO(owner) : ORPHAN_OWNER_DTO;
}

export function decryptUserLoginIdentifier(user: { id: string; loginIdentifierEncrypted: string | null }) {
  if (!user.loginIdentifierEncrypted) throw new Error("사용자 로그인 식별자 암호화 데이터가 준비되지 않았습니다.");
  return decryptStoredLoginIdentifier(user.id, user.loginIdentifierEncrypted);
}

export function toPrivateUserDTO(user: {
  id: string;
  loginIdentifierEncrypted: string | null;
  nameEncrypted: string | null;
  imageEncrypted: string | null;
  role: UserRole;
  status: UserStatus;
  registrationApprovalStatus: RegistrationApprovalStatus;
  registrationReviewReason: string | null;
  registrationReviewedAt: Date | null;
  authVersion: number;
  passwordHash: string | null;
  mustChangePassword: boolean;
  studentNumber: number | null;
  onboardingCompletedAt: Date | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  systemPermissions: { permission: SystemPermission }[];
  school: { id: string; name: string } | null;
  schoolGroup: { id: string; name: string; type: "CLASS" | "DEPARTMENT" } | null;
  isSchoolRepresentative: boolean;
}): PrivateUserDTO {
  const loginIdentifier = decryptUserLoginIdentifier(user);
  const hasPasswordCredential = Boolean(user.passwordHash);
  return {
    ...toPublicAuthorDTO(user),
    loginIdentifier,
    loginType: hasPasswordCredential ? "LOGIN_ID" : "KAKAO_EMAIL",
    loginId: hasPasswordCredential ? loginIdentifier : null,
    email: hasPasswordCredential ? null : loginIdentifier,
    role: user.role,
    status: user.status,
    registrationApprovalStatus: user.registrationApprovalStatus,
    registrationReviewReason: user.registrationReviewReason,
    registrationReviewedAt: user.registrationReviewedAt,
    authVersion: user.authVersion,
    hasPasswordCredential,
    mustChangePassword: user.mustChangePassword,
    studentNumber: user.studentNumber,
    onboardingCompletedAt: user.onboardingCompletedAt,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    systemPermissions: user.systemPermissions.map(({ permission }) => permission),
    school: user.school,
    schoolGroup: user.schoolGroup,
    isSchoolRepresentative: user.isSchoolRepresentative,
  };
}

export async function getPrivateUserDTO(userId: string) {
  const user = await getPrisma().user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      loginIdentifierEncrypted: true,
      nameEncrypted: true,
      imageEncrypted: true,
      role: true,
      status: true,
      registrationApprovalStatus: true,
      registrationReviewReason: true,
      registrationReviewedAt: true,
      authVersion: true,
      passwordHash: true,
      mustChangePassword: true,
      studentNumber: true,
      onboardingCompletedAt: true,
      createdAt: true,
      lastLoginAt: true,
      systemPermissions: { select: { permission: true } },
      school: { select: { id: true, name: true } },
      schoolGroup: { select: { id: true, name: true, type: true } },
      isSchoolRepresentative: true,
    },
  });
  return user ? toPrivateUserDTO(user) : null;
}

export function toAdminUserDTO(user: AdminUserRow): AdminUserDTO {
  const loginIdentifier = decryptUserLoginIdentifier(user);
  const hasPasswordCredential = Boolean(user.passwordHash);
  return {
    id: user.id,
    name: decryptOptionalUserPii(user.id, "name", user.nameEncrypted),
    loginIdentifier,
    loginType: hasPasswordCredential ? "LOGIN_ID" : "KAKAO_EMAIL",
    role: user.role,
    status: user.status,
    authVersion: user.authVersion,
    hasPasswordCredential,
    mustChangePassword: user.mustChangePassword,
    studentNumber: user.studentNumber,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    ownedBoardCount: user._count.ownedBoards,
    memberBoardCount: user._count.memberships,
    systemPermissions: user.systemPermissions.map(({ permission }) => permission),
    school: user.school,
    schoolGroup: user.schoolGroup,
    isSchoolRepresentative: user.isSchoolRepresentative,
  };
}

export async function getAdminUserPage(filters: AdminUserListFilters) {
  const where: Prisma.UserWhereInput = {
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.schoolId ? { schoolId: filters.schoolId } : {}),
    ...(filters.schoolGroupId ? { schoolGroupId: filters.schoolGroupId } : {}),
    ...(!filters.status ? { status: { not: "DELETED" as const } } : {}),
    // 교사 가입 승인 대기 중인 지원자는 아직 학교·역할이 정해지지 않은 임시 상태라 여기서는
    // 숨기고, 승인 전까지는 `교사 가입 요청` 대기열에서만 보이게 합니다(승인·반려 후에는
    // role/status가 확정되므로 다시 이 목록에 나타납니다).
    NOT: [
      { registrationApprovalStatus: "PENDING" as const },
      { teacherApprovalRequest: { status: "PENDING" as const } },
    ],
  };
  const prisma = getPrisma();
  const query = filters.query?.trim() ?? "";

  if (query) {
    const normalizedNeedle = query.normalize("NFKC").toLocaleLowerCase("ko-KR");
    const exactWhere: Prisma.UserWhereInput = {
      AND: [
        where,
        {
          OR: [
            { loginIdentifierLookup: createLoginIdentifierLookup(query) },
            { nameLookup: createNicknameLookup(query) },
          ],
        },
      ],
    };
    const [scanned, exact] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: ADMIN_USER_SEARCH_SCAN_LIMIT + 1,
        select: ADMIN_USER_SEARCH_SELECT,
      }),
      prisma.user.findMany({
        where: exactWhere,
        select: { id: true, createdAt: true },
      }),
    ]);
    const matchedById = new Map<string, { id: string; createdAt: Date }>();
    for (const user of scanned.slice(0, ADMIN_USER_SEARCH_SCAN_LIMIT)) {
      const name = decryptOptionalUserPii(user.id, "name", user.nameEncrypted);
      const loginIdentifier = decryptUserLoginIdentifier(user);
      if (name?.normalize("NFKC").toLocaleLowerCase("ko-KR").includes(normalizedNeedle)
        || loginIdentifier.normalize("NFKC").toLocaleLowerCase("ko-KR").includes(normalizedNeedle)) {
        matchedById.set(user.id, { id: user.id, createdAt: user.createdAt });
      }
    }
    for (const user of exact) matchedById.set(user.id, user);
    const matched = [...matchedById.values()].sort((left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id));
    const totalCount = matched.length;
    const page = Math.min(filters.page, Math.max(1, Math.ceil(totalCount / filters.pageSize)));
    const pageIds = matched
      .slice((page - 1) * filters.pageSize, page * filters.pageSize)
      .map((user) => user.id);
    const rows = pageIds.length
      ? await prisma.user.findMany({ where: { id: { in: pageIds } }, select: ADMIN_USER_SELECT })
      : [];
    const rowById = new Map(rows.map((row) => [row.id, row]));
    return {
      users: pageIds.flatMap((id) => {
        const row = rowById.get(id);
        return row ? [toAdminUserDTO(row)] : [];
      }),
      totalCount,
      page,
      pageSize: filters.pageSize,
      searchTruncated: scanned.length > ADMIN_USER_SEARCH_SCAN_LIMIT,
    };
  }

  const [totalCount, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      select: ADMIN_USER_SELECT,
    }),
  ]);
  return {
    users: users.map(toAdminUserDTO),
    totalCount,
    page: filters.page,
    pageSize: filters.pageSize,
    searchTruncated: false,
  };
}

/** 관리자 사이드바 배지는 상세 사용자 DTO·관계 목록 없이 활성 사용자 수만 셉니다. */
export async function getAdminUserCount(schoolId?: string) {
  return getPrisma().user.count({
    where: {
      ...(schoolId ? { schoolId } : {}),
      status: { not: "DELETED" },
      NOT: [
        { registrationApprovalStatus: "PENDING" },
        { teacherApprovalRequest: { status: "PENDING" } },
      ],
    },
  });
}
