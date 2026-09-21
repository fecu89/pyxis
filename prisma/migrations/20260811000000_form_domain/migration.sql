-- 설문(Forms) 도메인을 추가합니다. 구글 설문지에 해당하며 서명 필드가 더해져 있습니다.
--
-- 퀴즈의 참여형 문항(SURVEY·LIKERT)으로는 대신할 수 없어 별도 도메인으로 만듭니다. 그쪽은
-- 교사가 세션을 열고 학생이 PIN으로 들어와 실시간으로 진행하는 동안에만 동작하는데, 학부모
-- 동의서나 수요 조사처럼 링크를 뿌려 두고 며칠에 걸쳐 받는 요구는 그 구조로 표현되지 않습니다.
--
-- 이 마이그레이션은 표만 만들고 기존 행은 건드리지 않습니다.

-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "FormFieldType" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'MULTIPLE_CHOICE', 'CHECKBOXES', 'DROPDOWN', 'LINEAR_SCALE', 'RATING', 'MULTIPLE_CHOICE_GRID', 'CHECKBOX_GRID', 'DATE', 'TIME', 'SIGNATURE', 'SECTION_HEADER');

-- CreateEnum
CREATE TYPE "RatingIcon" AS ENUM ('STAR', 'HEART', 'THUMB');

-- CreateEnum
CREATE TYPE "FormPermission" AS ENUM ('VIEWER', 'EDITOR');

-- CreateEnum
CREATE TYPE "FormResponseStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');

-- AlterEnum
-- 설문도 /report·/dashboard에 퀴즈 세션·패드와 나란히 뜨게 합니다.
-- PostgreSQL 12+에서는 트랜잭션 안에서 ADD VALUE가 되지만, 추가한 값을 같은 트랜잭션에서
-- **쓸 수는 없습니다.** 이 파일은 표만 만들고 'FORM'을 어디에도 넣지 않으므로 안전합니다.
ALTER TYPE "ActivityType" ADD VALUE 'FORM';

-- CreateTable
CREATE TABLE "Form" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "subjectId" TEXT,
    -- QuizSession.activityId / Board.activityId와 같은 이유로 NOT NULL입니다. 생성 경로마다
    -- 활동을 붙였는지 사람이 기억하는 대신 스키마가 잡게 합니다.
    "activityId" TEXT NOT NULL,
    -- 공개 응답 주소 /s/{slug}
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "FormStatus" NOT NULL DEFAULT 'DRAFT',
    "requiresLogin" BOOLEAN NOT NULL DEFAULT true,
    "allowMultipleResponses" BOOLEAN NOT NULL DEFAULT false,
    "allowEditAfterSubmit" BOOLEAN NOT NULL DEFAULT false,
    "shuffleFields" BOOLEAN NOT NULL DEFAULT false,
    "showProgressBar" BOOLEAN NOT NULL DEFAULT true,
    "confirmationMessage" TEXT,
    "openAt" TIMESTAMP(3),
    "closeAt" TIMESTAMP(3),
    "maxResponses" INTEGER,
    -- 정원 판정용 비정규화 카운터. 제출마다 count()를 돌면 응답이 쌓일수록 제출이 느려집니다.
    "responseCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    -- Quiz와 같은 뜻입니다. deletedAt은 "소유자가 버렸다", frozenAt은 "주인이 없다".
    "deletedAt" TIMESTAMP(3),
    "frozenAt" TIMESTAMP(3),

    CONSTRAINT "Form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- 유형별 서브테이블이나 설정 JSON 블롭이 아니라 유형별 nullable 열을 가진 넓은 표 하나입니다
