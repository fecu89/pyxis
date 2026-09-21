-- Prisma 모델의 필수 배열과 DB를 맞추고, 우회 쓰기에도 후속 기능의 기본 불변식을 지킵니다.

ALTER TABLE "FormField"
  ALTER COLUMN "fileAllowedTypes" SET NOT NULL,
  ADD CONSTRAINT "FormField_fileMaxCount_check" CHECK ("fileMaxCount" BETWEEN 1 AND 10),
  ADD CONSTRAINT "FormField_fileMaxSizeMb_check" CHECK ("fileMaxSizeMb" BETWEEN 1 AND 30);

ALTER TABLE "Form"
  ADD CONSTRAINT "Form_responseDigestPendingCount_check" CHECK ("responseDigestPendingCount" >= 0);

ALTER TABLE "FormUploadedFile"
  ADD CONSTRAINT "FormUploadedFile_answer_response_pair_check" CHECK (
    ("answerId" IS NULL AND "responseId" IS NULL)
    OR ("answerId" IS NOT NULL AND "responseId" IS NOT NULL)
  ),
  ADD CONSTRAINT "FormUploadedFile_fileSize_check" CHECK ("fileSize" > 0);
