import "../lib/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { encode } from "next-auth/jwt";
import { getPrisma } from "../lib/prisma";
import { normalizeSubjectName } from "../lib/quiz/subjects";
import { createLoginIdentifierLookup, encryptOptionalUserPii, encryptUserPii } from "../lib/security/pii-crypto-core";

const baseUrl = process.env.VERIFY_BASE_URL || "http://localhost:3001";
const requestOrigin = process.env.VERIFY_ORIGIN || process.env.APP_ORIGINS?.split(",")[0]?.trim() || baseUrl;
function requireAuthSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET 환경 변수가 필요합니다.");
  return value;
}

const secret = requireAuthSecret();

const cleanupActivityIds: string[] = [];
const cleanupSubjectIds: string[] = [];
const cleanupUserIds: string[] = [];
const cleanupSchoolIds: string[] = [];

function userData(id: string, loginId: string, name: string, schoolId: string) {
  return {
    id,
    loginIdentifierLookup: createLoginIdentifierLookup(loginId),
    loginIdentifierEncrypted: encryptUserPii(id, "email", loginId),
    nameEncrypted: encryptOptionalUserPii(id, "name", name),
    role: "TEACHER" as const,
    schoolId,
    onboardingCompletedAt: new Date(),
  };
}

async function sessionCookie(user: { id: string; authVersion: number }) {
  const token = await encode({
    secret,
    maxAge: 300,
    token: {
      userId: user.id,
      authVersion: user.authVersion,
      sessionInvalid: false,
      onboardingState: "COMPLETE",
      onboardingCompleted: true,
    },
  });
  return `next-auth.session-token=${token}; __Secure-next-auth.session-token=${token}`;
}