-- (Question과 같은 전략). 서브테이블이면 유형 전환 때 행을 옮겨야 해서 편집 중 ID가 끊기고,
-- JSON 블롭이면 "선형배율 평균" 같은 집계를 SQL로 쓸 수 없습니다.
CREATE TABLE "FormField" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "type" "FormFieldType" NOT NULL DEFAULT 'SHORT_TEXT',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "imageAlt" TEXT,
    "shuffleOptions" BOOLEAN NOT NULL DEFAULT false,
    "allowOther" BOOLEAN NOT NULL DEFAULT false,
    -- 그리드의 행 라벨. 열은 FormFieldOption이 담습니다 — 열은 응답이 가리키는 대상이라 안정된
    -- ID가 필요하고, 행은 라벨일 뿐이라 배열로 충분합니다.
    "gridRows" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gridRequireOneResponsePerRow" BOOLEAN NOT NULL DEFAULT false,
    "scaleMin" INTEGER,
    "scaleMax" INTEGER,
    "scaleMinLabel" TEXT,
    "scaleMaxLabel" TEXT,
    "ratingMax" INTEGER,
    "ratingIcon" "RatingIcon",
    "includeYear" BOOLEAN NOT NULL DEFAULT true,
    "includeTime" BOOLEAN NOT NULL DEFAULT false,
    "durationMode" BOOLEAN NOT NULL DEFAULT false,
    -- 구글 설문지의 "응답 확인". 형태의 정본은 lib/forms/validation.ts입니다.
    "validation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Choice에서 isCorrect만 뺀 모양입니다. 설문에는 정답이 없습니다.
CREATE TABLE "FormFieldOption" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "FormFieldOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormResponse" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "respondentId" TEXT,
    -- 익명 응답자 쿠키의 sha256. 원문 토큰은 저장하지 않습니다(SessionParticipant와 같은 방식).
    "guestTokenHash" TEXT,
    "respondentName" TEXT,
    "status" "FormResponseStatus" NOT NULL DEFAULT 'SUBMITTED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    -- 1인 1응답을 DB가 막게 하는 열입니다. 아래 유니크 인덱스 주석 참고.
    "dedupeKey" TEXT,

    CONSTRAINT "FormResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormAnswer" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "textValue" TEXT,
    -- FK가 아닌 평범한 배열입니다(Answer.selectedChoiceIds와 같음). 참조 무결성 대신 아래
    -- 텍스트 스냅샷으로 과거 응답을 지킵니다 — 보기를 지웠을 때 응답이 통째로 사라지는 것보다
    -- "무엇을 골랐었는지"가 남는 쪽이 낫습니다.
    "selectedOptionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selectedOptionTexts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "numberValue" DOUBLE PRECISION,
    "dateValue" TIMESTAMP(3),
    "timeValue" TEXT,
    -- 그리드: [{ row, optionIds, optionTexts }]. 행마다 답이 하나씩 생겨 열로 펼 수 없습니다.
    "gridValue" JSONB,
    -- 서명: 0~1로 정규화한 획 좌표. 래스터가 아니라 벡터인 이유는 form.prisma 주석 참고.
    "signatureStrokes" JSONB,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- QuizShare 복사본입니다. UI는 나중에 붙이지만 모델은 지금 넣습니다.
