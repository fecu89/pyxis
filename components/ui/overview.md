# Overview

이 폴더는 pyxis 구현에서 `components/ui` 영역을 담당합니다.

`avatar.tsx`의 `Avatar`는 이름·로그인 식별자·프로필 사진을 받아 사진이 있으면 `<img>`, 없으면 이니셜 말풍선을 그리는 공용 컴포넌트입니다. 홈 네비게이션, 게시물 작성자, 댓글, 보드 멤버·접근 요청 목록 등 아바타가 나오는 모든 곳에서 재사용합니다.

`modal.tsx`의 `Modal`은 `variant` prop을 받습니다(기본값 `"center"`). `variant="side"`를 주면 화면 가운데 대신 오른쪽에서 슬라이드로 열리는 패널이 됩니다(`app/globals.css`의 `.modal-side`/`.modal-panel-side`). 설정처럼 뒤에 있는 콘텐츠(게시물 등)가 어떻게 바뀌는지 보면서 조정해야 하는 화면에 씁니다 — 가운데 모달은 화면을 다 가려서 이 용도에는 안 맞는다는 사용자 피드백으로 추가했습니다. 포커스 트랩·Escape·바깥 클릭 닫기 같은 접근성 로직은 두 variant가 완전히 같은 코드를 공유하며, CSS만 다릅니다. 720px 이하에서는 side variant도 다른 모달과 같은 하단 시트로 바뀝니다(옆으로 열 만한 공간이 없으므로).

**"타이핑 한 글자만 쳐도 포커스가 닫기(✕) 버튼으로 튐" 버그(수정됨)**: 포커스 관리 이펙트가 `[open, onClose]`에 의존하고 있었는데, `onClose`는 호출부에서 인라인 함수거나(`onClose={() => setOpen(false)}`) 안정되지 않은 값에 의존하는 `useCallback`(예: `post-composer.tsx`의 `closeComposer`는 매 렌더 새 객체인 업로드 큐 상태에 의존)으로 넘어오는 경우가 흔해서, 실제로는 **부모가 리렌더될 때마다**(입력창에 한 글자 칠 때마다) 이 이펙트가 다시 실행됐습니다. 게다가 이펙트의 `requestAnimationFrame` 콜백은 `panel.querySelector("[autofocus]")`로 "누가 autoFocus인지" 찾으려 했는데, React의 `autoFocus` prop은 마운트 시 `.focus()`만 호출할 뿐 실제 DOM에 `autofocus` 속성을 남기지 않아 이 셀렉터는 **한 번도 매치된 적이 없었습니다** — 그래서 이 콜백은 사실상 항상 "패널의 첫 번째 포커스 가능 요소"(헤더의 닫기 버튼, `children`보다 DOM에서 먼저 나옴)로 무조건 포커스를 되돌리고 있었습니다. 결과적으로 모달을 열 때도(React가 방금 준 자동 포커스를 다음 프레임에 다시 뺏어감) 원했던 입력창이 아니라 닫기 버튼에 포커스가 갔고, 이후 어떤 입력이든 한 글자 치면 리렌더 → 이펙트 재실행 → 다시 닫기 버튼으로 포커스가 튀었습니다. `post-composer.tsx`뿐 아니라 `autoFocus`를 쓰는 모든 모달(닉네임 변경, 보드 만들기, 섹션 추가, 보드 비밀번호 입력 등)이 똑같이 영향을 받고 있었습니다.

`Modal`의 `composer` 변형은 `side` 패널 배치를 사용하면서 `window.visualViewport`의 `resize`·`scroll`을 직접 반영합니다. 모바일 키보드로 레이아웃 뷰포트와 실제 보이는 높이가 달라져도 작성 패널과 하단 도구 막대가 시각 뷰포트를 벗어나지 않습니다. `bottom` 변형은 같은 높이·`offsetTop` 계산을 재사용하는 짧은 모바일 하단 시트입니다. 카드와 섹션의 dnd-kit `transform`이 `position: fixed`의 기준을 카드로 바꾸지 않도록 `createPortal`로 `document.body`에 렌더합니다. 키보드가 열리면 시트 바닥을 실제 보이는 뷰포트 바닥에 붙이고 safe-area 중복 여백을 제거하며, 닫힐 때 인라인 높이와 키보드 상태를 정리합니다.

