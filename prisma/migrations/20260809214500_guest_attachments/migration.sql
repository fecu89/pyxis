-- 손님(비로그인) 첨부: 업로더 계정이 없으므로 uploaderId를 nullable로 바꾸고 guestId를 둡니다.
ALTER TABLE "Attachment" ALTER COLUMN "uploaderId" DROP NOT NULL;
ALTER TABLE "Attachment" ADD COLUMN "guestId" TEXT;

-- 글과 같은 규칙: 업로더는 계정이거나 손님이거나 둘 중 하나입니다.
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploader_or_guest"
  CHECK (("uploaderId" IS NOT NULL AND "guestId" IS NULL) OR ("uploaderId" IS NULL AND "guestId" IS NOT NULL));
