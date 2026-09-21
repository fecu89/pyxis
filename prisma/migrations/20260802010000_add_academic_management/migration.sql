CREATE TYPE "SchoolLevel" AS ENUM ('ELEMENTARY', 'MIDDLE', 'HIGH');
CREATE TYPE "SchoolOperatingStatus" AS ENUM ('OPERATING', 'PLANNED', 'INACTIVE');
CREATE TYPE "StudentEnrollmentStatus" AS ENUM ('ENROLLED', 'TRANSFER_PENDING', 'LEAVE', 'GRADUATED');

ALTER TYPE "AdminAuditAction" ADD VALUE 'STUDENT_ACADEMIC_STATUS_CHANGED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'STUDENTS_CLASS_MOVED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'ACADEMIC_YEAR_PROMOTED';

ALTER TABLE "User" ADD COLUMN "studentEnrollmentStatus" "StudentEnrollmentStatus";
UPDATE "User" SET "studentEnrollmentStatus" = 'ENROLLED' WHERE "role" = 'STUDENT' AND "status" <> 'DELETED';

ALTER TABLE "School"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "level" "SchoolLevel" NOT NULL DEFAULT 'HIGH',
  ADD COLUMN "district" TEXT,
  ADD COLUMN "academicYear" INTEGER NOT NULL DEFAULT 2026,
  ADD COLUMN "operatingStatus" "SchoolOperatingStatus" NOT NULL DEFAULT 'OPERATING';

CREATE UNIQUE INDEX "School_code_key" ON "School"("code");

ALTER TABLE "SchoolGroup"
  ADD COLUMN "displayName" TEXT,
  ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "homeroomTeacherId" TEXT;

CREATE INDEX "SchoolGroup_homeroomTeacherId_idx" ON "SchoolGroup"("homeroomTeacherId");
ALTER TABLE "SchoolGroup" ADD CONSTRAINT "SchoolGroup_homeroomTeacherId_fkey"
  FOREIGN KEY ("homeroomTeacherId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