`app-dialog.tsx`의 전역 `AppDialogProvider`는 확인·입력 Promise 큐와 작은 Context만 초기 번들에 둡니다. 실제 `Modal` 표면과 포커스 로직은 `app-dialog-surface.tsx` 동적 청크로 분리되어 첫 확인창을 열 때만 로드됩니다. Context 값은 memoize해 대화상자 큐 변화가 모든 `useConfirm` 소비자를 다시 그리지 않게 하며, Provider가 내려갈 때 남은 Promise는 취소 값으로 끝내 호출부 클로저를 붙잡지 않습니다.

수정: (1) `onClose`는 ref로 최신 값만 참조하고 이펙트 자체는 `[open]`에만 의존하게 해서 부모 리렌더로 인한 재실행을 없앴고, (2) rAF 콜백은 이제 "패널 안에 이미 포커스된 요소가 있으면"(React의 autoFocus든 사용자 클릭이든) 아무것도 하지 않고, 정말 아무 데도 포커스가 없을 때만 첫 요소로 기본 포커스를 줍니다.

화면 프리미티브는 한 `layout.tsx`에 몰아넣지 않고 책임별 파일을 직접 import합니다. `page-layout.tsx`는 `PageShell`·`PageHeader`·`BackLink`처럼 페이지 뼈대를, `feedback.tsx`는 `EmptyState`·`InlineNotice`·`ProgressBar`·`LoadingCard`처럼 진행·오류·빈 상태를, `data-display.tsx`는 `StatusBadge`·`StatCard`처럼 읽기 전용 표시를 담당합니다. 중간 barrel을 두지 않아 `InlineNotice` 하나를 쓰는 화면이 페이지·통계 프리미티브까지 같은 모듈 경계로 끌어오지 않습니다.

`content-library.module.css`는 패드·퀴즈·설문 보관함이 공유하는 화면 규칙입니다. 48px 검색·정렬 도구,
가로 스크롤 상태 칩, 그룹 제목과 페이지 간격을 정의합니다.

`content-card.tsx`의 `ContentCard`·`ContentCardBadge`·`ContentCardGrid`는 Pad 디자인을 기준으로
패드·퀴즈·설문의 목록 카드를 통일합니다. 상단 강조선, 선택적 커버, 배지, 두 줄 제목, 축약 설명,
메타 정보와 하단 액션을 같은 표면에 배치하고, 그리드는 4→3→2→1열로 줄어듭니다.
`content-card-menu.tsx`는 각 카드의 `…` 메뉴를 body 포털로 렌더해 카드의 hover transform이나
overflow에 잘리지 않게 합니다. 데스크톱은 화면 안에 위치하는 팝오버, 모바일은 하단 메뉴이며,
바깥 클릭·포커스 이동·Escape로 닫히고 키보드로 열면 첫 활성 항목에 포커스합니다.
세션 실행·공개 범위·응답 정책·메뉴 권한 같은 제품 동작은 각 기능 컴포넌트가 슬롯으로 전달합니다.

설문 유형 선택기는 같은 메뉴에 `triggerContent`·`triggerLabel`·`triggerClassName`·`triggerRef`를
전달해 아이콘과 현재 값이 있는 버튼으로 사용합니다. `panelWidth`·`panelMaxHeight`로 크기를 제한하고,
`keyboardNavigation`을 켜면 방향키/Home/End 이동과 현재 선택 항목 표시·포커스를 지원합니다.
기본값은 기존 카드 메뉴 동작을 유지해 메뉴 안 입력창의 방향키를 가로채지 않습니다.
`ContentCardMenuItem`의 `description`·`selected`는 설명과 선택 강조를 위한 선택적 확장입니다.

`page-number-navigation.tsx`의 `PageNumberNavigation`은 서버 렌더 목록이 공유하는 이전/다음 경계입니다. `basePath`와 유지할 query만 받아 페이지 URL을 만들고 반복 상세 라우트처럼 `prefetch={false}`를 사용합니다. 현재 리포트, 퀴즈 세션 기록, 학생 과제가 이 컴포넌트를 공유합니다.

