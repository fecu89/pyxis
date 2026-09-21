# 학교 대표교사(school-scoped placement admin)

`User.isSchoolRepresentative`(기본 false)를 추가했습니다. TEACHER 역할에서만 의미가 있고, true면 그 교사는 자기 학교(`schoolId`) 안에서 학생·교사의 반/부서 배치와 반/부서(SchoolGroup) 생성·수정·삭제를 할 수 있습니다. 학교 자체의 생성·이름변경·삭제, 역할·계정상태 변경, 세션 해제, PII 조회, 계정 삭제, 다른 학교 관리, 감사 로그 열람은 여전히 SUPER_ADMIN 전용입니다. SUPER_ADMIN만 이 플래그를 부여·회수할 수 있습니다(`AdminAuditAction.SCHOOL_REPRESENTATIVE_GRANTED`/`_REVOKED`로 감사 로그에 남음).
