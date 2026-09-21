CREATE TABLE "BoardVisit" (
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastVisitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardVisit_pkey" PRIMARY KEY ("boardId","userId")
);

CREATE INDEX "BoardVisit_userId_lastVisitedAt_idx" ON "BoardVisit"("userId", "lastVisitedAt");

ALTER TABLE "BoardVisit" ADD CONSTRAINT "BoardVisit_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BoardVisit" ADD CONSTRAINT "BoardVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


