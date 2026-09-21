-- Self-service registration approval is separate from teacher-role verification.
CREATE TYPE "RegistrationApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TYPE "AdminAuditAction" ADD VALUE 'ACCOUNT_APPROVAL_APPROVED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'ACCOUNT_APPROVAL_REJECTED';

ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_APPROVAL_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_APPROVAL_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_APPROVAL_REJECTED';

ALTER TABLE "User"
ADD COLUMN "registrationApprovalStatus" "RegistrationApprovalStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN "registrationReviewReason" TEXT,
ADD COLUMN "registrationReviewedAt" TIMESTAMP(3),
ADD COLUMN "registrationReviewedById" TEXT;

ALTER TABLE "User"
ADD CONSTRAINT "User_registrationReviewedById_fkey"
FOREIGN KEY ("registrationReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_registrationApprovalStatus_createdAt_idx"
ON "User"("registrationApprovalStatus", "createdAt");
CREATE INDEX "User_registrationReviewedById_idx" ON "User"("registrationReviewedById");

ALTER TABLE "Notification" ADD COLUMN "accessRequestId" TEXT;
ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_accessRequestId_fkey"
FOREIGN KEY ("accessRequestId") REFERENCES "BoardAccessRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Notification_accessRequestId_idx" ON "Notification"("accessRequestId");
