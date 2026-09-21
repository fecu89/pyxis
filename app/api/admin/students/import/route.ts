import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { AuthorizationError, requireActiveUser } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { hashUserPassword } from "@/lib/auth/password";
import { streamMultipartFile } from "@/lib/files/multipart";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { createLoginIdentifierLookup, createNicknameLookup, encryptUserLoginIdentifier, encryptUserPii, normalizeNickname } from "@/lib/security/pii-crypto";
import { assertRateLimit } from "@/lib/security/rate-limit";
import {
  buildStudentRosterTemplate,
  normalizeStudentIdPrefix,
  parseStudentRoster,
  STUDENT_ROSTER_MAX_BYTES,
  StudentRosterError,
  type StudentRosterRow,
} from "@/lib/users/student-roster";

// 최대 500명의 scrypt 해시는 비밀번호 강도를 낮추지 않고 처리하면 일반 서버에서 1분을
// 넘길 수 있습니다. 관리자 전용 일괄 작업이 중간에 끊기지 않도록 함수 실행 한도를 넉넉히 둡니다.
export const maxDuration = 300;

const importReasonSchema = z.string().trim().min(3, "등록 사유를 3자 이상 입력해 주세요.").max(500);

function canImportStudents(actor: Awaited<ReturnType<typeof requireActiveUser>>) {
  return actor.role === "SUPER_ADMIN"
    || (actor.role === "TEACHER" && actor.isSchoolRepresentative && actor.school !== null);
}

function assertCanImportStudents(actor: Awaited<ReturnType<typeof requireActiveUser>>) {
  if (!canImportStudents(actor)) throw new AuthorizationError("학생 명단을 등록할 권한이 없습니다.");
}

function noStoreJson(body: Record<string, unknown>, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  return Response.json(body, { ...init, headers });
}

function uniqueKey(parts: Array<string | number>) {
  return parts.join("\u0000");
}

async function inspectRoster(rows: StudentRosterRow[]) {
  const prisma = getPrisma();
  const schoolNames = [...new Set(rows.map((row) => row.schoolName))];
  const loginLookups = rows.map((row) => createLoginIdentifierLookup(row.loginId));
  const [schools, existingUsers] = await Promise.all([
    prisma.school.findMany({
      where: { name: { in: schoolNames } },
      select: {
        id: true,
        name: true,
        grades: { select: { id: true, grade: true } },
        groups: { where: { type: "CLASS" }, select: { gradeId: true, classNumber: true } },
      },
    }),
    prisma.user.findMany({ where: { loginIdentifierLookup: { in: loginLookups } }, select: { loginIdentifierLookup: true } }),
  ]);
  const schoolByName = new Map(schools.map((school) => [school.name, school]));
  const existingLoginLookups = new Set(existingUsers.map((user) => user.loginIdentifierLookup));
  const newSchools = schoolNames.filter((name) => !schoolByName.has(name));
  const gradeKeys = new Set<string>();
  const classKeys = new Set<string>();
  const newGradeKeys = new Set<string>();
  const newClassKeys = new Set<string>();
  for (const row of rows) {
    const school = schoolByName.get(row.schoolName);
    const gradeKey = uniqueKey([row.schoolName, row.grade]);
    const classKey = uniqueKey([row.schoolName, row.grade, row.classNumber]);
    gradeKeys.add(gradeKey);
    classKeys.add(classKey);
    const grade = school?.grades.find((item) => item.grade === row.grade);
    if (!grade) newGradeKeys.add(gradeKey);
    const classExists = Boolean(grade && school?.groups.some((group) => group.gradeId === grade.id && group.classNumber === row.classNumber));
    if (!classExists) newClassKeys.add(classKey);
  }
  const conflicts = rows
    .filter((row) => existingLoginLookups.has(createLoginIdentifierLookup(row.loginId)))
    .map((row) => ({ line: row.line, loginId: row.loginId, reason: "이미 등록된 아이디" }));
  return {
    schoolByName,
    newSchools,
    gradeCount: gradeKeys.size,
    classCount: classKeys.size,
    newGradeCount: newGradeKeys.size,
    newClassCount: newClassKeys.size,
    conflicts,
  };
}

