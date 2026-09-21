-- 기존 7일 기본값을 사용 중인 배포만 더 안전한 60분으로 옮깁니다. 관리자가 이후 정책 화면에서
-- 명시적으로 바꾼 값은 건드리지 않습니다.
UPDATE "SystemSetting"
SET "adminReauthWindowMinutes" = 60
WHERE "adminReauthWindowMinutes" = 10080;
