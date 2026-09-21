# 보드 작성·외형 설정 개요

이 폴더는 보드별 게시물 필드와 레이아웃·외형 설정 UI를 데이터 저장 계층과 분리해 제공합니다.

- `pad-appearance-form.tsx`는 열·담벼락·격자·피드·타임라인·표 레이아웃, 배경색, 강조색, 글꼴, 카드 크기, 작성자·시간 표시, 새 글 위치와 정렬 방식을 편집합니다. `layout-picker.tsx`는 각 레이아웃의 실제 배치 구조를 축약한 SVG 미리보기와 설명을 닫힌 버튼과 드롭다운 선택지 양쪽에 보여줍니다.
- 수동 정렬이 아닌 정렬 방식을 선택하면 드래그가 비활성화된다는 안내를 표시합니다.
- `attachment-policy-form.tsx`는 보드 열람 권한과 원본 다운로드 버튼·요청 권한을 분리해 열람자·멤버·편집자·비활성 정책을 선택합니다. 파일 API와 전체 ZIP은 이 값을 서버에서 다시 검사해야 합니다.
- 인라인 미디어는 브라우저에 바이트가 전달되므로 다운로드 비활성화가 완전한 복사 방지를 뜻하지 않음을 UI에 안내합니다.
- `board-background-image-field.tsx`는 `기본 정보` 탭에서 JPG·PNG·WebP 배경을 선택·교체·삭제합니다. 파일은 `/api/boards/[boardId]/background-image`가 최대 10MB로 제한하고 실제 이미지 시그니처 검사 후 최대 1920×1200 WebP로 다시 인코딩합니다. 응답으로 받은 버전 URL만 draft에 반영하며 임의 외부 CSS URL은 받지 않습니다.
- `post-field-designer.tsx`는 제목·본문·첨부의 표시·필수·placeholder와 사용자 정의 필드를 관리합니다.
- 사용자 정의 필드는 단답형·장문형·단일선택·다중선택을 지원합니다.
- 단일·다중선택의 선택지는 쉼표·`#`·Enter로 확정되는 제거 가능한 칩으로 편집하며, 여러 값을 붙여넣어도 같은 구분자로 나눕니다. 서버에는 기존과 같은 문자열 배열로 저장합니다.
- 기존 사용자 정의 필드는 삭제하지 않고 `archived`로 숨깁니다. 유형·선택지가 바뀌면 필드 버전을 올려 과거 값의 해석 기준을 유지합니다.
- `post-custom-fields-input.tsx`는 활성 필드의 작성 UI를, `post-custom-fields-display.tsx`는 저장된 값을 읽기 전용으로 표시합니다.
- `types.ts`는 `lib/post-fields/types.ts`의 서버 공통 필드 계약을 다시 내보내 UI와 API 타입의 의미가 달라지지 않게 합니다.
- `post-field-table-columns.ts`는 보관되지 않은 사용자 정의 필드를 Table 레이아웃의 열 계약으로 변환합니다. 게시물 값 저장 구조는 호출자가 `readValues`로 연결합니다.

DB에 저장할 때는 `PostFieldConfig.version`, 각 필드의 `version`, 게시물 값이 작성될 당시의 필드 버전을 함께 보존해야 합니다. 과거 게시물 값은 현재 필드 정의가 보관 처리되더라도 삭제하지 않습니다.

## 보드 설정 모달 탭 구조 (사용자 UX 피드백 반영)

`pad-settings-tabs.tsx`(+`.module.css`)는 예전에 `pad-canvas.tsx`의 보드 설정 모달 하나에 순서 없이 나열되던 기본 정보·공개 정책·외형·게시물 필드·참여·첨부·승인·동결·접근 요청·초대·멤버 설정을 기능별 탭으로 묶은 컴포넌트입니다. 데스크톱은 설명이 붙은 왼쪽 내비게이션과 오른쪽 설정 화면, 모바일은 가로 탭과 단일 설정 화면으로 바뀝니다.

