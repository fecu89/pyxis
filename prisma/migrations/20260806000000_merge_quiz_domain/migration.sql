-- quiz 도메인 병합.
-- 순수 추가 마이그레이션이다 — DROP이 하나도 없고 pad의 기존 테이블·컬럼은 그대로 남는다.
--   * 새 테이블 11개: Activity + 퀴즈 도메인 10개
--   * 새 enum 9개, 기존 enum에 값 추가 10건(NotificationType·SystemPermission·AdminAuditAction)
--   * Notification: 기존 boardId/postId/commentId를 실제 외래키로 승격하고 quizId/assignmentId 추가
--   * SystemSetting: quiz의 AppPolicy를 흡수(퀴즈 한도·재인증 창·일괄 발급 상한·updatedBy)

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('QUIZ_SESSION', 'PAD_BOARD');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SINGLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'ORDERING', 'NUMERIC', 'PIN_ANCHOR', 'SURVEY', 'WORD_CLOUD', 'DROP_PIN', 'LIKERT', 'SLIDE');

-- CreateEnum
CREATE TYPE "SlideLayout" AS ENUM ('CLASSIC', 'BIG_TITLE', 'TITLE_TEXT', 'BULLETS', 'QUOTE', 'BIG_MEDIA');

-- CreateEnum
CREATE TYPE "AnswerPalette" AS ENUM ('BRAND', 'SOFT', 'FOREST');

-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('LIVE', 'ASYNC');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('LOBBY', 'IN_PROGRESS', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LivePhase" AS ENUM ('LOBBY', 'QUESTION_ACTIVE', 'QUESTION_REVEAL', 'LEADERBOARD', 'ENDED');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('JOINED', 'IN_PROGRESS', 'COMPLETED', 'KICKED', 'LEFT');

-- CreateEnum
CREATE TYPE "QuizPermission" AS ENUM ('VIEWER', 'EDITOR');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'QUIZ_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'QUIZ_SHARED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SystemPermission" ADD VALUE 'VIEW_ALL_QUIZZES';
ALTER TYPE "SystemPermission" ADD VALUE 'EDIT_ANY_QUIZ';
ALTER TYPE "SystemPermission" ADD VALUE 'MANAGE_ANY_SESSION';
ALTER TYPE "SystemPermission" ADD VALUE 'ISSUE_STUDENT_ACCOUNTS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminAuditAction" ADD VALUE 'STUDENT_ACCOUNTS_ISSUED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'GLOBAL_QUIZ_UPDATED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'GLOBAL_QUIZ_DELETED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'GLOBAL_SESSION_ENDED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "assignmentId" TEXT,
ADD COLUMN     "quizId" TEXT;

-- AlterTable
ALTER TABLE "SystemSetting" ADD COLUMN     "adminReauthWindowMinutes" INTEGER NOT NULL DEFAULT 10080,
ADD COLUMN     "maxBulkStudents" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "studentQuizLimit" INTEGER DEFAULT 10,
ADD COLUMN     "teacherQuizLimit" INTEGER,
ADD COLUMN     "updatedById" TEXT;

-- AlterTable
ALTER TABLE "Board" ADD COLUMN     "activityId" TEXT;

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "ownerId" TEXT,
    "schoolId" TEXT,
    "schoolGroupId" TEXT,
    "title" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quiz" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "subjectId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "thumbnailAlt" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "requiresLogin" BOOLEAN NOT NULL DEFAULT true,
    "isSearchable" BOOLEAN NOT NULL DEFAULT false,
    "answerPalette" "AnswerPalette" NOT NULL DEFAULT 'BRAND',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "frozenAt" TIMESTAMP(3),

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizShare" (
    "quizId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "QuizPermission" NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizShare_pkey" PRIMARY KEY ("quizId","userId")
);

