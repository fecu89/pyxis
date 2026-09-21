-- CreateEnum
CREATE TYPE "BoardActivityType" AS ENUM ('POST_CREATED', 'POST_UPDATED', 'POST_DELETED', 'COMMENT_CREATED', 'MEMBER_JOINED', 'ACCESS_REQUEST_DECIDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'REACTION_ON_POST';
ALTER TYPE "NotificationType" ADD VALUE 'MEMBER_JOINED';

-- DropIndex
DROP INDEX "BoardInviteLink_token_key";

-- AlterTable
ALTER TABLE "BoardInviteLink" DROP COLUMN "token",
ADD COLUMN     "tokenHash" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "BoardActivity" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "BoardActivityType" NOT NULL,
    "postId" TEXT,
    "commentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardFollow" (
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardFollow_pkey" PRIMARY KEY ("boardId","userId")
);

-- CreateIndex
CREATE INDEX "BoardActivity_boardId_createdAt_idx" ON "BoardActivity"("boardId", "createdAt");

-- CreateIndex
CREATE INDEX "BoardFollow_userId_idx" ON "BoardFollow"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BoardInviteLink_tokenHash_key" ON "BoardInviteLink"("tokenHash");

-- AddForeignKey
ALTER TABLE "BoardActivity" ADD CONSTRAINT "BoardActivity_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardActivity" ADD CONSTRAINT "BoardActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardFollow" ADD CONSTRAINT "BoardFollow_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardFollow" ADD CONSTRAINT "BoardFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

