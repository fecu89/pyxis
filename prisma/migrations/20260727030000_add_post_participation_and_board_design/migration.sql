-- Extend the board presentation options without rewriting existing board rows.
ALTER TYPE "BoardLayout" ADD VALUE IF NOT EXISTS 'GRID';
ALTER TYPE "BoardLayout" ADD VALUE IF NOT EXISTS 'STREAM';
ALTER TYPE "BoardLayout" ADD VALUE IF NOT EXISTS 'TIMELINE';
ALTER TYPE "BoardLayout" ADD VALUE IF NOT EXISTS 'TABLE';

CREATE TYPE "BoardSortMode" AS ENUM ('MANUAL', 'CREATED_ASC', 'CREATED_DESC', 'TITLE', 'RANDOM');
CREATE TYPE "NewPostPlacement" AS ENUM ('START', 'END');
CREATE TYPE "BoardCardSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');
CREATE TYPE "BoardFont" AS ENUM ('SANS', 'SERIF', 'MONO');
CREATE TYPE "ReactionPolicy" AS ENUM ('SINGLE', 'MULTIPLE');
CREATE TYPE "AttachmentDownloadPolicy" AS ENUM ('READERS', 'MEMBERS', 'EDITORS', 'DISABLED');

ALTER TABLE "Board"
  ADD COLUMN "sortMode" "BoardSortMode" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "newPostPlacement" "NewPostPlacement" NOT NULL DEFAULT 'END',
  ADD COLUMN "cardSize" "BoardCardSize" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "font" "BoardFont" NOT NULL DEFAULT 'SANS',
  ADD COLUMN "backgroundColor" TEXT,
  ADD COLUMN "backgroundImageUrl" TEXT,
  ADD COLUMN "accentColor" TEXT,
  ADD COLUMN "showAuthor" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "showTimestamp" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reactionPolicy" "ReactionPolicy" NOT NULL DEFAULT 'SINGLE',
  ADD COLUMN "attachmentDownloadPolicy" "AttachmentDownloadPolicy" NOT NULL DEFAULT 'READERS',
  ADD COLUMN "postFieldConfig" JSONB;

ALTER TABLE "Post" ADD COLUMN "customFieldValues" JSONB;

ALTER TABLE "Attachment"
  ADD COLUMN "commentId" TEXT,
  ADD COLUMN "altText" TEXT,
  ADD COLUMN "caption" TEXT,
  ADD COLUMN "externalUrl" TEXT,
  ALTER COLUMN "storedName" DROP NOT NULL,
  ALTER COLUMN "storagePath" DROP NOT NULL;

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COMMENT_MENTIONED';
ALTER TABLE "Notification" ADD COLUMN "commentId" TEXT;

-- Preserve every existing LIKE row while changing the enum column into a validated string key.
ALTER TABLE "Reaction" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Reaction" RENAME COLUMN "type" TO "key";
ALTER TABLE "Reaction" ALTER COLUMN "key" TYPE TEXT USING ("key"::text);
ALTER TABLE "Reaction" ALTER COLUMN "key" SET DEFAULT 'LIKE';
DROP TYPE "ReactionType";

CREATE TABLE "CommentMention" (
  "commentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommentMention_pkey" PRIMARY KEY ("commentId", "userId")
);

CREATE INDEX "Attachment_commentId_sortOrder_idx" ON "Attachment"("commentId", "sortOrder");
CREATE INDEX "CommentMention_userId_createdAt_idx" ON "CommentMention"("userId", "createdAt");

ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommentMention" ADD CONSTRAINT "CommentMention_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommentMention" ADD CONSTRAINT "CommentMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
