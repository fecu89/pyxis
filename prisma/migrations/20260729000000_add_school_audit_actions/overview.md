# 소속 관리 감사 로그 액션 추가

관리자 콘솔에 학교·반/부서(School/SchoolGroup) CRUD 기능을 추가하면서, 그 변경을 감사 로그에 남기기 위해 `AdminAuditAction` enum에 `SCHOOL_CREATED`/`SCHOOL_UPDATED`/`SCHOOL_DELETED`/`SCHOOL_GROUP_CREATED`/`SCHOOL_GROUP_UPDATED`/`SCHOOL_GROUP_DELETED` 6개 값을 추가했습니다. 데이터 변경은 없습니다.
