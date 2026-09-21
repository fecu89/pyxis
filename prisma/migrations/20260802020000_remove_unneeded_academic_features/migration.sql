ALTER TABLE "SchoolGroup" DROP CONSTRAINT "SchoolGroup_homeroomTeacherId_fkey";
DROP INDEX "SchoolGroup_homeroomTeacherId_idx";

ALTER TABLE "SchoolGroup"
  DROP COLUMN "displayName",
  DROP COLUMN "capacity",
  DROP COLUMN "homeroomTeacherId";

ALTER TABLE "School" DROP COLUMN "academicYear";
ALTER TABLE "User" DROP COLUMN "studentEnrollmentStatus";
DROP TYPE "StudentEnrollmentStatus";
