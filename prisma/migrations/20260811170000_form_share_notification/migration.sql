-- 설문 공유(FormShare) 알림입니다. QUIZ_SHARED와 같은 자리에 FORM_SHARED를 추가하고,
-- Notification이 어느 설문을 가리키는지 알아야 하므로 formId를 붙입니다.
-- 삭제된 설문을 가리키는 알림은 열 수 없으므로 Cascade — quizId·boardId와 같은 정책입니다.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'FORM_SHARED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "formId" TEXT;

-- CreateIndex
CREATE INDEX "Notification_formId_idx" ON "Notification"("formId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;
