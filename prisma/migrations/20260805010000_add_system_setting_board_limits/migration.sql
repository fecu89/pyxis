-- AlterEnum
ALTER TYPE "AdminAuditAction" ADD VALUE 'SYSTEM_SETTINGS_UPDATED';

-- CreateTable
CREATE TABLE "SystemSetting" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "studentBoardLimit" INTEGER NOT NULL DEFAULT 10,
  "teacherBoardLimit" INTEGER NOT NULL DEFAULT 40,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);
