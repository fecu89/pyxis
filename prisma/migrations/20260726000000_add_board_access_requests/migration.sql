-- CreateEnum
CREATE TYPE "BoardAccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "BoardAccessRequest" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "BoardAccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoardAccessRequest_boardId_userId_key" ON "BoardAccessRequest"("boardId", "userId");

-- CreateIndex
CREATE INDEX "BoardAccessRequest_boardId_status_updatedAt_idx" ON "BoardAccessRequest"("boardId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "BoardAccessRequest_userId_status_idx" ON "BoardAccessRequest"("userId", "status");

-- AddForeignKey
ALTER TABLE "BoardAccessRequest" ADD CONSTRAINT "BoardAccessRequest_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardAccessRequest" ADD CONSTRAINT "BoardAccessRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
