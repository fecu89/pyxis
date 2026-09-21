# 패드 보관함 API

`GET /api/boards/[boardId]/trash`는 활성 패드 안에서 숨김 처리된 섹션·게시물·댓글·
첨부파일의 최소 정보를 반환합니다. 패드 운영자는 전체 항목을, 일반 멤버는 자신이 복구
또는 영구 삭제할 수 있는 항목만 조회하며 응답은 `no-store`입니다.

화면의 여러 항목 선택·일괄 영구 삭제는
`DELETE /api/admin/boards/[boardId]/trash/purge`가 담당합니다. 자세한 검증·트랜잭션
규칙은 해당 라우트의 `overview.md`를 참고합니다.
