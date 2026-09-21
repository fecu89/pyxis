ALTER TABLE "Board"
  ADD COLUMN "isTemplate" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "BoardFavorite" (
  "boardId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BoardFavorite_pkey" PRIMARY KEY ("boardId", "userId")
);

CREATE TABLE "DashboardFolder" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DashboardFolder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DashboardFolderBoard" (
  "folderId" TEXT NOT NULL,
  "boardId" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DashboardFolderBoard_pkey" PRIMARY KEY ("folderId", "boardId")
);

CREATE INDEX "BoardFavorite_userId_createdAt_idx" ON "BoardFavorite"("userId", "createdAt");
CREATE UNIQUE INDEX "DashboardFolder_userId_nameKey_key" ON "DashboardFolder"("userId", "nameKey");
CREATE INDEX "DashboardFolder_userId_position_createdAt_idx" ON "DashboardFolder"("userId", "position", "createdAt");
CREATE INDEX "DashboardFolderBoard_boardId_idx" ON "DashboardFolderBoard"("boardId");
CREATE INDEX "Board_isTemplate_discoveryScope_updatedAt_idx" ON "Board"("isTemplate", "discoveryScope", "updatedAt");

ALTER TABLE "BoardFavorite"
  ADD CONSTRAINT "BoardFavorite_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoardFavorite"
  ADD CONSTRAINT "BoardFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DashboardFolder"
  ADD CONSTRAINT "DashboardFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DashboardFolderBoard"
  ADD CONSTRAINT "DashboardFolderBoard_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "DashboardFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DashboardFolderBoard"
  ADD CONSTRAINT "DashboardFolderBoard_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
