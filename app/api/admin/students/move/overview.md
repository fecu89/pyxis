# 학생 반 이동 API

`PATCH /api/admin/students/move`는 선택한 삭제되지 않은 학생 최대 100명을 한 학급으로 이동합니다. 전체관리자, `CHANGE_NON_ADMIN_ROLES` 보조관리자, 학생의 기존 학교와 도착 학교가 모두 자기 학교인 대표교사만 실행할 수 있습니다.

학교 단위 advisory lock과 Serializable 트랜잭션 안에서 사용하지 않는 1~99번을 앞에서부터 배정합니다. 학생 학교·학급·번호와 세션 버전을 함께 갱신하고 `STUDENTS_CLASS_MOVED` 감사 로그에 대상과 배정 결과, 사유를 저장합니다. 일부 학생만 이동하는 상태는 만들지 않습니다.