`icons.tsx`는 원래 `components/quiz` 아래 있었지만 전역 오류 화면과 공용 UI도 사용하므로 이 폴더로 옮겼습니다. 공용 계층이 기능 계층을 역으로 import하지 않는 것이 기준입니다. 클립보드 상태와 정리 타이머를 캡슐화한 `copy-button.tsx`도 같은 이유로 quiz 전용 폴더에서 이동했으며, 퀴즈 화면은 공용 컴포넌트를 소비합니다.

`selectable-list.tsx`의 `SelectableList`/`PagedSelectableList`는 "행 전체를 클릭해서 고르는" 선택 목록 공용 프리미티브입니다. `components/admin/user-card.tsx`·`admin-users-panel.tsx`에 있는 admin 사용자 목록의 선택 UX(행 클릭 토글, shift 클릭 범위 선택, sr-only 체크박스, 툴바의 전체선택·전체 해제)를 다른 화면에서도 그대로 쓸 수 있게 뽑아낸 것이라 동작 규칙이 admin과 동일합니다. `SelectableList`는 이미 가진 `items` 배열만 그리는 순수 프리미티브(패널·헤더·검색은 안 그림)라 이미 자기 박스가 있는 화면에 그대로 끼워 넣고, `toolbarActions`로 선택 항목에 적용할 승인 같은 화면별 명령을 공용 전체선택·해제 버튼 앞에 추가할 수 있습니다. `PagedSelectableList`는 검색(250ms debounce) + 페이지네이션 + `.select-panel` 박스까지 갖춘 완결형으로, 내부적으로 `SelectableList`를 그대로 재사용합니다. 검색·페이지·필터가 바뀌거나 컴포넌트가 내려가면 진행 중인 `load`에 전달한 `AbortSignal`을 취소해 오래된 HTTP 요청 자체가 계속 돌지 않게 합니다. `deferLoad`/`ready`/`idleLabel`로 "먼저 다른 조건(예: 학급)을 골라야 검색이 되는" 화면을 지원하되, 검색어가 입력되면 `ready` 여부와 무관하게 즉시 찾습니다. 툴바 문구는 `unitLabel`(명사) + `unitSuffix`(세는 단위, 기본 "개")로 조립합니다 — 사람 목록이면 `unitSuffix="명"`을 넘겨 "학생 5명 선택됨"이 되게 합니다.

`SelectableList`의 `selectionMode`는 기본 `"multiple"`(체크박스 다중 선택 + shift 범위 선택 + 툴바)이고, `"single"`을 주면 행을 클릭할 때마다 그 행 하나로 선택을 통째로 교체하는 라디오형으로 바뀝니다(예: 공유 대화상자에서 초대 링크를 하나만 고를 때). 이미 선택된 행을 다시 클릭하면 해제되어 "아무것도 선택 안 함"도 유효한 상태이며, 그래서 sr-only 입력은 `single`에서도 여전히 `checkbox`입니다 — `radio`는 그룹 안에서 "전부 해제"를 표준적으로 지원하지 않아 이 해제 동작과 맞지 않습니다. `single`에서는 shift 클릭도 범위 선택 없이 그냥 클릭으로 처리하고(앵커 로직 미사용), 툴바는 `toolbar` prop과 무관하게 항상 숨깁니다(전체선택이 의미가 없으므로). `onSelectionChange`의 `changed`는 교체 시 `[{ id: 이전, selected: false }, { id: 새것, selected: true }]`(이전 선택이 없었으면 새것 항목만), 해제 시 `[{ id, selected: false }]`입니다. `PagedSelectableList`는 `selectionMode`를 받지 않고 항상 다중 선택입니다.

