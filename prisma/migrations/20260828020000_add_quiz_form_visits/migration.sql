-- 콘텐츠 수정 시각과 사용자의 실제 방문 시각을 분리합니다.
CREATE TABLE "QuizVisit" (
    "quizId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastVisitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizVisit_pkey" PRIMARY KEY ("quizId", "userId")
);

CREATE TABLE "FormVisit" (
    "formId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastVisitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormVisit_pkey" PRIMARY KEY ("formId", "userId")
);

CREATE INDEX "QuizVisit_userId_lastVisitedAt_idx" ON "QuizVisit"("userId", "lastVisitedAt");
CREATE INDEX "FormVisit_userId_lastVisitedAt_idx" ON "FormVisit"("userId", "lastVisitedAt");

ALTER TABLE "QuizVisit" ADD CONSTRAINT "QuizVisit_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuizVisit" ADD CONSTRAINT "QuizVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormVisit" ADD CONSTRAINT "FormVisit_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormVisit" ADD CONSTRAINT "FormVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