-- CreateTable
CREATE TABLE "QuizFavorite" (
    "userId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizFavorite_pkey" PRIMARY KEY ("userId","quizId")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL DEFAULT 'SINGLE_CHOICE',
    "text" TEXT NOT NULL,
    "imageUrl" TEXT,
    "imageAlt" TEXT,
    "imagePlaceholder" TEXT,
    "timeLimitSec" INTEGER NOT NULL DEFAULT 20,
    "points" INTEGER NOT NULL DEFAULT 1000,
    "position" INTEGER NOT NULL,
    "multipleSelection" BOOLEAN NOT NULL DEFAULT false,
    "acceptedAnswers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "orderedItems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "numericMin" DOUBLE PRECISION,
    "numericMax" DOUBLE PRECISION,
    "numericAnswer" DOUBLE PRECISION,
    "slideLayout" "SlideLayout",
    "slideBody" TEXT,
    "pinAreas" JSONB,
    "likertSteps" INTEGER,
    "likertMinLabel" TEXT,
    "likertMaxLabel" TEXT,
    "revealResponsesLive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Choice" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "Choice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizSession" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "activityId" TEXT,
    "mode" "SessionMode" NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'LOBBY',
    "pinCode" TEXT,
    "livePhase" "LivePhase",
    "currentQuestionIndex" INTEGER,
    "currentQuestionStartedAt" TIMESTAMP(3),
    "openAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "allowLateSubmission" BOOLEAN NOT NULL DEFAULT false,
    "requiresLogin" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAssignment" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionParticipant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "guestTokenHash" TEXT,
    "nickname" TEXT NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'JOINED',
    "score" INTEGER NOT NULL DEFAULT 0,
    "currentQuestionIndex" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SessionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "choiceId" TEXT,
    "selectedChoiceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selectedChoiceTexts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "textResponse" TEXT,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "responseTimeMs" INTEGER,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Activity_schoolId_createdAt_idx" ON "Activity"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_schoolGroupId_createdAt_idx" ON "Activity"("schoolGroupId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_ownerId_createdAt_idx" ON "Activity"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_type_createdAt_idx" ON "Activity"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_endedAt_idx" ON "Activity"("endedAt");

-- CreateIndex
CREATE INDEX "Quiz_ownerId_deletedAt_idx" ON "Quiz"("ownerId", "deletedAt");

-- CreateIndex
CREATE INDEX "Quiz_subjectId_deletedAt_idx" ON "Quiz"("subjectId", "deletedAt");

-- CreateIndex
CREATE INDEX "Subject_ownerId_name_idx" ON "Subject"("ownerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_ownerId_nameNormalized_key" ON "Subject"("ownerId", "nameNormalized");

-- CreateIndex
CREATE INDEX "QuizShare_userId_permission_idx" ON "QuizShare"("userId", "permission");

-- CreateIndex
CREATE INDEX "QuizFavorite_quizId_idx" ON "QuizFavorite"("quizId");

-- CreateIndex
CREATE INDEX "Question_quizId_position_idx" ON "Question"("quizId", "position");

-- CreateIndex
CREATE INDEX "Choice_questionId_position_idx" ON "Choice"("questionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QuizSession_activityId_key" ON "QuizSession"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizSession_pinCode_key" ON "QuizSession"("pinCode");

-- CreateIndex
CREATE INDEX "QuizSession_mode_status_idx" ON "QuizSession"("mode", "status");

-- CreateIndex
CREATE INDEX "QuizSession_hostId_createdAt_idx" ON "QuizSession"("hostId", "createdAt");

-- CreateIndex
CREATE INDEX "QuizAssignment_studentId_createdAt_idx" ON "QuizAssignment"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "QuizAssignment_quizId_createdAt_idx" ON "QuizAssignment"("quizId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAssignment_sessionId_studentId_key" ON "QuizAssignment"("sessionId", "studentId");

-- CreateIndex
CREATE INDEX "SessionParticipant_sessionId_score_idx" ON "SessionParticipant"("sessionId", "score");

-- CreateIndex
CREATE INDEX "SessionParticipant_sessionId_guestTokenHash_idx" ON "SessionParticipant"("sessionId", "guestTokenHash");

-- CreateIndex
CREATE INDEX "SessionParticipant_userId_joinedAt_idx" ON "SessionParticipant"("userId", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionParticipant_sessionId_userId_key" ON "SessionParticipant"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "Answer_sessionId_questionId_idx" ON "Answer"("sessionId", "questionId");

-- CreateIndex
CREATE INDEX "Answer_questionId_choiceId_idx" ON "Answer"("questionId", "choiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_participantId_questionId_key" ON "Answer"("participantId", "questionId");

-- CreateIndex
CREATE INDEX "Notification_boardId_idx" ON "Notification"("boardId");

-- CreateIndex
CREATE INDEX "Notification_postId_idx" ON "Notification"("postId");

-- CreateIndex
CREATE INDEX "Notification_commentId_idx" ON "Notification"("commentId");

-- CreateIndex
CREATE INDEX "Notification_quizId_idx" ON "Notification"("quizId");

-- CreateIndex
CREATE INDEX "Notification_assignmentId_idx" ON "Notification"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Board_activityId_key" ON "Board"("activityId");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_schoolGroupId_fkey" FOREIGN KEY ("schoolGroupId") REFERENCES "SchoolGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "QuizAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizShare" ADD CONSTRAINT "QuizShare_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizShare" ADD CONSTRAINT "QuizShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizShare" ADD CONSTRAINT "QuizShare_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizFavorite" ADD CONSTRAINT "QuizFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizFavorite" ADD CONSTRAINT "QuizFavorite_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Choice" ADD CONSTRAINT "Choice_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizSession" ADD CONSTRAINT "QuizSession_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizSession" ADD CONSTRAINT "QuizSession_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizSession" ADD CONSTRAINT "QuizSession_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAssignment" ADD CONSTRAINT "QuizAssignment_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAssignment" ADD CONSTRAINT "QuizAssignment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuizSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAssignment" ADD CONSTRAINT "QuizAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAssignment" ADD CONSTRAINT "QuizAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuizSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuizSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "SessionParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_choiceId_fkey" FOREIGN KEY ("choiceId") REFERENCES "Choice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
