-- 공개 별칭은 비활성화 뒤에도 예약 상태로 남깁니다. 콘텐츠나 생성자 계정이 완전히
-- 삭제되더라도 slug 행 자체는 보존해 이미 배포된 QR을 다른 사용자가 탈취하지 못하게 합니다.
ALTER TABLE "ShortLink" ADD COLUMN "disabledAt" TIMESTAMP(3);
ALTER TABLE "ShortLink" ALTER COLUMN "createdById" DROP NOT NULL;

DROP INDEX "ShortLink_boardId_key";
DROP INDEX "ShortLink_quizSessionId_key";
DROP INDEX "ShortLink_formId_key";

CREATE UNIQUE INDEX "ShortLink_active_board_key"
ON "ShortLink"("boardId") WHERE "boardId" IS NOT NULL AND "disabledAt" IS NULL;
CREATE UNIQUE INDEX "ShortLink_active_quizSession_key"
ON "ShortLink"("quizSessionId") WHERE "quizSessionId" IS NOT NULL AND "disabledAt" IS NULL;
CREATE UNIQUE INDEX "ShortLink_active_form_key"
ON "ShortLink"("formId") WHERE "formId" IS NOT NULL AND "disabledAt" IS NULL;
CREATE INDEX "ShortLink_boardId_disabledAt_idx" ON "ShortLink"("boardId", "disabledAt");
CREATE INDEX "ShortLink_quizSessionId_disabledAt_idx" ON "ShortLink"("quizSessionId", "disabledAt");
CREATE INDEX "ShortLink_formId_disabledAt_idx" ON "ShortLink"("formId", "disabledAt");
CREATE INDEX "ShortLink_disabledAt_idx" ON "ShortLink"("disabledAt");

ALTER TABLE "ShortLink" DROP CONSTRAINT "ShortLink_target_check";
ALTER TABLE "ShortLink" ADD CONSTRAINT "ShortLink_target_check" CHECK (
  ("boardId" IS NULL AND "quizSessionId" IS NULL AND "formId" IS NULL)
  OR ("targetType" = 'BOARD' AND "boardId" IS NOT NULL AND "quizSessionId" IS NULL AND "formId" IS NULL)
  OR ("targetType" = 'QUIZ_SESSION' AND "boardId" IS NULL AND "quizSessionId" IS NOT NULL AND "formId" IS NULL)
  OR ("targetType" = 'FORM' AND "boardId" IS NULL AND "quizSessionId" IS NULL AND "formId" IS NOT NULL)
);

ALTER TABLE "ShortLink" DROP CONSTRAINT "ShortLink_boardId_fkey";
ALTER TABLE "ShortLink" DROP CONSTRAINT "ShortLink_quizSessionId_fkey";
ALTER TABLE "ShortLink" DROP CONSTRAINT "ShortLink_formId_fkey";
ALTER TABLE "ShortLink" DROP CONSTRAINT "ShortLink_createdById_fkey";

ALTER TABLE "ShortLink" ADD CONSTRAINT "ShortLink_boardId_fkey"
FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShortLink" ADD CONSTRAINT "ShortLink_quizSessionId_fkey"
FOREIGN KEY ("quizSessionId") REFERENCES "QuizSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShortLink" ADD CONSTRAINT "ShortLink_formId_fkey"
FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShortLink" ADD CONSTRAINT "ShortLink_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "AdminAuditAction" ADD VALUE 'BOARD_PASSWORD_VIEWED';
