# 학생 명단·비밀번호 초기화·학급 계층

`SchoolGroup.name` 하나에 들어 있던 `3학년 5반`을 `School → SchoolGrade → SchoolGroup(CLASS)` 관계로 정규화합니다. 기존의 `N학년 M반` 데이터는 마이그레이션에서 숫자를 추출해 자동 연결하며, 교사 부서는 학년과 무관하므로 기존 구조를 유지합니다.

`User.studentNumber`는 출석번호를, `User.mustChangePassword`는 일괄 생성·관리자 초기화 계정의 임시 비밀번호 상태를 저장합니다. 임시 비밀번호 상태에서는 전용 변경 화면 외의 경로를 사용할 수 없습니다. 학생 명단 등록과 관리자 비밀번호 초기화는 각각 `STUDENT_ROSTER_IMPORTED`, `USER_PASSWORD_RESET` 감사 로그로 남습니다.
