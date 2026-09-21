# Overview

이 폴더는 padupgrade.md 8.3(내보내기와 발표)의 서버 쪽 데이터·권한·파일 생성 로직을 담당합니다.

- `access.ts`: `requireBoardExportAccess`는 로그인 + 보드 관리자(`canManageBoardSettings`, 소유자·관리자)만 CSV·XLSX·첨부 ZIP을 받을 수 있게 합니다. 이 세 가지는 게시물·댓글·반응·첨부를 구조화된 한 파일로 묶어 반출하는 대량 내보내기라, 이미 화면에서 볼 수 있는 정보라도 보드 관리자로 제한했습니다(교사 사용 사례에 맞춘 설계 결정 — 학생 등 일반 멤버·방문자는 CSV/XLSX/ZIP을 받을 수 없습니다). `requireAttachmentZipAccess`는 여기에 더해 `canDownloadAttachment`(보드의 `attachmentDownloadPolicy`)까지 검사합니다 — 정책이 `DISABLED`면 관리자 자신도 첨부 ZIP을 받을 수 없습니다(전역 `EDIT_ANY_CONTENT`·전체관리자만 예외).
- 인쇄용 페이지(`/b/[slug]/print`)와 발표 모드(`/b/[slug]/present`)는 이 파일들을 쓰지 않고 보드 페이지와 똑같은 `getBoardPageData`로 읽기 권한만 검사합니다 — 두 화면 모두 이미 보드에서 읽을 수 있는 내용(PUBLISHED 게시물)만 다시 보여주는 것이라 별도 관리자 제한이 없습니다.
- `data.ts`의 `gatherBoardExportData(boardId, statusFilter?)`는 CSV·XLSX·발표 모드가 공유하는 단일 조회입니다. `statusFilter`를 생략하면(관리자용 대량 내보내기) PENDING·REJECTED까지 모두 담고, `"PUBLISHED"`를 넘기면(발표 모드) 일반 독자가 이미 볼 수 있는 범위로만 제한합니다. 사용자 정의 필드 값은 보드의 `postFieldConfig`(`parsePostFieldConfig`로 파싱)로 필드 ID → 라벨을 다시 매핑해 사람이 읽을 수 있는 이름으로 평탄화합니다.
- `csv.ts`: 의존성 없이 직접 만든 RFC4180 이스케이프 + BOM(엑셀에서 한글 깨짐 방지)로 게시물·댓글·반응 세 종류의 CSV를 만듭니다. 하나의 CSV는 표 하나만 표현할 수 있어 `?type=posts|comments|reactions` 쿼리로 셋을 나눕니다.
- `xlsx.ts`: `exceljs`로 게시물·댓글·반응 시트 3개를 한 워크북에 담습니다(CSV와 달리 여러 표를 한 파일에 담을 수 있어 관리자가 한 번에 받는 "전체 XLSX"에 씁니다). 사용자 정의 필드는 보드 전체에서 실제 등장한 라벨만 열로 고정합니다.
- `attachments-zip.ts`: `archiver`(v8, `ZipArchive` 클래스형 API — v7 이전의 `archiver(format, options)` 팩토리 함수와 다릅니다)로 스트리밍 ZIP을 만듭니다. 파일마다 `fs.createReadStream`으로 하나씩 이어 붙여 전체를 메모리에 올리지 않고, 응답도 `Readable.toWeb()`으로 그대로 흘려보냅니다(padupgrade.md 8.3 "대용량 ZIP을 메모리에 한꺼번에 올리지 않고 스트리밍"). 항목 경로는 `섹션명/게시물제목_id/파일명`이며 경로 구분자·제어 문자만 정리하고 한글은 그대로 둡니다(zip 항목명은 유니코드를 지원). `LINK` 첨부는 로컬 파일이 없으므로 URL을 담은 `.txt`로 대신합니다.
- `download.ts`: 파일 스트리밍 라우트(`app/files/[attachmentId]/route.ts`)와 같은 ASCII fallback + RFC 5987 UTF-8 인코딩 `Content-Disposition` 헬퍼입니다(그 파일은 담당 밖이라 직접 import하지 않고 같은 패턴을 이 폴더 안에 별도로 둡니다).

## 의존성

`exceljs`, `archiver`, `@types/archiver`를 새로 추가했습니다. `exceljs`가 내부적으로 오래된 `archiver`(구버전 API)를 번들링하면서 `brace-expansion`·`uuid`의 취약한 버전을 끌고 왔습니다. `uuid`는 `package.json`의 `resolutions`에 `"uuid": "^11.1.1"`로 고정합니다.

`brace-expansion`은 2026-08-09 기준 별도 핀 없이도 안전합니다 — 트리에 들어오는 1.1.18과 2.1.4가 이미 패치 릴리스라 `yarn audit`이 0건입니다(906개 검사). 예전에는 npm `overrides`에 `"exceljs": { "brace-expansion": "5.0.9" }`가 있었는데, 패키지 관리자를 Yarn으로 통일하면서 죽은 설정이 되어 제거했습니다(핀이 `resolutions`와 `overrides` 두 벌로 갈라진 것이 문제의 원인이었습니다 — `edit.md` 참고).

**다시 핀이 필요해지면 반드시 `exceljs` 하위로 범위를 좁히세요.** 예전에 최상위(전체 트리) `brace-expansion` 고정을 시도했다가, ESLint 자신의 오래된 `minimatch`가 그 최신 API와 맞지 않아 `eslint` 실행 자체가 깨졌습니다. Yarn Classic의 중첩 문법(`"exceljs/brace-expansion"`)은 이 트리에서 적용되지 않는 것을 확인했으므로, 그때는 `yarn why brace-expansion`으로 실제 경로를 먼저 확인해야 합니다.

## PDF·PNG 설계 선택

- PDF는 별도 서버 렌더러(예: puppeteer)를 두지 않았습니다. 이 배포는 `next build` 없이 `yarn dev`를 그대로 프로덕션 도메인에 연결해 쓰고 있어, 헤드리스 브라우저 바이너리(수백MB) 의존성을 새로 얹는 건 이 프로젝트의 가벼운 배포 방식과 맞지 않다고 판단했습니다. 대신 인쇄용 페이지(`components/pad/export/print-actions.tsx`)의 `window.print()` → 브라우저의 "다른 이름으로 저장 > PDF"로 해결했습니다. 실제 화면과 같은 CSS·이미지를 그대로 써서 오히려 더 정확하고, 새 의존성도 없습니다.
- PNG는 서버에서 임의 DOM을 렌더링할 방법이 없어(sharp는 이미지 처리 전용, HTML 렌더링 불가) 클라이언트 쪽 `html2canvas`로 인쇄 페이지의 콘텐츠 영역을 캡처해 다운로드합니다.
