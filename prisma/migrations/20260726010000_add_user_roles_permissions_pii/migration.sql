CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'TEACHER', 'STUDENT');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "SystemPermission" AS ENUM ('VIEW_USERS', 'CHANGE_NON_ADMIN_ROLES', 'SUSPEND_USERS', 'REVOKE_USER_SESSIONS', 'VIEW_ALL_BOARDS', 'EDIT_ANY_CONTENT', 'MODERATE_CONTENT', 'CREATE_CONTENT_ANYWHERE', 'MANAGE_BOARD_SETTINGS', 'TRANSFER_BOARD_OWNERSHIP', 'VIEW_USER_PII', 'VIEW_AUDIT_LOG');
CREATE TYPE "AdminAuditAction" AS ENUM ('USER_ROLE_CHANGED', 'USER_STATUS_CHANGED', 'USER_SESSIONS_REVOKED', 'ADMIN_PERMISSION_GRANTED', 'ADMIN_PERMISSION_REVOKED', 'USER_PII_VIEWED', 'GLOBAL_POST_CREATED', 'GLOBAL_POST_UPDATED', 'GLOBAL_POST_HIDDEN', 'GLOBAL_POST_RESTORED', 'GLOBAL_BOARD_UPDATED', 'BOARD_OWNERSHIP_TRANSFERRED', 'GLOBAL_BOARD_ARCHIVED', 'GLOBAL_BOARD_RESTORED', 'GLOBAL_ENTITY_PURGED');

ALTER TABLE "User"
  ALTER COLUMN "email" DROP NOT NULL,
  ADD COLUMN "emailEncrypted" TEXT,
  ADD COLUMN "emailLookup" TEXT,
  ADD COLUMN "nameEncrypted" TEXT,
  ADD COLUMN "imageEncrypted" TEXT,
  ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
  ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);

ALTER TABLE "Attachment" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE TABLE "UserSystemPermission" (
  "userId" TEXT NOT NULL,
  "permission" "SystemPermission" NOT NULL,
  "grantedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserSystemPermission_pkey" PRIMARY KEY ("userId", "permission")
);

CREATE TABLE "AdminAuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "targetUserId" TEXT,
  "action" "AdminAuditAction" NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "before" JSONB,
  "after" JSONB,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_emailLookup_key" ON "User"("emailLookup");
CREATE INDEX "Attachment_deletedAt_idx" ON "Attachment"("deletedAt");
CREATE INDEX "UserSystemPermission_grantedById_idx" ON "UserSystemPermission"("grantedById");
CREATE INDEX "AdminAuditLog_actorId_createdAt_idx" ON "AdminAuditLog"("actorId", "createdAt");
CREATE INDEX "AdminAuditLog_targetUserId_createdAt_idx" ON "AdminAuditLog"("targetUserId", "createdAt");
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");

ALTER TABLE "UserSystemPermission" ADD CONSTRAINT "UserSystemPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSystemPermission" ADD CONSTRAINT "UserSystemPermission_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
