-- 소유자 계정이 삭제될 때 패드를 같이 지우지 않고 소유권을 승계시키기 위해 ownerId를 nullable로
-- 바꿉니다. 승계 대상(패드 ADMIN → 학교 대표교사)을 찾지 못한 패드는 ownerId가 비고 FROZEN이 되어
-- 읽기 전용으로 남습니다. 회원 삭제는 행 삭제가 아니라 익명화라서 실제로 FK가 끊길 일은 없지만,
-- 참조 동작도 RESTRICT에서 SET NULL로 맞춰 둡니다.
ALTER TABLE "Board" ALTER COLUMN "ownerId" DROP NOT NULL;

ALTER TABLE "Board" DROP CONSTRAINT "Board_ownerId_fkey";
ALTER TABLE "Board" ADD CONSTRAINT "Board_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