function truncate(value: string, maxLength: number) {
  return Array.from(value).slice(0, maxLength).join("");
}

async function assignUniqueNicknames(rows: StudentRosterRow[]) {
  const candidates = rows.flatMap((row) => {
    const base = normalizeNickname(row.name);
    const localPart = row.loginId;
    const suffixed = `${truncate(base, Math.max(1, 57 - localPart.length))} · ${localPart}`;
    const fallback = `${truncate(base, Math.max(1, 53 - localPart.length))} · ${localPart}-${row.line}`;
    return [base, suffixed, fallback];
  });
  const lookups = [...new Set(candidates.map(createNicknameLookup))];
  // 닉네임 유일성은 학교 단위이므로, 이미 쓰이는 이름도 명단에 적힌 학교들 안에서만 찾습니다.
  // 전역으로 찾으면 다른 학교가 쓴 이름 때문에 멀쩡한 이름에 접미사가 붙습니다.
  const schoolNames = [...new Set(rows.map((row) => row.schoolName))];
  const existing = await getPrisma().user.findMany({
    where: { nameLookup: { in: lookups }, status: { not: "DELETED" }, school: { name: { in: schoolNames } } },
    select: { nameLookup: true, school: { select: { name: true } } },
  });
  // 학교별로 따로 셉니다. 같은 이름이라도 학교가 다르면 둘 다 쓸 수 있습니다.
  const occupiedBySchool = new Map<string, Set<string>>();
  const occupiedFor = (schoolName: string) => {
    const current = occupiedBySchool.get(schoolName) ?? new Set<string>();
    occupiedBySchool.set(schoolName, current);
    return current;
  };
  for (const user of existing) {
    if (user.nameLookup && user.school) occupiedFor(user.school.name).add(user.nameLookup);
  }
  return rows.map((row) => {
    const base = normalizeNickname(row.name);
    const localPart = row.loginId;
    const options = [
      base,
      `${truncate(base, Math.max(1, 57 - localPart.length))} · ${localPart}`,
      `${truncate(base, Math.max(1, 53 - localPart.length))} · ${localPart}-${row.line}`,
    ];
    const occupied = occupiedFor(row.schoolName);
    const nickname = options.find((option) => !occupied.has(createNicknameLookup(option)));
    if (!nickname) throw new StudentRosterError(`${row.line}행 학생의 표시 이름을 고유하게 만들지 못했습니다.`);
    const nameLookup = createNicknameLookup(nickname);
    occupied.add(nameLookup);
    return { nickname, nameLookup };
  });
}

async function hashInitialPasswords(rows: StudentRosterRow[]) {
  const hashes = new Array<string>(rows.length);
  let cursor = 0;
  const workerCount = Math.min(4, rows.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      hashes[index] = await hashUserPassword(rows[index].initialPassword);
    }
  }));
  return hashes;
}

export async function GET() {
  try {
    const actor = await requireActiveUser();
    assertCanImportStudents(actor);
    const workbook = await buildStudentRosterTemplate();
    return new Response(new Uint8Array(workbook), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": "attachment; filename=forms.xlsx",
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error, "학생 명단 양식을 만들지 못했습니다.");
  }
}