CREATE TABLE "FormShare" (
    "formId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "FormPermission" NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormShare_pkey" PRIMARY KEY ("formId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Form_activityId_key" ON "Form"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "Form_slug_key" ON "Form"("slug");

-- CreateIndex
CREATE INDEX "Form_ownerId_deletedAt_idx" ON "Form"("ownerId", "deletedAt");

-- CreateIndex
CREATE INDEX "Form_subjectId_deletedAt_idx" ON "Form"("subjectId", "deletedAt");

-- CreateIndex
-- 마감 시각이 지난 OPEN 설문을 쓸어 담는 배치용입니다.
CREATE INDEX "Form_status_closeAt_idx" ON "Form"("status", "closeAt");

-- CreateIndex
CREATE INDEX "FormField_formId_position_idx" ON "FormField"("formId", "position");

-- CreateIndex
CREATE INDEX "FormFieldOption_fieldId_position_idx" ON "FormFieldOption"("fieldId", "position");

-- CreateIndex
CREATE INDEX "FormResponse_formId_submittedAt_idx" ON "FormResponse"("formId", "submittedAt");

-- CreateIndex
CREATE INDEX "FormResponse_formId_guestTokenHash_idx" ON "FormResponse"("formId", "guestTokenHash");

-- CreateIndex
CREATE INDEX "FormResponse_respondentId_submittedAt_idx" ON "FormResponse"("respondentId", "submittedAt");

-- CreateIndex
-- 1인 1응답을 여기서 막습니다.
--
-- allowMultipleResponses가 false일 때만 응용 코드가 dedupeKey에 respondentId(로그인) 또는
-- guestTokenHash(익명)를 넣고, true면 null을 넣습니다. PostgreSQL은 유니크 인덱스에서 null을
-- 서로 다른 값으로 취급하므로 **제약 하나로 두 정책이 다 표현됩니다.**
--
-- ("formId","respondentId")로 하지 않은 이유 — 그러면 복수 응답 허용을 표현할 수 없습니다.
-- 응용 코드에서만 검사하지 않는 이유 — "조회했더니 없어서 만들었다"는 두 요청이 동시에 오면
-- 둘 다 통과합니다. 설문 링크는 단톡방에 뿌려지므로 실제로 동시에 옵니다.
CREATE UNIQUE INDEX "FormResponse_formId_dedupeKey_key" ON "FormResponse"("formId", "dedupeKey");

-- CreateIndex
CREATE INDEX "FormAnswer_fieldId_idx" ON "FormAnswer"("fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "FormAnswer_responseId_fieldId_key" ON "FormAnswer"("responseId", "fieldId");

-- CreateIndex
CREATE INDEX "FormShare_userId_permission_idx" ON "FormShare"("userId", "permission");

-- AddForeignKey
-- 소유자 계정은 감사·승계 목적으로 설문이 남아 있는 동안 삭제를 막습니다(Quiz.ownerId와 같음).
ALTER TABLE "Form" ADD CONSTRAINT "Form_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- 교과목을 지우면 설문은 살아남고 미분류가 됩니다(Quiz.subjectId와 같음).
ALTER TABLE "Form" ADD CONSTRAINT "Form_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- FK가 Form 쪽에 있으므로 CASCADE는 "활동을 지우면 설문도 지운다"는 뜻입니다. 반대 방향은
-- FK로 표현할 수 없어, 영구 삭제 경로가 활동을 먼저 지워 cascade로 함께 내립니다.
ALTER TABLE "Form" ADD CONSTRAINT "Form_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormField" ADD CONSTRAINT "FormField_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormFieldOption" ADD CONSTRAINT "FormFieldOption_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "FormField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormResponse" ADD CONSTRAINT "FormResponse_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- 응답자 계정을 지워도 응답은 익명으로 남습니다. 집계가 사람 수만큼 조용히 줄어드는 것보다
-- "누구인지 모르는 응답 1건"이 남는 쪽이 정확합니다.
ALTER TABLE "FormResponse" ADD CONSTRAINT "FormResponse_respondentId_fkey" FOREIGN KEY ("respondentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormAnswer" ADD CONSTRAINT "FormAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "FormResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT입니다(Answer → Question과 같은 정책). 응답이 달린 질문을 지우는 건 데이터 손실이라
-- 저장 API가 명시적 확인 없이는 거부하게 만듭니다. 대신 설문을 통째로 지울 때는 답변을 먼저
-- 지워야 합니다 — 순서는 lib/forms/overview.md에 적어 두었습니다.
ALTER TABLE "FormAnswer" ADD CONSTRAINT "FormAnswer_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "FormField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormShare" ADD CONSTRAINT "FormShare_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormShare" ADD CONSTRAINT "FormShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- 공유를 준 교사 계정은 감사 목적이라 공유가 남아 있는 동안 삭제를 막습니다(QuizShare와 같음).
ALTER TABLE "FormShare" ADD CONSTRAINT "FormShare_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
