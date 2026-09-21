-- 비로그인 손님이 공개 보드에 글을 쓸 수 있게 합니다.
--
-- 손님은 계정이 없으므로 Post.authorId를 채울 수 없습니다. 그래서 nullable로 바꾸고, 대신
-- 서명 쿠키에서 온 guestId와 글쓰기 직전에 입력한 표시 이름 guestName을 답니다.
-- 기존 글은 모두 authorId가 있으므로 이 변경으로 바뀌는 데이터가 없습니다.
ALTER TABLE "Post" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "Post" ADD COLUMN "guestId" TEXT;
ALTER TABLE "Post" ADD COLUMN "guestName" TEXT;

-- 손님이 "내가 쓴 글"만 고치도록 판정할 때 쓰는 인덱스입니다.
CREATE INDEX "Post_boardId_guestId_idx" ON "Post"("boardId", "guestId");

-- **작성자는 둘 중 정확히 하나**여야 합니다. 응용 코드가 실수로 둘 다 비우거나 둘 다 채우면
-- 소유권 판정("이 글을 고칠 수 있는가")이 조용히 어긋나므로 DB에서 막습니다.
ALTER TABLE "Post" ADD CONSTRAINT "Post_author_or_guest"
  CHECK (("authorId" IS NOT NULL AND "guestId" IS NULL) OR ("authorId" IS NULL AND "guestId" IS NOT NULL));

-- 손님 글을 즉시 게시할지 승인 뒤에 보일지. 기본은 승인 대기(안전한 쪽)입니다.
ALTER TABLE "Board" ADD COLUMN "guestPostsRequireApproval" BOOLEAN NOT NULL DEFAULT true;
