-- 닉네임 유일성을 전역에서 학교 단위로 좁힙니다.
-- 동명이인(김민준 등)이 흔한데 전역 유일이면 다른 학교 학생이 먼저 쓴 이름을 쓸 수 없었습니다.
-- 제약을 푸는 방향이라 기존 데이터는 전부 새 제약을 만족합니다.
DROP INDEX "User_nameLookup_key";

-- schoolId가 null인 계정(관리자, 승인 대기 교사)은 PostgreSQL이 null을 서로 다른 값으로 취급해
-- 이 인덱스가 걸리지 않습니다. 그 구간은 응용 계층(lib/users/nickname.ts)이 검사합니다.
CREATE UNIQUE INDEX "User_schoolId_nameLookup_key" ON "User"("schoolId", "nameLookup");
