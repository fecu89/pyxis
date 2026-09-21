import "server-only";

import { getPrisma } from "@/lib/prisma";
import { maskLoginIdentifier } from "@/lib/security/pii-crypto";
import { decryptUserLoginIdentifier, toPublicAuthorDTO, type EncryptedPublicUser } from "@/lib/users/repository";
import { teacherShareCandidateScope, type ShareScopeActor } from "@/lib/users/share-scope";
import type { FormPermission } from "@/generated/prisma/enums";

// 설문 공유. `app/api/quiz/quizzes/[quizId]/shares/*`와 같은 자리·같은 규칙입니다 — 다른 점은
// 학생이 설문을 소유할 길이 없다는 것뿐입니다(폼 생성이 교사 이상으로만 열려 있어서,
// 퀴즈의 "학생 퀴즈는 공유 못 함" 분기가 설문에는 아예 필요 없습니다).

export type ShareTeacher = { id: string; name: string | null; maskedLoginIdentifier: string | null };
export type FormShareData = { shares: Array<{ permission: FormPermission; user: ShareTeacher }>; candidates: ShareTeacher[] };

type EncryptedTeacher = EncryptedPublicUser & { loginIdentifierEncrypted: string };

function toShareTeacher(user: EncryptedTeacher): ShareTeacher {
  return {
    id: user.id,
    name: toPublicAuthorDTO(user).name,
    maskedLoginIdentifier: maskLoginIdentifier(decryptUserLoginIdentifier(user)),
  };
}

// `candidates`는 `teacherShareCandidateScope(actor)` 범위(같은 학교, VIEW_USERS면 전체)로
// 좁힙니다. 이미 공유된 대상(`shares`)은 범위와 무관하게 그대로 내려줍니다 — 학교 밖 교사와
// 맺어 둔 기존 공유의 확인·해제가 끊기면 안 됩니다.
export async function listFormShares(formId: string, ownerId: string, actor: ShareScopeActor): Promise<FormShareData> {
  const prisma = getPrisma();
  const [shares, candidates] = await Promise.all([
    prisma.formShare.findMany({
      where: { formId },
      orderBy: { createdAt: "asc" },
      select: {
        permission: true,
        user: { select: { id: true, nameEncrypted: true, imageEncrypted: true, loginIdentifierEncrypted: true } },
      },
    }),
    prisma.user.findMany({
      where: { role: "TEACHER", status: "ACTIVE", id: { not: ownerId }, ...teacherShareCandidateScope(actor) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 300,
      select: { id: true, nameEncrypted: true, imageEncrypted: true, loginIdentifierEncrypted: true },
    }),
  ]);
  // 이름이 암호문이라 DB에서 정렬할 수 없어 복호화 뒤 정렬합니다(교사 수 규모라 문제없습니다).
  const collator = new Intl.Collator("ko-KR");
  return {
    shares: shares.map((share) => ({ permission: share.permission, user: toShareTeacher(share.user) })),
    candidates: candidates.map(toShareTeacher).sort((a, b) => collator.compare(a.name ?? "", b.name ?? "")),
  };
}

export class ShareTargetError extends Error {}

export async function upsertFormShare(formId: string, ownerId: string, actor: ShareScopeActor & { id: string }, targetUserId: string, permission: FormPermission): Promise<void> {
  if (targetUserId === ownerId) throw new ShareTargetError("설문 소유자에게는 이미 모든 권한이 있습니다.");
  const prisma = getPrisma();
  // 이미 공유 행이 있는 대상은 scope와 무관하게 허용합니다 — 후보를 같은 학교로 축소하기
  // 이전에 맺어진 학교 밖 공유의 권한 변경(업서트)이 막히면 기존 관계를 관리할 수 없게 됩니다.
  const existing = await prisma.formShare.findUnique({ where: { formId_userId: { formId, userId: targetUserId } }, select: { userId: true } });
  // 범위 밖 대상도 존재하지 않는 대상과 같은 "찾을 수 없음"으로 응답합니다 — 다른 메시지를
  // 노출하면 범위 밖 계정의 존재 여부가 흘러 나갑니다.
  const target = await prisma.user.findFirst({
    where: { id: targetUserId, role: "TEACHER", status: "ACTIVE", ...(existing ? {} : teacherShareCandidateScope(actor)) },
    select: { id: true },
  });
  if (!target) throw new ShareTargetError("공유할 교사를 찾을 수 없습니다.");

  await prisma.$transaction(async (tx) => {
    await tx.formShare.upsert({
      where: { formId_userId: { formId, userId: targetUserId } },
      create: { formId, userId: targetUserId, permission, grantedById: actor.id },
      update: { permission, grantedById: actor.id },
    });
    await tx.notification.create({ data: { userId: targetUserId, actorId: actor.id, type: "FORM_SHARED", formId } });
  });
}

export async function removeFormShare(formId: string, userId: string): Promise<void> {
  await getPrisma().formShare.deleteMany({ where: { formId, userId } });
}
