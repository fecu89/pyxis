# 대시보드 본문 컴포넌트

로그인 전용 패드 라우트(`/pad`, `/pad/favorites`, `/pad/archived`, `/profile`, `/pad/folders/[folderId]`)의 본문을 담당합니다. 패드 검색은 `/pad?q=...`에 통합되어 있고, 퀴즈·설문 검색과 같은 공용 `useDebouncedSearch`로 입력이 350ms 멈추면 URL에 자동 반영합니다. 예전 `/search`는 `/pad`로 이동합니다. 공개 홈페이지(`/`)는 `components/landing/`에 있고, 영속 사이드바·상단바는 `components/shell/`이 담당합니다.

| 파일 | 역할 |
|---|---|
| `my-pads-view.tsx` | `/pad` — 공용 보관함 헤더·검색·정렬·참여 권한 탭, 관계별 그리드, 템플릿, 접근 요청. 학생은 참여 패드를 우선 표시 |
| `favorites-view.tsx` | `/pad/favorites` — 정렬과 즐겨찾기 카드 그리드 |
| `folder-view.tsx` | `/pad/folders/[folderId]` — 폴더 이름 변경·삭제와 포함 패드 목록. 삭제 뒤 `/pad`로 이동 |
| `profile-form.tsx` | `/profile` — 데스크톱 2열·모바일 1열 프로필, 학교·반/부서·학생 번호, 고유 닉네임 확인·사진·Credentials 로그인 아이디·비밀번호 변경·내보내기·탈퇴 |
| `password-change-form.tsx` | 프로필의 일반 변경과 `/change-password` 최초 로그인 강제 변경이 공유하는 현재/새 비밀번호 폼 |
| `login-id-change-form.tsx` | 프로필의 "로그인 보안" 섹션에서 현재 비밀번호를 확인한 뒤 로그인 아이디를 바꾸는 폼(`/api/me/login-id`) |
| `pad-grid.tsx` | 목록 화면 공용 compact 카드. 즐겨찾기·폴더·복제·템플릿·보관을 `…` 메뉴로 제공 |
| `pad-reuse-dialog.tsx` | 복제 제목·포함 항목·보안 정책을 확인하고 clone API 호출 |
| `home-shell.tsx` | 상단바 공용 `Brand`와 `/archived`의 `ArchivedBoards`만 제공 |
| `home-actions.tsx` | 공개 랜딩의 로그인 모달 열림 상태. 폼과 Modal은 로그인 버튼을 누를 때 동적 청크로 읽는다. 폼 자체(아이디 로그인·2단계 회원가입·카카오)는 `components/auth/auth-form.tsx`에 있고 `/login` 페이지와 함께 쓴다. 인증 셸의 로그아웃은 로그인 폼을 번들에 넣지 않는 `logout-button.tsx`가 담당한다 |
| `create-board-actions.tsx` | `/pad`에서만 마운트되는 새 패드 모달. 이름·소개·공개 범위와 함께 교과목(퀴즈와 같은 자유 입력+기존 과목 제안 `SubjectCombobox`)·초대 멤버를 선택하며, 둘 다 비워 둘 수 있다 |

## 데이터와 권한

- 패드 목록 페이지는 Server Component에서 `getCurrentUser`와 `getDashboardHomeData`를 호출합니다. 서버가 읽기 권한을 통과시킨 DTO만 본문 컴포넌트에 전달하고, Client Component는 그 목록 안에서 정렬·필터링합니다. 공용 workspace 레이아웃은 이 무거운 조회를 호출하지 않습니다.
- 학생은 참여한 패드가 있으면 `참여한 패드` 탭을 기본 선택합니다. 참여 패드는 `글쓰기 가능`과 `보기 전용`으로 다시 나눌 수 있고, `allowMemberPosting`을 포함한 서버 capability를 기준으로 합니다.
- 최근 방문은 `BoardVisit.lastVisitedAt` 최신순 최대 6개를 사이드바에 표시합니다. `/pad` 섹션에 들어왔을 때 작은 `/api/navigation/sidebar` 응답으로만 읽으며, 활동 알림 구독인 `BoardFollow`나 수동 `BoardFavorite`과 별도입니다.
- 접근 요청은 본인의 `PENDING`·`REJECTED`만 표시하고, 승인된 요청은 멤버십 패드로 이동합니다.
- 폴더 생성·변경·삭제와 포함 여부 변경은 `/api/dashboard`가 사용자 소유 폴더인지와 대상 패드 읽기 권한을 다시 확인합니다. 새 폴더는 사이드바, 패드 포함은 카드의 `…` 메뉴에서 처리합니다.
- 보관은 목록에서 사라지는 작업이므로 카드 메뉴의 마지막 위험색 항목입니다. 보관된 패드는 `/archived`에서 7일 안에 복구하며, 소유자 또는 전체관리자만 영구 삭제할 수 있습니다. 7일이 지난 패드는 주간 정리 작업이 파일과 DB를 영구 삭제합니다.
- 학생을 포함한 활성 사용자에게 새 패드·복제 UI를 서버 분기로 넣고 API가 최신 권한을 다시 검사합니다. 학생은 보관된 패드까지 합쳐 최대 10개를 소유할 수 있고 생성·복제·관리자 소유권 이전이 같은 서버 한도를 공유합니다.
- 새 패드의 교과목은 퀴즈 생성과 같은 자유 입력입니다. 제안 목록은 `/pad` 페이지가 `getDashboardHomeData`와 병렬로 읽은 `getCourseDashboardData` 중 **본인 소유(`editable`) 교과목만** 전달하고, 새 이름이면 생성 API가 요청자 소유 교과목으로 upsert합니다(`subjectName` 전송). 초대 검색은 생성 전용 `/api/boards/member-candidates`를 쓰며, 기존 설정의 후보 검색과 같은 컴포넌트·조직 범위·로그인 식별자 마스킹 규칙을 공유합니다. 생성 API는 이 값을 신뢰하지 않고 초대 대상의 활성 상태·조직 범위를 트랜잭션 안에서 다시 검사합니다.

