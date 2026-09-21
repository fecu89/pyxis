-- User 삭제는 개인정보를 비식별화하는 soft delete라 FK cascade가 실행되지 않습니다.
-- 앞으로는 관리자 단건·일괄 삭제 트랜잭션이 BoardMember를 직접 지우고, 이 마이그레이션은
-- 이전 삭제 로직이 남긴 멤버십만 한 번 정리합니다.
DELETE FROM "BoardMember" AS membership
USING "User" AS account
WHERE membership."userId" = account."id"
  AND account."status" = 'DELETED';
