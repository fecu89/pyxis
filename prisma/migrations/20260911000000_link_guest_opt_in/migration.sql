-- 기존 LINK는 서버에서 읽기 전용으로 강제되던 상태였습니다. 새 WRITER 정책 배포 전에
-- 과거 잔존 권한(보관된 패드 포함)을 읽기 전용으로 정규화해 자동 권한 확대를 막습니다.
-- 이후 관리자가 명시적으로 켠 WRITER는 이 일회성 마이그레이션의 대상이 되지 않습니다.
UPDATE "Board"
SET "visitorPermission" = 'READER', "loginRequired" = false
WHERE "discoveryScope" = 'LINK'
  AND ("visitorPermission" <> 'READER' OR "loginRequired" <> false);
