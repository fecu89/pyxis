-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ModerationMode" AS ENUM ('NONE', 'MANUAL', 'STUDENTS_ONLY');

-- CreateEnum
CREATE TYPE "BoardState" AS ENUM ('ACTIVE', 'FROZEN');

-- AlterTable
ALTER TABLE "Board" ADD COLUMN     "moderationMode" "ModerationMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "state" "BoardState" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "moderationReason" TEXT,
ADD COLUMN     "status" "PostStatus" NOT NULL DEFAULT 'PUBLISHED';

-- CreateIndex
CREATE INDEX "Post_boardId_status_idx" ON "Post"("boardId", "status");