툴바의 "전체선택"은 admin과 달리 지금 선택을 **교체하지 않고 합집합으로 더합니다** — admin 사용자 목록은 한 페이지에 대상 전체가 다 있어 교체해도 되지만, 이 프리미티브는 페이지네이션과 함께 쓰이는 경우가 있어 한 화면엔 일부만 있고 "전체선택 → 다음 페이지 → 또 전체선택"으로 페이지를 넘나들며 선택을 쌓아야 하기 때문입니다. "전체 해제"도 같은 이유로 **지금 보이는 항목만** 해제합니다 — selected에는 화면 밖 항목이 섞여 있을 수 있어(리소스 패널의 "원래 연결돼 있던" 항목 등) 보이지 않는 것까지 비우면 인지하지 못한 대량 해제가 예약됩니다. 색은 전부 `app/globals.css`의 `.select-*` 클래스(브랜드 파생 토큰만)를 씁니다 — 옛 `.course-picker-controls`/`-search`/`-filter`/`-notice`/`-row-select`/`-row[data-checked]`는 이 프리미티브로 대체되어 제거됐고, 명단·연결 표시 전용으로 남은 `.course-picker-head`/`-count`/`-empty`/`-list`/`-row[data-static]`/`-row-copy`/`-pager`/`-apply`·`.course-group-*`만 `components/courses`에 남아 있습니다. admin 사용자 카드의 hover·선택 배경·선택 아바타 색도 `.select-row:hover`/`[data-selected]`/`::before`, `.select-row-avatar[data-selected]`에 `.admin-user-card.selectable`/`.selected`/`.selected::before`, `.admin-avatar[data-selected]`를 셀렉터로 그룹화해 얹었습니다(중복 규칙 제거) — `.admin-avatar[data-selected="true"]`는 정지된(suspended) 계정의 grayscale 필터를 되돌리려고 `filter: none`을 함께 씁니다.

`.select-box`는 `.select-panel`처럼 테두리·헤더가 있는 완결형 패널이 아니라, 이미 자기 모달·패널이 있는 화면에 검색줄+목록만 끼워 넣는 가벼운 grid 래퍼입니다(예: `components/pad/settings/member-candidate-search.tsx`의 멤버 후보 검색 — 모달 안에 들어가므로 `.select-box .select-list`가 목록 높이를 380px 대신 240px로 낮춥니다). `.select-note`는 `.select-idle`/`.select-empty`(가운데 정렬된 큰 placeholder)와 달리 검색줄 바로 아래 두는 조용한 한 줄 안내(검색 전 힌트, 조직 범위, "찾는 중…", 결과 없음)입니다. `.select-row[data-static="true"]`는 클릭해도 선택되지 않는 정적 행(`SelectableList`가 아니라 같은 색 토큰만 빌려 쓰는 목록)에서 hover 틴트를 지웁니다. `.select-row-flag`는 행 오른쪽의 작은 정보 배지(역할 표시 등)입니다.

적용 현황: `components/courses`의 명단(roster-panel)·리소스 연결(resource-panel) 패널이 첫 적용이고, quiz 학생 할당 모달(`components/quiz/quiz-library.tsx`)이 `PagedSelectableList`(deferLoad — 학급 선택·검색어 게이트)로 이관됐습니다. `selectionMode="single"`의 실제 소비자는 공유 대화상자 2곳(quiz `ShareDialog`, `components/forms/share-dialog.tsx`) — 교사를 한 명 골라 권한을 부여하는 화면이라 단일 선택이며, 이미 공유 중인 교사 행에는 `.select-row-flag`로 「공유 중 · 권한」을 표시하되 재선택해 권한을 바꿀 수 있게 후보에 남겨 둡니다(POST가 upsert). pad 멤버 검색(`components/pad/settings/member-candidate-search.tsx`)은 `SelectableList` 컴포넌트 자체가 아니라 `.select-box`/`.select-search`/`.select-list`/`.select-row[data-static]`/`.select-row-copy`/`.select-note` 클래스만 가져다 씁니다 — 검색 결과를 누르면 즉시 "추가"되고 목록에서 빠지는 흐름이라 다중/단일 선택 상태 자체가 없기 때문입니다. 남은 이관 예정은 admin 사용자 목록 컴포넌트 자체뿐입니다(현재는 이 프리미티브가 흉내 낸 원본이라 CSS 선언만 공유 중 — `UserCard`가 배지·메타·액션이 있는 복합 레이아웃이라 행 렌더러 주입 API가 필요해 보류).
