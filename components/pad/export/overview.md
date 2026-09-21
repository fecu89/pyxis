# Overview

padupgrade.md 8.3 내보내기·발표 UI 컴포넌트입니다.

- `pad-print-view.tsx` + `.module.css`: `/b/[slug]/print`의 실제 렌더링(Server Component). PUBLISHED 게시물만, 보드의 `showAuthor`/`showTimestamp` 설정을 그대로 따르고, 이미지 첨부는 원본(`/files/{id}`, 썸네일 아님 — 인쇄 품질 우선)을 보여줍니다.
- `print-actions.tsx` + `.module.css` (Client Component): 인쇄 페이지 상단에 뜨는 `no-print` 액션 바. "PDF로 저장"은 `window.print()`, "PNG로 저장"은 `html2canvas`(동적 import)로 `#print-content`를 캡처해 다운로드합니다. 두 버튼 모두 `app/globals.css`를 건드리지 않고 이 폴더의 CSS Module만 씁니다 — `no-print` 클래스 자체는 `pad-print-view.module.css`의 `@media print { :global(.no-print) { display:none } }` 규칙이 처리합니다.
- `pad-presentation.tsx` + `.module.css` (Client Component): `/b/[slug]/present`의 슬라이드 뷰어. 게시물 하나 = 슬라이드 하나, 좌우 화살표 키 또는 버튼으로 이동. `lib/exports/data.ts`의 `BoardExportPost` 타입을 `import type`으로만 가져와 쓰므로(런타임 값은 쓰지 않음) `server-only` 마커가 있는 그 모듈이 클라이언트 번들에 실제로 포함되지는 않습니다.

`pad-export-panel.tsx`(내보내기 트리거 모달 내용)는 이 폴더가 아니라 `components/pad/pad-export-panel.tsx`에 있습니다 — 다른 보드 패널(`pad-share-panel.tsx`, `pad-activity-panel.tsx` 등)과 같은 위치 규칙을 따른 것입니다.
