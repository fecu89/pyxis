-- 학생 일괄 계정 생성, 최초 비밀번호 변경, 학교 → 학년 → 반 계층을 추가합니다.
ALTER TYPE "AdminAuditAction" ADD VALUE 'STUDENT_ROSTER_IMPORTED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'USER_PASSWORD_RESET';

ALTER TABLE "User"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "studentNumber" INTEGER;

CREATE TABLE "SchoolGrade" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "grade" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolGrade_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SchoolGroup"
  ADD COLUMN "gradeId" TEXT,
  ADD COLUMN "classNumber" INTEGER;

CREATE UNIQUE INDEX "SchoolGrade_schoolId_grade_key" ON "SchoolGrade"("schoolId", "grade");
CREATE INDEX "SchoolGrade_schoolId_grade_idx" ON "SchoolGrade"("schoolId", "grade");
CREATE UNIQUE INDEX "SchoolGroup_gradeId_classNumber_key" ON "SchoolGroup"("gradeId", "classNumber");
CREATE INDEX "SchoolGroup_gradeId_classNumber_idx" ON "SchoolGroup"("gradeId", "classNumber");

ALTER TABLE "SchoolGrade" ADD CONSTRAINT "SchoolGrade_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolGroup" ADD CONSTRAINT "SchoolGroup_gradeId_fkey"
  FOREIGN KEY ("gradeId") REFERENCES "SchoolGrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 기존 "3학년 5반" 형태의 학급은 학년과 반 번호를 추출해 새 계층에 연결합니다.
WITH parsed AS (
  SELECT
    "schoolId",
    ((regexp_match("name", '^([0-9]+)학년[[:space:]]+([0-9]+)반$'))[1])::INTEGER AS grade
  FROM "SchoolGroup"
  WHERE "type" = 'CLASS'
    AND "name" ~ '^[0-9]+학년[[:space:]]+[0-9]+반$'
  GROUP BY "schoolId", grade
)
INSERT INTO "SchoolGrade" ("id", "schoolId", "grade", "updatedAt")
SELECT 'grade_' || md5("schoolId" || ':' || grade::TEXT), "schoolId", grade, CURRENT_TIMESTAMP
FROM parsed;

WITH parsed AS (
  SELECT
    "id",
    "schoolId",
    ((regexp_match("name", '^([0-9]+)학년[[:space:]]+([0-9]+)반$'))[1])::INTEGER AS grade,
    ((regexp_match("name", '^([0-9]+)학년[[:space:]]+([0-9]+)반$'))[2])::INTEGER AS class_number
  FROM "SchoolGroup"
  WHERE "type" = 'CLASS'
    AND "name" ~ '^[0-9]+학년[[:space:]]+[0-9]+반$'
)
UPDATE "SchoolGroup" AS class_group
SET
  "gradeId" = school_grade."id",
  "classNumber" = parsed.class_number
FROM parsed
JOIN "SchoolGrade" AS school_grade
  ON school_grade."schoolId" = parsed."schoolId" AND school_grade."grade" = parsed.grade
WHERE class_group."id" = parsed."id";

ALTER TABLE "SchoolGrade" ADD CONSTRAINT "SchoolGrade_grade_check"
  CHECK ("grade" BETWEEN 1 AND 12);
ALTER TABLE "SchoolGroup" ADD CONSTRAINT "SchoolGroup_classNumber_check"
  CHECK ("classNumber" IS NULL OR "classNumber" BETWEEN 1 AND 99);
ALTER TABLE "User" ADD CONSTRAINT "User_studentNumber_check"
  CHECK ("studentNumber" IS NULL OR "studentNumber" BETWEEN 1 AND 99);
