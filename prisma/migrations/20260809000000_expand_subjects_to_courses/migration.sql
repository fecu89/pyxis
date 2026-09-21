-- 교과목을 퀴즈 전용 분류에서 퀴즈·패드·학생을 함께 묶는 수업 단위로 확장합니다.
-- 기존 Quiz.subjectId와 Subject 데이터는 그대로 유지되는 순수 추가 마이그레이션입니다.

ALTER TABLE "Board" ADD COLUMN "subjectId" TEXT;

CREATE TABLE "SubjectStudent" (
    "subjectId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubjectStudent_pkey" PRIMARY KEY ("subjectId", "studentId")
);

CREATE INDEX "Board_subjectId_deletedAt_idx" ON "Board"("subjectId", "deletedAt");
CREATE INDEX "SubjectStudent_studentId_createdAt_idx" ON "SubjectStudent"("studentId", "createdAt");
CREATE INDEX "SubjectStudent_assignedById_idx" ON "SubjectStudent"("assignedById");

ALTER TABLE "Board"
  ADD CONSTRAINT "Board_subjectId_fkey"
  FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SubjectStudent"
  ADD CONSTRAINT "SubjectStudent_subjectId_fkey"
  FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubjectStudent"
  ADD CONSTRAINT "SubjectStudent_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubjectStudent"
  ADD CONSTRAINT "SubjectStudent_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