- 비활성 탭은 언마운트하지 않고 `hidden` 속성으로만 숨깁니다 — 이 컴포넌트의 모든 `<input>`/`<select>`가 `pad-canvas.tsx`의 같은 `<form onSubmit={saveSettings}>` 안에 있어서, 탭을 넘나들어도 `FormData`가 보이지 않는 탭의 값까지 그대로 모읍니다.
- `pad-sharing-settings.tsx`는 `공개·공유` 탭에서 발견 범위·손님 글쓰기·승인·비밀번호를 저장합니다. LINK/PUBLIC 모두 읽기 전용이 기본이며 손님 글쓰기를 켜면 `WRITER/loginRequired=false`로 저장합니다. 범위를 바꾸면 쓰기 허용을 초기화하고, 쓰기를 켤 때 승인 대기를 기본 선택합니다. 손님은 이름을 입력해 자기 글·댓글만 다루며 사진 제한을 유지합니다. 끄면 기존 글은 남지만 작성·수정·삭제·첨부가 막힙니다. 같은 탭 아래에서 역할별 초대 링크를 관리합니다.
- 접근 요청은 `멤버` 탭 상단에 두고 참여 멤버·멤버 추가 순서로 이어집니다. 요청 처리 성공 시 멤버 목록을 다시 읽으며, 이미 조회 중이면 완료 후 새로고침을 한 번 예약해 승인된 멤버가 빠지지 않게 합니다. 알림에서 여는 개별 요청 모달과 승인·거절 권한은 그대로 유지합니다.
- URL 복사와 QR은 상단 `pad-share-panel.tsx`에만 있습니다. 반대로 상단 공유창에는 발견 범위·비밀번호·iframe 삽입 설정이 없습니다.
- `pad-canvas.tsx`에는 이 컴포넌트를 렌더링하는 호출과, 탭 아래 고정 푸터의 자동 저장 상태·패드 보관 동작만 있습니다.
- 기본 정보의 배경 이미지 업로드·삭제는 일반 설정 자동 저장과 분리된 전용 API를 사용합니다. `backgroundImageUrl`은 일반 `PATCH /api/boards/[boardId]` 입력에서 제외되어 클라이언트가 임의 내부·외부 URL을 주입할 수 없고, 업로드 완료 시 패드 배경과 홈 카드 커버가 같은 URL로 갱신됩니다.
- 설정 모달은 `<Modal variant="side">`로 열립니다 — 가운데 모달이 게시물을 다 가려서 설정을 바꿀 때 보드가 어떻게 변하는지 안 보인다는 피드백을 반영해 오른쪽에서 슬라이드로 여는 패널로 바꿨습니다. `variant` 자체는 `components/ui/modal.tsx`가 제공하며, 자세한 내용은 `components/ui/overview.md`를 참고합니다.
- 멤버 탭의 역할 `select`는 다크 테마에서 네이티브 선택 목록까지 어두운 배경과 밝은 글자를 사용하도록 `color-scheme`, `option`, 비활성 소유자 상태를 각각 지정합니다. 멤버 API는 이전 soft-delete가 남긴 관계가 있더라도 `DELETED` 사용자를 반환하지 않으며, 현재 삭제 API는 관계 자체를 같은 트랜잭션에서 제거합니다.
- `member-invite-picker.tsx`(한 명씩 검색해 추가) 옆에 `member-group-invite.tsx`가 있습니다. 학급·부서를 하나 골라 소속 인원 전체를 한 번에 추가하는 토글형 섹션으로, 학생 소유자에게는 자기 반 하나만 "우리 반 전체 추가" 버튼으로, 교사 등에게는 자기 학교의 학급·부서 전체를 드롭다운(`<optgroup>`으로 학급/부서 구분)으로 보여줍니다. 역할은 항상 MEMBER 고정이라 특정 인원 역할을 바꾸려면 위 참여 멤버 목록에서 따로 조정해야 합니다.
- `member-candidate-search.tsx`(`member-invite-picker.tsx`와 `components/home/create-board-actions.tsx`의 초대 멤버 선택이 공유하는 검색창)는 전용 `.module.css` 없이 `components/ui`가 정의한 공용 `.select-*` 클래스(`app/globals.css`)만 씁니다 — 박스는 `.select-box`, 검색줄은 `.select-search`, 안내 문구는 `.select-note`, 목록은 `.select-list`, 각 후보 행은 `.select-row[data-static="true"]`(클릭으로 선택되지 않고 "추가" 버튼만 동작) + `.select-row-copy`입니다. `SelectableList` 컴포넌트 자체(`selectionMode` 등)는 쓰지 않습니다 — 후보를 누르면 즉시 `onSelect`가 실행되고(성공 시 `retainAfterSelect`가 아니면 목록에서 사라짐) 유지되는 선택 상태가 없기 때문입니다. 검색줄을 `<label>`이 아니라 `<div className="select-search">`로 감싸는 이유는 이 컴포넌트가 패드 생성 모달의 `.stack-form` 안에서도 쓰이는데 `.stack-form label { flex-direction: column }`이 특이성으로 `.select-search`를 이겨 아이콘·입력칸이 세로로 깨지기 때문입니다(예전엔 전용 module.css로 특이성을 올려 이겼지만, `<label>`을 안 쓰면 그 선택자에 아예 걸리지 않습니다). 검색어가 빈칸이면 마운트 시에도, 지웠을 때도 서버를 부르지 않고 "이름이나 아이디로 검색하면 초대할 수 있는 구성원이 보여요" 안내만 보여줍니다 — 예전에는 마운트마다 빈 검색으로 후보를 미리 불러왔습니다.
