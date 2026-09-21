# 보드 레이아웃 개요

이 폴더는 보드의 공통 데이터와 게시물 렌더 함수를 받아 배치 방식만 바꾸는 레이아웃 계층입니다.

- `PadLayoutRenderer`가 Columns·Wall·Grid·Stream·Timeline·Table 중 하나를 선택합니다.
- 각 레이아웃은 게시물 카드의 편집·댓글·첨부 로직을 소유하지 않고 `renderPost`로 전달받습니다.
- 레이아웃 전환은 같은 섹션·게시물 DTO를 다시 배치할 뿐 DB의 섹션이나 게시물 순서를 삭제하지 않습니다.
- 수동 정렬이 아닌 경우 `dragDisabled`를 게시물 렌더 함수에 전달해 드래그 UI를 끕니다. Wall·Grid는 `components/pad/pad-flat-board.tsx`의 `FlatDragBoardView`가 이 레이아웃들을 감싸 실제 드래그 재정렬을 지원합니다(수동 정렬일 때만, `dragDisabled` 값은 이 래퍼가 직접 계산해 넘기고 레이아웃이 렌더 컨텍스트로 넘기는 값은 무시함) — SECTIONS의 다중 컨테이너 `onDragOver` 대신 게시물 전체를 하나의 평면 리스트로 보고 `arrayMove` 한 번으로 재정렬합니다. Stream·Timeline·Table은 아직 `PadLayoutRenderer`를 감싸는 드래그 래퍼가 없어 이 값이 항상 켜진 채로(드래그 불가) 넘어갑니다(자세한 배경은 `components/pad/overview.md`의 관련 절 참고).
- 무작위 정렬은 `Math.random()`을 쓰지 않고 게시물 ID의 결정적 해시를 사용해 서버와 클라이언트 결과를 일치시킵니다.
- Columns는 섹션 단위 가로 탐색, Wall은 masonry형 열, Grid는 균등 카드, Stream은 한 줄 피드, Timeline은 날짜 축, Table은 게시물과 사용자 정의 필드의 행·열 보기를 제공합니다.
- 모든 레이아웃은 제목 구조, 빈 상태, 키보드 포커스와 모바일 반응형 배치를 유지합니다.
- 외형 설정은 허용된 글꼴·카드 크기 값과 CSS 변수만 사용하며 임의 CSS 문자열을 실행하지 않습니다.

Table은 `tableColumns`의 열 이름과 렌더 함수만 받아 사용자 정의 필드 저장 구조에 직접 의존하지 않습니다. 필드 스키마 인계 뒤에는 보관되지 않은 필드 정의를 이 열 계약으로 변환합니다.

## 섹션 설명 표시, 더블클릭 편집 (사용자 UX 피드백 반영)

- `board.layout === "SECTIONS"`(기본값, 사용자가 부르는 "Columns")는 이 폴더의 `ColumnsLayout`이 아니라 `components/pad/section-column.tsx`가 직접 그립니다(`pad-canvas.tsx`가 `layout==="SECTIONS"`일 때 dnd-kit 드래그앤드롭 경로로 따로 분기). 이 폴더의 `ColumnsLayout`은 `PadLayoutRenderer`의 `default` 분기라 `PadLayoutKind`에 없는 값에서만 실행되므로 지금은 실제로 도달하지 않는 코드입니다 — padupgrade.md 7.1의 "Columns를 렌더러 구조로 이동" 항목이 아직 완료되지 않은 상태를 그대로 반영합니다. 그래도 나중에 그 마이그레이션이 끝나면 바로 맞는 동작을 하도록 아래 변경을 여기도 함께 적용해 뒀습니다.
- 섹션 설명은 Wall/Grid/Stream/Timeline에서는 원래도 안 보여줬고(제목 배지만), Table과 `ColumnsLayout`(`SectionHeader`)에서는 보여주고 있었는데 "섹션 설명이 너무 길다"는 피드백으로 전부 제목만 남겼습니다. 설명 데이터 자체는 계속 저장되고 편집 화면에서는 그대로 바꿀 수 있습니다.
- 모든 레이아웃의 섹션 제목(또는 Table의 `<strong>`, Wall/Grid/Timeline의 `.sectionTag`)에 더블클릭하면 `onEditSection` 콜백이 불립니다. `pad-canvas.tsx`는 `capabilities.manageBoard`일 때만 이 콜백을 넘기고, 콜백을 받으면 자기 상태(`editingLayoutSectionId`)로 편집 모달을 엽니다 — `SectionColumn`은 원래 자기 모달이 있었지만, 다른 레이아웃들은 섹션 단위 컴포넌트가 없어서 섹션 편집 자체가 아예 없었던 기능 공백이었습니다.