export async function POST(request: Request) {
  let rosterUploadPath: string | null = null;
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    assertCanImportStudents(actor);
    assertRateLimit(request, {
      scope: "student-roster-import",
      userId: actor.id,
      windowMs: 10 * 60_000,
      maxAttempts: 20,
      message: "학생 명단 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
    });
    const upload = await streamMultipartFile(
      request,
      path.join(tmpdir(), "pyxis-student-rosters"),
      STUDENT_ROSTER_MAX_BYTES,
      {
        allowedFields: ["mode", "prefix", "reason"],
        maxFieldBytes: 2 * 1024,
        maxTotalBytes: STUDENT_ROSTER_MAX_BYTES + 32 * 1024,
      },
    );
    rosterUploadPath = upload.temporaryPath;
    const file = new File([await readFile(upload.temporaryPath)], upload.originalName, { type: upload.mimeType });
    const mode = upload.fields.mode;
    if (mode !== "preview" && mode !== "import") return noStoreJson({ error: "명단 처리 방식을 확인해 주세요." }, { status: 400 });
    const prefix = normalizeStudentIdPrefix(upload.fields.prefix ?? "");
    const rows = await parseStudentRoster(file, prefix);
    const inspection = await inspectRoster(rows);

    if (actor.role !== "SUPER_ADMIN") {
      const outsideSchool = rows.find((row) => row.schoolName !== actor.school?.name);
      if (outsideSchool) {
        return noStoreJson({ error: `학교 대표교사는 ‘${actor.school?.name}’ 학생만 등록할 수 있습니다. ${outsideSchool.line}행 학교를 확인해 주세요.` }, { status: 403 });
      }
      if (inspection.newSchools.length) {
        return noStoreJson({ error: "학교 대표교사는 새 학교를 만들 수 없습니다." }, { status: 403 });
      }
    }

    const sample = rows.slice(0, 8).map((row) => ({
      line: row.line,
      schoolName: row.schoolName,
      grade: row.grade,
      classNumber: row.classNumber,
      studentNumber: row.studentNumber,
      name: row.name,
      loginId: row.loginId,
    }));
    if (mode === "preview") {
      return noStoreJson({
        preview: {
          studentCount: rows.length,
          schoolCount: new Set(rows.map((row) => row.schoolName)).size,
          gradeCount: inspection.gradeCount,
          classCount: inspection.classCount,
          newSchools: inspection.newSchools,
          newGradeCount: inspection.newGradeCount,
          newClassCount: inspection.newClassCount,
          conflicts: inspection.conflicts,
          sample,
        },
      });
    }

    const reason = importReasonSchema.safeParse(upload.fields.reason ?? "");
    if (!reason.success) return noStoreJson({ error: reason.error.issues[0]?.message ?? "등록 사유를 확인해 주세요." }, { status: 400 });
    if (inspection.conflicts.length) {
      return noStoreJson({ error: `이미 등록된 아이디가 ${inspection.conflicts.length}개 있습니다. 미리보기에서 충돌 행을 확인해 주세요.`, conflicts: inspection.conflicts }, { status: 409 });
    }

    const [passwordHashes, nicknames] = await Promise.all([
      hashInitialPasswords(rows),
      assignUniqueNicknames(rows),
    ]);
    const now = new Date();
    const prisma = getPrisma();
    await prisma.$transaction(async (tx) => {
      const schoolNames = [...new Set(rows.map((row) => row.schoolName))];
      if (actor.role === "SUPER_ADMIN") {
        await tx.school.createMany({ data: schoolNames.map((name) => ({ name })), skipDuplicates: true });
      }
      const schools = await tx.school.findMany({ where: { name: { in: schoolNames } }, select: { id: true, name: true } });
      const schoolIds = new Map(schools.map((school) => [school.name, school.id]));
      const missingSchool = schoolNames.find((name) => !schoolIds.has(name));
      if (missingSchool) throw new Error(`학교 ‘${missingSchool}’을(를) 찾을 수 없습니다.`);

      const gradeInputs = [...new Map(rows.map((row) => {
        const schoolId = schoolIds.get(row.schoolName)!;
        return [uniqueKey([schoolId, row.grade]), { schoolId, grade: row.grade }];
      })).values()];
      await tx.schoolGrade.createMany({ data: gradeInputs, skipDuplicates: true });
      const grades = await tx.schoolGrade.findMany({
        where: {
          schoolId: { in: [...new Set(gradeInputs.map((grade) => grade.schoolId))] },
          grade: { in: [...new Set(gradeInputs.map((grade) => grade.grade))] },
        },
        select: { id: true, schoolId: true, grade: true },
      });
      const gradeIds = new Map(grades.map((grade) => [uniqueKey([grade.schoolId, grade.grade]), grade.id]));

      const classInputs = [...new Map(rows.map((row) => {
        const schoolId = schoolIds.get(row.schoolName)!;
        const gradeId = gradeIds.get(uniqueKey([schoolId, row.grade]));
        if (!gradeId) throw new Error(`학교 ‘${row.schoolName}’의 ${row.grade}학년을 만들지 못했습니다.`);
        return [uniqueKey([gradeId, row.classNumber]), {
            schoolId,
            type: "CLASS" as const,
            name: `${row.grade}학년 ${row.classNumber}반`,
            gradeId,
            classNumber: row.classNumber,
        }];
      })).values()];
      await tx.schoolGroup.createMany({ data: classInputs, skipDuplicates: true });
      const classes = await tx.schoolGroup.findMany({
        where: {
          gradeId: { in: classInputs.map((schoolClass) => schoolClass.gradeId) },
          classNumber: { in: [...new Set(classInputs.map((schoolClass) => schoolClass.classNumber))] },
        },
        select: { id: true, gradeId: true, classNumber: true },
      });
      const classIdsByGrade = new Map(classes.map((schoolClass) => [uniqueKey([schoolClass.gradeId!, schoolClass.classNumber!]), schoolClass.id]));
      const classIds = new Map(rows.map((row) => {
        const schoolId = schoolIds.get(row.schoolName)!;
        const gradeId = gradeIds.get(uniqueKey([schoolId, row.grade]))!;
        const classId = classIdsByGrade.get(uniqueKey([gradeId, row.classNumber]));
        if (!classId) throw new Error(`학교 ‘${row.schoolName}’의 ${row.grade}학년 ${row.classNumber}반을 만들지 못했습니다.`);
        return [uniqueKey([row.schoolName, row.grade, row.classNumber]), classId];
      }));

      const users = rows.map((row, index) => {
        const id = randomUUID();
        const schoolId = schoolIds.get(row.schoolName)!;
        const schoolGroupId = classIds.get(uniqueKey([row.schoolName, row.grade, row.classNumber]))!;
        return {
          id,
          loginIdentifierLookup: createLoginIdentifierLookup(row.loginId),
          loginIdentifierEncrypted: encryptUserLoginIdentifier(id, row.loginId),
          passwordHash: passwordHashes[index],
          mustChangePassword: true,
          nameEncrypted: encryptUserPii(id, "name", nicknames[index].nickname),
          nameLookup: nicknames[index].nameLookup,
          role: "STUDENT" as const,
          status: "ACTIVE" as const,
          schoolId,
          schoolGroupId,
          studentNumber: row.studentNumber,
          onboardingCompletedAt: now,
        };
      });
      await tx.user.createMany({ data: users });
      await tx.adminAuditLog.create({
        data: createAuditLogData({
          actorId: actor.id,
          action: "STUDENT_ROSTER_IMPORTED",
          entityType: "StudentRoster",
          after: {
            studentCount: rows.length,
            schoolCount: schoolIds.size,
            gradeCount: inspection.gradeCount,
            classCount: inspection.classCount,
            createdSchoolCount: inspection.newSchools.length,
            createdGradeCount: inspection.newGradeCount,
            createdClassCount: inspection.newClassCount,
            prefix,
          },
          reason: reason.data,
        }),
      });
    }, { isolationLevel: "Serializable", timeout: 60_000 });

    return noStoreJson({
      ok: true,
      importedCount: rows.length,
      credentials: rows.map((row) => ({
        schoolName: row.schoolName,
        grade: row.grade,
        classNumber: row.classNumber,
        studentNumber: row.studentNumber,
        name: row.name,
        loginId: row.loginId,
        initialPassword: row.initialPassword,
      })),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof StudentRosterError) return noStoreJson({ error: error.message }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return noStoreJson({ error: "처리 중 같은 아이디·닉네임·학급이 먼저 등록되었습니다. 최신 명단으로 다시 미리보기 해주세요." }, { status: 409 });
    }
    return apiError(error, "학생 명단을 등록하지 못했습니다.");
  } finally {
    if (rosterUploadPath) await unlink(rosterUploadPath).catch(() => undefined);
  }
}
