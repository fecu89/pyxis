-- 닉네임 원문을 노출하지 않는 HMAC 고유 키
ALTER TABLE "User" ADD COLUMN "nameLookup" TEXT;
CREATE UNIQUE INDEX "User_nameLookup_key" ON "User"("nameLookup");

CREATE TYPE "AuthSecurityEventType" AS ENUM (
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'LOGIN_RATE_LIMITED',
  'REGISTER_SUCCESS',
  'REGISTER_REJECTED',
  'REGISTER_RATE_LIMITED'
);

CREATE TABLE "AuthRateLimit" (
  "key" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "blockedUntil" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "AuthSecurityEvent" (
  "key" TEXT NOT NULL,
  "type" "AuthSecurityEventType" NOT NULL,
  "accountLookup" TEXT,
  "ipLookup" TEXT NOT NULL,
  "userId" TEXT,
  "count" INTEGER NOT NULL DEFAULT 1,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthSecurityEvent_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "AuthRateLimit_category_expiresAt_idx" ON "AuthRateLimit"("category", "expiresAt");
CREATE INDEX "AuthRateLimit_expiresAt_idx" ON "AuthRateLimit"("expiresAt");
CREATE INDEX "AuthSecurityEvent_type_lastSeenAt_idx" ON "AuthSecurityEvent"("type", "lastSeenAt");
CREATE INDEX "AuthSecurityEvent_accountLookup_lastSeenAt_idx" ON "AuthSecurityEvent"("accountLookup", "lastSeenAt");
CREATE INDEX "AuthSecurityEvent_ipLookup_lastSeenAt_idx" ON "AuthSecurityEvent"("ipLookup", "lastSeenAt");
CREATE INDEX "AuthSecurityEvent_expiresAt_idx" ON "AuthSecurityEvent"("expiresAt");
