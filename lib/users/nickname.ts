import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import {
  createNicknameLookup,
  decryptOptionalUserPii,
  normalizeNickname,
} from "@/lib/security/pii-crypto";

export const nicknameSchema = z.string()
  .transform(normalizeNickname)
  .pipe(z.string()
    .min(1, "닉네임을 입력해 주세요.")
    .max(60, "닉네임은 60자 이하로 입력해 주세요.")
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "닉네임에 제어 문자를 사용할 수 없습니다."));

type NicknameClient = Pick<Prisma.TransactionClient, "user">;

/**
 * 닉네임 중복은 **학교 단위**로만 봅니다. 동명이인(김민준 등)이 흔한데 전역으로 묶으면
 * 다른 학교 학생이 먼저 쓴 이름을 영영 못 쓰게 되기 때문입니다.
 *
 * `schoolId`가 null인 계정(관리자, 승인 대기 교사)은 DB 고유 인덱스가 null을 서로 다른 값으로
 * 취급해 제약이 걸리지 않으므로, 그 구간은 이 함수의 "학교 없음" 버킷 조회가 대신 막습니다.
 */
export async function isNicknameAvailable(
  name: string,
  options: { schoolId: string | null; excludeUserId?: string },
  client: NicknameClient = getPrisma(),
) {
  const normalized = normalizeNickname(name);
  const nameLookup = createNicknameLookup(normalized);
  const scope = {
    schoolId: options.schoolId,
    status: { not: "DELETED" as const },
    ...(options.excludeUserId ? { id: { not: options.excludeUserId } } : {}),
  };

  const current = await client.user.findFirst({ where: { ...scope, nameLookup }, select: { id: true } });
  if (current) return { available: false, normalized, nameLookup };

  // 배포 직후 백필 전에도 기존 암호화 닉네임과의 중복을 허용하지 않습니다. 백필이 끝나면
  // 이 조회 결과는 비어 있으므로 정상 경로는 위의 인덱스 조회 한 번으로 끝납니다.
  // 같은 학교 안에서만 훑으므로 전역 스캔이 되지 않습니다.
  const legacyUsers = await client.user.findMany({
    where: { ...scope, nameLookup: null, nameEncrypted: { not: null } },
    select: { id: true, nameEncrypted: true },
  });
  const duplicateLegacy = legacyUsers.some((user) => {
    const legacyName = decryptOptionalUserPii(user.id, "name", user.nameEncrypted);
    return legacyName ? createNicknameLookup(legacyName) === nameLookup : false;
  });
  return { available: !duplicateLegacy, normalized, nameLookup };
}

/**
 * 학교가 새로 배정되거나 바뀌는 순간(교사 승인, 관리자의 소속 변경, 반 이동)에 그 학교에서
 * 닉네임이 이미 쓰이고 있는지 확인합니다. 승인 대기 교사는 schoolId가 null인 채로 닉네임을
 * 갖고 있어, 이 검사가 없으면 배정 시점에 DB 고유 제약 위반이 그대로 500으로 터집니다.
 */
export async function findSchoolNicknameConflict(
  client: NicknameClient,
  input: { schoolId: string; userIds: string[] },
) {
  if (!input.userIds.length) return null;
  const moving = await client.user.findMany({
    where: { id: { in: input.userIds }, nameLookup: { not: null } },
    select: { id: true, nameLookup: true },
  });
  if (!moving.length) return null;

  const taken = await client.user.findMany({
    where: {
      schoolId: input.schoolId,
      status: { not: "DELETED" },
      id: { notIn: input.userIds },
      nameLookup: { in: moving.flatMap((user) => (user.nameLookup ? [user.nameLookup] : [])) },
    },
    select: { nameLookup: true },
  });
  if (!taken.length) return null;

  const takenLookups = new Set(taken.map((user) => user.nameLookup));
  const blocked = moving.find((user) => user.nameLookup && takenLookups.has(user.nameLookup));
  return blocked ? { userId: blocked.id } : null;
}

export function isNicknameUniqueConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  return Array.isArray(target)
    ? target.includes("nameLookup")
    : typeof target === "string" && target.includes("nameLookup");
}
