import "server-only";

import { getPrisma } from "@/lib/prisma";
import { decryptOptionalUserPii, decryptUserLoginIdentifier } from "@/lib/security/pii-crypto";

export type TeacherApprovalRecord = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewReason: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  user: { id: string; name: string | null; loginIdentifier: string; loginType: "LOGIN_ID" | "KAKAO_EMAIL"; image: string | null };
  school: { id: string; name: string };
  schoolGroup: { id: string; name: string };
};

export async function getTeacherApprovalForUser(userId: string) {
  const request = await getPrisma().teacherApprovalRequest.findUnique({
    where: { userId },
    select: {
      id: true,
      status: true,
      reviewReason: true,
      requestedAt: true,
      reviewedAt: true,
      school: { select: { id: true, name: true } },
      schoolGroup: { select: { id: true, name: true, type: true } },
    },
  });
  if (!request) return null;
  return {
    ...request,
    requestedAt: request.requestedAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
  };
}

export async function getTeacherApprovalQueue(input: {
  schoolId?: string;
  page: number;
  pageSize: number;
}) {
  const where = {
    status: "PENDING" as const,
    ...(input.schoolId ? { schoolId: input.schoolId } : {}),
  };
  const prisma = getPrisma();
  const [totalCount, requests] = await Promise.all([
    prisma.teacherApprovalRequest.count({ where }),
    prisma.teacherApprovalRequest.findMany({
      where,
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        status: true,
        reviewReason: true,
        requestedAt: true,
        reviewedAt: true,
        user: {
          select: {
            id: true,
            loginIdentifierEncrypted: true,
            nameEncrypted: true,
            imageEncrypted: true,
            passwordHash: true,
          },
        },
        school: { select: { id: true, name: true } },
        schoolGroup: { select: { id: true, name: true } },
      },
    }),
  ]);

  return {
    requests: requests.map((request): TeacherApprovalRecord => {
      const loginIdentifier = decryptUserLoginIdentifier(request.user.id, request.user.loginIdentifierEncrypted);
      const loginType = request.user.passwordHash ? "LOGIN_ID" as const : "KAKAO_EMAIL" as const;
      return {
        id: request.id,
        status: request.status,
        reviewReason: request.reviewReason,
        requestedAt: request.requestedAt.toISOString(),
        reviewedAt: request.reviewedAt?.toISOString() ?? null,
        user: {
          id: request.user.id,
          name: decryptOptionalUserPii(request.user.id, "name", request.user.nameEncrypted),
          loginIdentifier,
          loginType,
          image: decryptOptionalUserPii(request.user.id, "image", request.user.imageEncrypted),
        },
        school: request.school,
        schoolGroup: request.schoolGroup,
      };
    }),
    totalCount,
    page: input.page,
    pageSize: input.pageSize,
  };
}

/** 승인 탭을 열지 않았을 때는 복호화가 필요한 신청자 목록 대신 배지 숫자만 읽습니다. */
export async function getTeacherApprovalCount(schoolId?: string) {
  return getPrisma().teacherApprovalRequest.count({
    where: { status: "PENDING", ...(schoolId ? { schoolId } : {}) },
  });
}
