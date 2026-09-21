-- 손님(비로그인) 댓글: 글(Post)과 같은 규칙으로 작성자를 계정 또는 손님 세션 중 하나로 둡니다.
ALTER TABLE "Comment" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "Comment" ADD COLUMN "guestId" TEXT;
ALTER TABLE "Comment" ADD COLUMN "guestName" TEXT;

-- 애플리케이션 코드만 믿으면 언젠가 둘 다 비었거나 둘 다 채워진 행이 생깁니다.
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_author_or_guest"
  CHECK (("authorId" IS NOT NULL AND "guestId" IS NULL) OR ("authorId" IS NULL AND "guestId" IS NOT NULL));

-- 손님이 이 글에 단 자기 댓글을 찾을 때 씁니다(수정·삭제 권한 판정).
CREATE INDEX "Comment_postId_guestId_idx" ON "Comment"("postId", "guestId");
