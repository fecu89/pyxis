-- 학교 NAT에서는 한 학급의 공개 퀴즈 소켓이 모두 같은 IP로 보입니다.
-- 기존 기본값 80은 100명 수업을 정상적으로 차단하므로 재연결 여유까지 포함해 200으로 올립니다.
ALTER TABLE "SystemSetting"
  ALTER COLUMN "publicQuizSocketConnectionsPerIp" SET DEFAULT 200;

-- 이전 기본값을 그대로 사용 중인 설치만 새 안전 기본값으로 이동합니다.
UPDATE "SystemSetting"
SET "publicQuizSocketConnectionsPerIp" = 200
WHERE "publicQuizSocketConnectionsPerIp" = 80;
