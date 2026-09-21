# Overview

padupgrade.md 8.3 대량 내보내기 Route Handler입니다. 실제 데이터 조회·파일 생성은 모두 `lib/exports/`에 있고, 이 라우트들은 권한 검사 호출과 응답 헤더(`Content-Type`, `Content-Disposition`)만 담당합니다.

- `csv/route.ts` — `GET ?type=posts|comments|reactions`(기본 posts). `requireBoardExportAccess`로 보드 관리자만 허용합니다.
- `xlsx/route.ts` — `GET`. 게시물·댓글·반응 3개 시트가 담긴 워크북 하나를 내려줍니다. `requireBoardExportAccess`.
- `attachments-zip/route.ts` — `GET`. `requireAttachmentZipAccess`(관리자 + 첨부 다운로드 정책)로 검사한 뒤, `archiver` 스트림을 `Readable.toWeb()`으로 그대로 응답 본문에 흘립니다 — 첨부가 많아도 서버 메모리에 전체를 올리지 않습니다.

세 라우트 모두 GET 전용 읽기 요청이라(polling이나 상태 변경이 없음) 다른 쓰기 API처럼 `assertSameOrigin`을 호출하지 않습니다 — `app/files/[attachmentId]/route.ts`도 같은 이유로 생략합니다.
