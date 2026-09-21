# Overview

padupgrade.md 8.3 "인쇄용 HTML"·"PDF" 항목입니다. `page.tsx`는 `app/b/[slug]/page.tsx`(보드 본 페이지)와 완전히 같은 `getBoardPageData(slug, currentUser)`로 읽기 권한을 검사하고, `login-required`/`not-found`/`access-required`/`password-required`/`ready` 상태를 그대로 재사용합니다 — 이 페이지만의 별도 권한 로직은 없습니다.

`ready`일 때는 `components/pad/export/pad-print-view.tsx`(PUBLISHED 게시물만, 섹션당 최초 조회와 같은 개수 상한)를 렌더링합니다. PDF는 별도 서버 렌더러 없이 `PrintActions`의 `window.print()`(브라우저 "다른 이름으로 저장 > PDF")로 만듭니다 — 자세한 설계 이유는 `lib/exports/overview.md`를 참고하세요.
