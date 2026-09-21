ALTER TABLE "User"
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

-- 이 기능 도입 전에 이미 로그인해 사용하던 회원은 가입 절차를 다시 밟지 않습니다.
UPDATE "User"
SET "onboardingCompletedAt" = COALESCE("lastLoginAt", "createdAt");
