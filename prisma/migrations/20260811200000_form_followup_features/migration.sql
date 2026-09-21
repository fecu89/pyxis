-- Forms 후속 기능: 섹션 분기, 파일 질문, 일일 응답 요약 알림.

ALTER TYPE "FormFieldType" ADD VALUE 'FILE_UPLOAD';
ALTER TYPE "NotificationType" ADD VALUE 'FORM_RESPONSE_DIGEST';

ALTER TABLE "Form"
  ADD COLUMN "dailyResponseDigestEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "responseDigestPendingCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "responseDigestPendingSince" TIMESTAMP(3),
  ADD COLUMN "responseDigestLastSentAt" TIMESTAMP(3);

ALTER TABLE "FormField"
  ADD COLUMN "branchRules" JSONB,
  ADD COLUMN "fileMaxCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "fileMaxSizeMb" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "fileAllowedTypes" TEXT[] DEFAULT ARRAY['IMAGE', 'PDF', 'DOCUMENT']::TEXT[];

ALTER TABLE "Notification" ADD COLUMN "responseCount" INTEGER;

CREATE TABLE "FormUploadedFile" (
  "id" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "fieldId" TEXT NOT NULL,
  "responseId" TEXT,
  "answerId" TEXT,
  "uploaderId" TEXT NOT NULL,
  "type" "AttachmentType" NOT NULL,
  "originalName" TEXT NOT NULL,
  "storedName" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "thumbnailPath" TEXT,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "FormUploadedFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FormUploadedFile_storedName_key" ON "FormUploadedFile"("storedName");
CREATE INDEX "FormUploadedFile_formId_fieldId_uploaderId_answerId_idx" ON "FormUploadedFile"("formId", "fieldId", "uploaderId", "answerId");
CREATE INDEX "FormUploadedFile_responseId_idx" ON "FormUploadedFile"("responseId");
CREATE INDEX "FormUploadedFile_createdAt_answerId_idx" ON "FormUploadedFile"("createdAt", "answerId");
CREATE INDEX "FormUploadedFile_deletedAt_idx" ON "FormUploadedFile"("deletedAt");

ALTER TABLE "FormUploadedFile" ADD CONSTRAINT "FormUploadedFile_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormUploadedFile" ADD CONSTRAINT "FormUploadedFile_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "FormField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormUploadedFile" ADD CONSTRAINT "FormUploadedFile_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "FormResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormUploadedFile" ADD CONSTRAINT "FormUploadedFile_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "FormAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormUploadedFile" ADD CONSTRAINT "FormUploadedFile_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
