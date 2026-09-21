# CSV 내보내기 API

이 폴더는 보드 게시물·댓글·반응을 UTF-8 BOM CSV로 내려주는 `GET` Route Handler를 담당합니다. `type=posts|comments|reactions`를 허용하며, 보드 소유자·관리자인지 `requireBoardExportAccess`로 요청마다 다시 검사합니다. 데이터 조회와 CSV 이스케이프는 `lib/exports/`에 위임합니다.
