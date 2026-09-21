# XLSX 내보내기 API

이 폴더는 게시물·댓글·반응 3개 시트를 포함한 XLSX 워크북을 내려주는 `GET` Route Handler를 담당합니다. 보드 소유자·관리자인지 `requireBoardExportAccess`로 검사하고, 데이터 조회와 워크북 생성은 `lib/exports/`에 위임합니다.