async function createBoard(cookie: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/boards`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function main() {
  const prisma = getPrisma();
  const suffix = `${Date.now()}-${randomUUID().slice(0, 6)}`;
  const [school, otherSchool] = await Promise.all([
    prisma.school.create({ data: { name: `[검증용] 패드 생성 학교 ${suffix}` }, select: { id: true } }),
    prisma.school.create({ data: { name: `[검증용] 다른 학교 ${suffix}` }, select: { id: true } }),
  ]);
  cleanupSchoolIds.push(school.id, otherSchool.id);

  const ownerId = randomUUID();
  const candidateId = randomUUID();
  const outsiderId = randomUUID();
  cleanupUserIds.push(ownerId, candidateId, outsiderId);
  const [owner] = await Promise.all([
    prisma.user.create({
      data: userData(ownerId, `verify-owner-${suffix}@invalid.local`, "검증용 패드 소유자", school.id),
      select: { id: true, authVersion: true },
    }),
    prisma.user.create({ data: userData(candidateId, `verify-candidate-${suffix}@invalid.local`, "검증용 초대 멤버", school.id) }),
    prisma.user.create({ data: userData(outsiderId, `verify-outsider-${suffix}@invalid.local`, "검증용 다른 학교 멤버", otherSchool.id) }),
  ]);

  const [subject, foreignSubject] = await Promise.all([
    prisma.subject.create({
      data: { ownerId, name: `검증 교과목 ${suffix}`, nameNormalized: normalizeSubjectName(`검증 교과목 ${suffix}`) },
      select: { id: true },
    }),
    prisma.subject.create({
      data: { ownerId: outsiderId, name: `다른 교과목 ${suffix}`, nameNormalized: normalizeSubjectName(`다른 교과목 ${suffix}`) },
      select: { id: true },
    }),
  ]);
  cleanupSubjectIds.push(subject.id, foreignSubject.id);
  const cookie = await sessionCookie(owner);

  const candidatesResponse = await fetch(`${baseUrl}/api/boards/member-candidates?q=${encodeURIComponent("초대 멤버")}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(candidatesResponse.status, 200, `생성 후보 API가 열려야 합니다: ${await candidatesResponse.clone().text()}`);
  const candidatesPayload = await candidatesResponse.json() as { candidates: Array<{ id: string; loginIdentifier: string }> };
  assert.ok(candidatesPayload.candidates.some((candidate) => candidate.id === candidateId), "같은 학교 구성원이 후보에 있어야 합니다.");
  assert.ok(!candidatesPayload.candidates.some((candidate) => candidate.id === outsiderId), "다른 학교 구성원은 후보에 없어야 합니다.");
  assert.doesNotMatch(JSON.stringify(candidatesPayload), new RegExp(`verify-candidate-${suffix}@invalid\\.local`), "로그인 식별자 원문을 노출하면 안 됩니다.");

  const selectedResponse = await createBoard(cookie, {
    title: `[검증용] 선택 생성 ${suffix}`,
    description: "교과목과 멤버를 함께 선택",
    subjectName: `검증 교과목 ${suffix}`,
    memberIds: [candidateId],
  });
  assert.equal(selectedResponse.status, 201, `교과목과 멤버를 선택해 만들 수 있어야 합니다: ${await selectedResponse.clone().text()}`);
  const selectedBoard = (await selectedResponse.json() as { board: { id: string } }).board;
  const selectedRow = await prisma.board.findUnique({
    where: { id: selectedBoard.id },
    select: {
      activityId: true,
      subjectId: true,
      members: { orderBy: { userId: "asc" }, select: { userId: true, role: true } },
      follows: { orderBy: { userId: "asc" }, select: { userId: true } },
    },
  });
  assert.ok(selectedRow);
  cleanupActivityIds.push(selectedRow.activityId);
  assert.equal(selectedRow.subjectId, subject.id);
  assert.deepEqual(new Set(selectedRow.members.map((member) => `${member.userId}:${member.role}`)), new Set([`${ownerId}:OWNER`, `${candidateId}:MEMBER`]));
  assert.deepEqual(new Set(selectedRow.follows.map((follow) => follow.userId)), new Set([ownerId, candidateId]));

  const emptyResponse = await createBoard(cookie, { title: `[검증용] 선택 없음 ${suffix}` });
  assert.equal(emptyResponse.status, 201, `선택 항목 없이도 만들 수 있어야 합니다: ${await emptyResponse.clone().text()}`);
  const emptyBoard = (await emptyResponse.json() as { board: { id: string } }).board;
  const emptyRow = await prisma.board.findUnique({
    where: { id: emptyBoard.id },
    select: { activityId: true, subjectId: true, members: { select: { userId: true, role: true } } },
  });
  assert.ok(emptyRow);
  cleanupActivityIds.push(emptyRow.activityId);
  assert.equal(emptyRow.subjectId, null);
  assert.deepEqual(emptyRow.members, [{ userId: ownerId, role: "OWNER" }]);

  // 이름 입력 방식(quiz와 동일)이므로: 없던 이름은 내 교과목으로 새로 생기고, 남의 교과목과
  // 이름이 같아도 남의 것에 연결되지 않고 내 소유로 따로 만들어져야 합니다.
  const newNameResponse = await createBoard(cookie, { title: `[검증용] 새 교과목 ${suffix}`, subjectName: `다른 교과목 ${suffix}` });
  assert.equal(newNameResponse.status, 201, `새 교과목 이름으로도 만들 수 있어야 합니다: ${await newNameResponse.clone().text()}`);
  const newNameBoard = (await newNameResponse.json() as { board: { id: string } }).board;
  const newNameRow = await prisma.board.findUnique({
    where: { id: newNameBoard.id },
    select: { activityId: true, subject: { select: { id: true, ownerId: true, name: true } } },
  });
  assert.ok(newNameRow?.subject);
  cleanupActivityIds.push(newNameRow.activityId);
  cleanupSubjectIds.push(newNameRow.subject.id);
  assert.notEqual(newNameRow.subject.id, foreignSubject.id, "남의 교과목에 연결되면 안 됩니다.");
  assert.equal(newNameRow.subject.ownerId, ownerId, "새 교과목은 생성자 소유여야 합니다.");
  assert.equal(newNameRow.subject.name, `다른 교과목 ${suffix}`);

  const outsiderResponse = await createBoard(cookie, { title: "거절할 멤버", memberIds: [outsiderId] });
  assert.equal(outsiderResponse.status, 400, "다른 학교 사용자는 초대할 수 없어야 합니다.");

  console.log(`board_create_options_checks=passed selected=${selectedBoard.id} optional=${emptyBoard.id}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "패드 생성 선택 항목 검증에 실패했습니다.");
    process.exitCode = 1;
  })
  .finally(async () => {
    const prisma = getPrisma();
    if (cleanupActivityIds.length) await prisma.activity.deleteMany({ where: { id: { in: cleanupActivityIds } } });
    if (cleanupSubjectIds.length) await prisma.subject.deleteMany({ where: { id: { in: cleanupSubjectIds } } });
    if (cleanupUserIds.length) await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
    if (cleanupSchoolIds.length) await prisma.school.deleteMany({ where: { id: { in: cleanupSchoolIds } } });
    await prisma.$disconnect();
  });
