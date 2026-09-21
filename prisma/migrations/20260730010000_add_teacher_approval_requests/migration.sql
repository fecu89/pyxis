ALTER TYPE "NotificationType"
  ADD VALUE 'TEACHER_APPROVAL_REQUESTED';

ALTER TYPE "NotificationType"
  ADD VALUE 'TEACHER_APPROVAL_APPROVED';

ALTER TYPE "NotificationType"
  ADD VALUE 'TEACHER_APPROVAL_REJECTED';

ALTER TYPE "AdminAuditAction"
  ADD VALUE 'TEACHER_APPROVAL_APPROVED';

ALTER TYPE "AdminAuditAction"
  ADD VALUE 'TEACHER_APPROVAL_REJECTED';

CREATE TYPE "TeacherApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "TeacherApprovalRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "schoolGroupId" TEXT NOT NULL,
  "status" "TeacherApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "reviewReason" TEXT,
  "reviewedById" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TeacherApprovalRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeacherApprovalRequest_userId_key"
  ON "TeacherApprovalRequest"("userId");

CREATE INDEX "TeacherApprovalRequest_schoolId_status_requestedAt_idx"
  ON "TeacherApprovalRequest"("schoolId", "status", "requestedAt");

CREATE INDEX "TeacherApprovalRequest_status_requestedAt_idx"
  ON "TeacherApprovalRequest"("status", "requestedAt");

CREATE INDEX "TeacherApprovalRequest_reviewedById_idx"
  ON "TeacherApprovalRequest"("reviewedById");

ALTER TABLE "TeacherApprovalRequest"
  ADD CONSTRAINT "TeacherApprovalRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherApprovalRequest"
  ADD CONSTRAINT "TeacherApprovalRequest_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherApprovalRequest"
  ADD CONSTRAINT "TeacherApprovalRequest_schoolGroupId_fkey"
  FOREIGN KEY ("schoolGroupId") REFERENCES "SchoolGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherApprovalRequest"
  ADD CONSTRAINT "TeacherApprovalRequest_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
