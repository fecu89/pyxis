-- CreateEnum
CREATE TYPE "BoardDiscoveryScope" AS ENUM ('PRIVATE', 'LINK', 'PUBLIC');

-- CreateEnum
CREATE TYPE "BoardVisitorPermission" AS ENUM ('NO_ACCESS', 'READER', 'COMMENTER', 'WRITER');

-- AlterTable
ALTER TABLE "Board" ADD COLUMN     "discoveryScope" "BoardDiscoveryScope" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN     "loginRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "visitorPermission" "BoardVisitorPermission" NOT NULL DEFAULT 'NO_ACCESS';

-- CreateIndex
CREATE INDEX "Board_discoveryScope_idx" ON "Board"("discoveryScope");


-- Data backfill: 기존 visibility 값을 새 발견범위/방문자권한 모델로 매핑합니다.
-- PUBLIC -> 발견범위 PUBLIC, 방문자권한 READER, 로그인 불필요(기존과 동일하게 익명 열람 가능)
-- MEMBERS/INVITE_ONLY/PRIVATE -> 셋 다 현재 동일하게 동작하므로 발견범위 PRIVATE, 방문자권한 NO_ACCESS로 통합
UPDATE "Board" SET
  "discoveryScope" = CASE WHEN "visibility" = 'PUBLIC' THEN 'PUBLIC'::"BoardDiscoveryScope" ELSE 'PRIVATE'::"BoardDiscoveryScope" END,
  "visitorPermission" = CASE WHEN "visibility" = 'PUBLIC' THEN 'READER'::"BoardVisitorPermission" ELSE 'NO_ACCESS'::"BoardVisitorPermission" END,
  "loginRequired" = CASE WHEN "visibility" = 'PUBLIC' THEN false ELSE true END;
