ALTER TABLE "Attachment" ADD COLUMN "imageRevision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "ImageProcessingJob" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "inputPath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "outputPath" TEXT,
    "thumbnailPath" TEXT,
    "cleanupAfter" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ImageProcessingJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ImageProcessingJob_attachmentId_key" ON "ImageProcessingJob"("attachmentId");
CREATE INDEX "ImageProcessingJob_status_availableAt_idx" ON "ImageProcessingJob"("status", "availableAt");
CREATE INDEX "ImageProcessingJob_boardId_idx" ON "ImageProcessingJob"("boardId");