## compact 카드와 반응형

- `/pad` 본문은 퀴즈·설문과 같은 `PageShell`·`PageHeader` 및 `components/ui/content-library.module.css`의
  도구·상태 칩·그룹 간격을 사용합니다. 카드 표면·그리드·메뉴 열기/닫기는 `components/ui/content-card.tsx`와
  `content-card-menu.tsx`로 퀴즈·설문과 공유합니다. 관계·공개 범위·교과목·폴더와 패드별 메뉴 액션은 이 영역이 소유합니다.
- 배경 이미지가 없는 카드는 장식용 임의 색상 썸네일 없이 제목·소유자·공개 범위·섹션/글 수에 집중합니다. 배경 이미지를 지정한 패드만 상단 88px WebP 커버를 지연 로드합니다.
- 카드 상세 링크는 `prefetch={false}`입니다. 한 화면의 모든 패드가 뷰포트에 잡힐 때 각 `/b/[slug]` RSC와 보드 데이터를 동시에 미리 받지 않고, 사용자가 고른 패드만 요청합니다.
- 데스크톱 최대 4열, 1080px 이하 3열, 720px 이하 2열, 작은 모바일 1열로 줄어듭니다. 새 패드 타일도 같은 높이 규칙을 씁니다.
- 보조 동작은 `…` 메뉴로 묶고 바깥 클릭과 Escape로 닫습니다. `aria-expanded`/`aria-controls`를 제공하며 즐겨찾기 상태는 카드 본문의 작은 별표로도 확인할 수 있습니다.

## 인증과 화면 이동

- 회원가입은 3~20자 영문·숫자 로그인 아이디 확인 단계와 비밀번호 단계로 분리됩니다. 입력 중에는 10자 이상·영문자·숫자·특수문자 충족 여부를 표시하지만, 신뢰 경계인 등록 API가 아이디 형식·중복·예약값·흔한 비밀번호·비밀번호의 아이디 포함 여부까지 다시 검사합니다.
- 프로필 닉네임은 저장 전 명시적으로 중복 확인할 수 있고, 저장 API와 DB 고유 인덱스가 확인 직후 다른 사용자가 같은 이름을 선점하는 경쟁 조건까지 차단합니다.
- 아이디·비밀번호 계정은 프로필에서 현재 비밀번호를 확인한 뒤 회원가입과 같은 강도의 새 비밀번호로 바꿀 수 있습니다. 관리자가 일괄 생성·초기화한 계정은 첫 로그인에 `/change-password`만 열리며, 변경 성공 뒤 기존 JWT가 모두 무효화되어 새 비밀번호로 다시 로그인합니다.
- 같은 섹션에서 로그인 아이디도 바꿀 수 있습니다(`/api/me/login-id`). 역시 현재 비밀번호를 다시 확인하고, 새 아이디는 회원가입과 같은 형식·예약어·중복 검사를 통과해야 하며, 성공 뒤 재로그인이 필요합니다.
- 공개 루트가 인증 오류와 `/?login=1&callbackUrl=...`를 처리합니다. `safeInternalCallbackUrl`이 외부 URL과 프로토콜 상대 URL을 거부한 뒤 `HomeAuthActionsProvider`에 목적지를 전달합니다.
- `/dashboard`와 이 라우트 그룹의 다른 페이지는 비로그인 사용자를 공개 루트 로그인 모달로 보내고, 성공하면 요청했던 내부 경로로 복귀합니다.
- 로그아웃·계정 탈퇴 뒤에는 공개 루트(`/`)로, 폴더 삭제·패드 보관·관리자 화면 복귀는 작업공간(`/dashboard`)으로 이동합니다.
- 프로필 링크는 인증 셸의 `SidebarAccountDock`이 직접 그립니다. `ProfileForm` 저장 뒤 `router.refresh()`가 공유 layout의 아바타와 사용자 요약도 다시 조회합니다.

과거 비로그인 최소 게이트였던 `HomeAccessGate`와 `app/(dashboard)/page.tsx`는 공개 랜딩과 `/dashboard` 분리 과정에서 제거했습니다. 대시보드 상단바·사이드바가 라우트 이동 때 재마운트되지 않는 구조는 `components/shell/overview.md`를 참고합니다.
