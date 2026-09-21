-- 학교 NAT 뒤 한 반이 같은 IP를 공유해도 공개 퀴즈 정상 입장이 막히지 않게 기본 상한을
-- 20/분에서 120/분으로 올립니다. 잘못된 PIN은 응용 계층의 별도 20/분 버킷이 제한합니다.
ALTER TABLE "SystemSetting"
  ALTER COLUMN "publicQuizJoinPerMinute" SET DEFAULT 120;

UPDATE "SystemSetting"
SET "publicQuizJoinPerMinute" = 120
WHERE "id" = 'default' AND "publicQuizJoinPerMinute" = 20;
