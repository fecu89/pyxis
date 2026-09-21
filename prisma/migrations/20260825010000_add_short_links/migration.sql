CREATE TYPE "ShortLinkTargetType" AS ENUM ('BOARD', 'QUIZ_SESSION', 'FORM');

CREATE TABLE "ShortLink" (
  "id" TEXT NOT NULL,
  "slug" VARCHAR(40) NOT NULL,
  "targetType" "ShortLinkTargetType" NOT NULL,
  "boardId" TEXT,
  "quizSessionId" TEXT,
  "formId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ShortLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShortLink_target_check" CHECK (
    ("targetType" = 'BOARD' AND "boardId" IS NOT NULL AND "quizSessionId" IS NULL AND "formId" IS NULL)
    OR ("targetType" = 'QUIZ_SESSION' AND "boardId" IS NULL AND "quizSessionId" IS NOT NULL AND "formId" IS NULL)
    OR ("targetType" = 'FORM' AND "boardId" IS NULL AND "quizSessionId" IS NULL AND "formId" IS NOT NULL)
  ),
  CONSTRAINT "ShortLink_slug_check" CHECK (
    "slug" ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' AND "slug" !~ '--'
  )
);

CREATE UNIQUE INDEX "ShortLink_slug_key" ON "ShortLink"("slug");
CREATE UNIQUE INDEX "ShortLink_boardId_key" ON "ShortLink"("boardId");
CREATE UNIQUE INDEX "ShortLink_quizSessionId_key" ON "ShortLink"("quizSessionId");
CREATE UNIQUE INDEX "ShortLink_formId_key" ON "ShortLink"("formId");
CREATE INDEX "ShortLink_createdById_idx" ON "ShortLink"("createdById");

ALTER TABLE "ShortLink" ADD CONSTRAINT "ShortLink_boardId_fkey"
FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShortLink" ADD CONSTRAINT "ShortLink_quizSessionId_fkey"
FOREIGN KEY ("quizSessionId") REFERENCES "QuizSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShortLink" ADD CONSTRAINT "ShortLink_formId_fkey"
FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShortLink" ADD CONSTRAINT "ShortLink_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
