# 보드 템플릿 API

`PATCH /api/boards/{boardId}/template`은 소유자·보드 관리자·해당 시스템 권한자만 `Board.isTemplate`을 변경할 수 있게 합니다.

템플릿 표시는 접근 정책을 바꾸지 않습니다. 비공개 템플릿은 기존 멤버만 보고 복제할 수 있고, 공개 템플릿만 홈 템플릿 목록에 공개됩니다.
