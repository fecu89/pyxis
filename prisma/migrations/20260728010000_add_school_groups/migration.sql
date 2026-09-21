-- 학교와 역할별 소속(학생의 반, 교사의 부서)을 정규화합니다.
CREATE TYPE "SchoolGroupType" AS ENUM ('CLASS', 'DEPARTMENT');

ALTER TYPE "AdminAuditAction" ADD VALUE 'USER_ORGANIZATION_CHANGED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'USER_DELETED';

CREATE TABLE "School" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolGroup" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "SchoolGroupType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolGroup_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User" ADD COLUMN "schoolId" TEXT;
ALTER TABLE "User" ADD COLUMN "schoolGroupId" TEXT;

CREATE UNIQUE INDEX "School_name_key" ON "School"("name");
CREATE UNIQUE INDEX "SchoolGroup_schoolId_type_name_key" ON "SchoolGroup"("schoolId", "type", "name");
CREATE INDEX "SchoolGroup_schoolId_type_name_idx" ON "SchoolGroup"("schoolId", "type", "name");
CREATE INDEX "User_schoolId_role_status_idx" ON "User"("schoolId", "role", "status");
CREATE INDEX "User_schoolGroupId_role_status_idx" ON "User"("schoolGroupId", "role", "status");

ALTER TABLE "SchoolGroup" ADD CONSTRAINT "SchoolGroup_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_schoolGroupId_fkey"
  FOREIGN KEY ("schoolGroupId") REFERENCES "SchoolGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 요청된 첫 조직을 즉시 사용할 수 있게 만들고 기존 학생·교사를 해당 소속에 배치합니다.
INSERT INTO "School" ("id", "name", "updatedAt")
VALUES ('school_cheonghak_high', '청학고등학교', CURRENT_TIMESTAMP);

INSERT INTO "SchoolGroup" ("id", "schoolId", "name", "type", "updatedAt")
VALUES
  ('group_cheonghak_grade3_class5', 'school_cheonghak_high', '3학년 5반', 'CLASS', CURRENT_TIMESTAMP),
  ('group_cheonghak_grade3_department', 'school_cheonghak_high', '3학년부', 'DEPARTMENT', CURRENT_TIMESTAMP);

UPDATE "User"
SET
  "schoolId" = 'school_cheonghak_high',
  "schoolGroupId" = CASE
    WHEN "role" = 'STUDENT' THEN 'group_cheonghak_grade3_class5'
    WHEN "role" = 'TEACHER' THEN 'group_cheonghak_grade3_department'
    ELSE NULL
  END
WHERE "status" <> 'DELETED';
