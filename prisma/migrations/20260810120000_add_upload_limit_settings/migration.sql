-- 업로드 용량 상한을 코드 상수·환경 변수에서 SystemSetting 싱글턴 행으로 옮깁니다.
-- 기본값은 옮기기 전 코드에 박혀 있던 값 그대로라, 이 마이그레이션만으로는 동작이 바뀌지 않습니다.
--   maxUploadMb           30  <- MAX_UPLOAD_SIZE_MB 기본값
--   guestMaxUploadMb      10  <- GUEST_MAX_UPLOAD_BYTES
--   maxImageUploadMb      10  <- file-rules.ts의 IMAGE 캡
--   maxBoardBackgroundMb  10  <- background-image 라우트의 MAX_BACKGROUND_BYTES
--   maxQuizImageMb         8  <- image-store.ts의 MAX_QUIZ_IMAGE_BYTES
--   maxQuizImageStorageMb 256 <- MAX_QUIZ_IMAGE_STORAGE_MB 기본값
ALTER TABLE "SystemSetting"
  ADD COLUMN "maxUploadMb" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "guestMaxUploadMb" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "maxImageUploadMb" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "maxBoardBackgroundMb" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "maxQuizImageMb" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "maxQuizImageStorageMb" INTEGER NOT NULL DEFAULT 256;
