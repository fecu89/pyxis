import "../lib/load-env";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type UserRole } from "../generated/prisma/client";
import {
  createLoginIdentifierLookup,
  createNicknameLookup,
  encryptOptionalUserPii,
  encryptUserLoginIdentifier,
  normalizeEmail,
} from "../lib/security/pii-crypto-core";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL 환경 변수가 필요합니다.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function ensureSeedUser(emailValue: string, name: string, desiredRole: UserRole) {
  const email = normalizeEmail(emailValue);
  const loginIdentifierLookup = createLoginIdentifierLookup(email);
  const existing = await prisma.user.findUnique({ where: { loginIdentifierLookup }, select: { id: true, role: true } });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        loginIdentifierEncrypted: encryptUserLoginIdentifier(existing.id, email),
        nameEncrypted: encryptOptionalUserPii(existing.id, "name", name),
        nameLookup: createNicknameLookup(name),
        role: existing.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : desiredRole,
        schoolId: "school_cheonghak_high",
        schoolGroupId: desiredRole === "STUDENT" ? "group_cheonghak_grade3_class5" : "group_cheonghak_grade3_department",
        onboardingCompletedAt: new Date(),
      },
    });
  }
  const id = randomUUID();
  return prisma.user.create({
    data: {
      id,
      loginIdentifierLookup,
      loginIdentifierEncrypted: encryptUserLoginIdentifier(id, email),
      nameEncrypted: encryptOptionalUserPii(id, "name", name),
      nameLookup: createNicknameLookup(name),
      role: desiredRole,
      schoolId: "school_cheonghak_high",
      schoolGroupId: desiredRole === "STUDENT" ? "group_cheonghak_grade3_class5" : "group_cheonghak_grade3_department",
      onboardingCompletedAt: new Date(),
    },
  });
}

async function main() {
  await prisma.school.upsert({
    where: { id: "school_cheonghak_high" },
    update: { name: "청학고등학교" },
    create: {
      id: "school_cheonghak_high",
      name: "청학고등학교",
    },
  });
  const grade3 = await prisma.schoolGrade.upsert({
    where: { schoolId_grade: { schoolId: "school_cheonghak_high", grade: 3 } },
    update: {},
    create: { schoolId: "school_cheonghak_high", grade: 3 },
  });
  await Promise.all([
    prisma.schoolGroup.upsert({
      where: { id: "group_cheonghak_grade3_class5" },
      update: { name: "3학년 5반", type: "CLASS", gradeId: grade3.id, classNumber: 5 },
      create: { id: "group_cheonghak_grade3_class5", schoolId: "school_cheonghak_high", name: "3학년 5반", type: "CLASS", gradeId: grade3.id, classNumber: 5 },
    }),
    prisma.schoolGroup.upsert({
      where: { id: "group_cheonghak_grade3_department" },
      update: { name: "3학년부", type: "DEPARTMENT", gradeId: null, classNumber: null },
      create: { id: "group_cheonghak_grade3_department", schoolId: "school_cheonghak_high", name: "3학년부", type: "DEPARTMENT" },
    }),
  ]);
  const teacher = await ensureSeedUser("teacher@pyxpad.demo", "김하늘 선생님", "TEACHER");
  const student = await ensureSeedUser("student@pyxpad.demo", "이로운", "STUDENT");

  const existing = await prisma.board.findUnique({ where: { slug: "career-exploration" }, select: { id: true } });
  if (existing) {
    // 보드는 이미 있지만 데모 계정이 다시 만들어진 개발 DB에서도 참여 화면을 검증할 수 있도록
    // 고정 교사·학생 멤버십은 매 시드 실행 때 복구합니다.
    await Promise.all([
      prisma.boardMember.upsert({
        where: { boardId_userId: { boardId: existing.id, userId: teacher.id } },
        update: { role: "OWNER" },
        create: { boardId: existing.id, userId: teacher.id, role: "OWNER" },
      }),
      prisma.boardMember.upsert({
        where: { boardId_userId: { boardId: existing.id, userId: student.id } },
        update: { role: "MEMBER" },
        create: { boardId: existing.id, userId: student.id, role: "MEMBER" },
      }),
    ]);
    return;
  }

  // 시드 보드도 활동 레코드를 갖습니다 — Board.activityId는 필수라 없으면 생성 자체가 실패합니다.
  const boardActivity = await prisma.activity.create({
    data: {
      type: "PAD_BOARD",
      ownerId: teacher.id,
      schoolId: teacher.schoolId,
      schoolGroupId: teacher.schoolGroupId,
      title: "우리 반 진로 탐색 패드",
    },
    select: { id: true },
  });
  const board = await prisma.board.create({
    data: {
      activityId: boardActivity.id,
      slug: "career-exploration",
      title: "우리 반 진로 탐색 패드",
      description: "서로의 꿈을 발견하고, 함께 응원하는 공간이에요.",
      ownerId: teacher.id,
      discoveryScope: "PUBLIC",
      visitorPermission: "READER",
      loginRequired: false,
      members: { create: [{ userId: teacher.id, role: "OWNER" }, { userId: student.id, role: "MEMBER" }] },
    },
  });
  const sections = await Promise.all([
    prisma.section.create({ data: { boardId: board.id, title: "나를 소개해요", description: "좋아하는 것과 잘하는 것을 알려주세요.", position: 1024 } }),
    prisma.section.create({ data: { boardId: board.id, title: "관심 직업 탐구", description: "궁금한 직업을 조사해 공유해요.", position: 2048 } }),
    prisma.section.create({ data: { boardId: board.id, title: "오늘의 작은 실천", description: "꿈에 가까워지는 한 걸음을 기록해요.", position: 3072 } }),
  ]);
  await prisma.post.createMany({
    data: [
      { boardId: board.id, sectionId: sections[0].id, authorId: student.id, title: "그림으로 이야기하는 걸 좋아해요", body: "관찰한 것을 그림으로 기록하는 시간이 가장 즐거워요. 언젠가 사람들에게 힘을 주는 **일러스트레이터**가 되고 싶어요.", position: 1024 },
      { boardId: board.id, sectionId: sections[1].id, authorId: teacher.id, title: "환경 데이터 분석가", body: "기후와 환경 데이터를 분석해 더 나은 선택을 돕는 직업입니다.\n\n- 수학적 사고\n- 데이터 시각화\n- 환경에 대한 관심", position: 1024, isPinned: true },
      { boardId: board.id, sectionId: sections[1].id, authorId: student.id, title: "반려동물 행동 전문가", body: "동물의 행동을 관찰하고 보호자와 반려동물이 더 행복하게 지내도록 도와요.", position: 2048 },
      { boardId: board.id, sectionId: sections[2].id, authorId: teacher.id, title: "이번 주 도전", body: "관심 있는 직업 하나를 골라 실제로 일하는 분의 인터뷰를 찾아보세요. 인상 깊은 문장을 댓글로 남겨요!", position: 1024 },
    ],
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
