# pyxis 구조와 상호작용

마지막 확인일: 2026-08-25

이 문서는 코드 전문 대신 화면, 컴포넌트, API, 서버 도메인 모듈, 저장소가 어떻게 이어지는지 보여주는 탐색 지도다. 폴더별 세부 정책은 각 폴더의 `overview.md`를 참고한다.

## 1. 전체 요청 흐름

```text
브라우저
├─ 공개 루트 `/`
│  └─ 세션·DB 조회 없이 랜딩 UI + OAuth 쿼리 처리
├─ 인증 화면 최초 진입 / 새로고침
│  └─ app/**/page.tsx (Server Component)
│     ├─ getCurrentUser()
│     ├─ lib/*/queries.ts에서 직접 조회
│     └─ 직렬화한 초기 DTO → Client Component
├─ 클릭·폼·드래그·업로드
│  └─ components/** (Client Component)
│     └─ fetch / XHR → app/api/**/route.ts
└─ 실시간 변경
   ├─ EventSource → 보드 SSE / 개인 알림 SSE
   └─ Socket.IO → LIVE 퀴즈 문항·답안·순위 양방향 이벤트

Route Handler
├─ 최신 세션·역할·보드 접근 재검사
├─ Zod 입력 검증 + same-origin 검사
├─ lib/** 도메인 로직
├─ Prisma → PostgreSQL
├─ 로컬 파일 → UPLOAD_DIR
└─ 활동·알림 저장 → 프로세스 내부 SSE 이벤트 발행
```

현재 구조의 핵심 원칙은 다음과 같다.

- 최초 화면 읽기는 내부 API를 다시 호출하지 않고 Server Component가 서버 쿼리 계층을 직접 사용한다.
- 사용자 상호작용과 지연 조회는 Client Component가 REST형 Route Handler를 호출한다. 현재 Server Action은 사용하지 않는다.
- `server.ts`가 진입점이다. Next.js 요청 핸들러와 Socket.IO를 한 `http.Server`에 얹는다. 퀴즈의 실시간 진행(문항 시작·답안 제출·리더보드)이 SSE로는 부족한 양방향 통신이라 커스텀 서버가 필요하고, 패드의 알림·보드 활동은 계속 SSE(`app/api/**/events`)를 쓰며 이 서버 위에서도 그대로 흐른다. `yarn dev`는 실제 서버 프로세스를 직접 실행한다. `tsx watch` 아래에 서버를 자식으로 두면 자식이 OOM으로 죽어도 watcher가 남아 PM2가 장애를 감지하지 못하고, PM2 재시작 때 watcher가 고아 프로세스로 쌓이므로 사용하지 않는다. 애플리케이션 Route와 컴포넌트의 HMR은 Next 개발 서버가 담당하며, `server.ts` 자체를 고쳤을 때만 PM2를 재시작한다. 현재 Next 16 커스텀 서버에서 Turbopack이 `Next.js package not found` panic을 내므로 개발 모드만 명시적으로 Webpack을 사용하고, 운영 빌드는 기본 번들러를 사용한다. 번들러를 바꿀 때는 실행 중인 서버를 멈춘 뒤 기존 `.next` 캐시를 지우고 다시 시작한다.
  - `lib/load-env.ts`가 **첫 임포트**여야 한다. Next가 `.env*`를 로드하기 전에 다른 모듈이 평가되면 쿠키 이름 같은 상수가 빈 env로 굳어, 웹은 멀쩡한데 소켓만 UNAUTHORIZED로 떨어진다.
  - Next 핸들러를 먼저 등록한 뒤 Socket.IO를 붙인다. engine.io의 `attach()`가 그 시점의 `request` 리스너를 캐시해 자기 경로가 아닌 요청을 되돌려 주기 때문이다.
  - `destroyUpgrade: false`가 필요하다. engine.io는 자기 경로가 아닌 upgrade 요청을 1초 뒤 끊는데, 개발 서버의 HMR 소켓(`/_next/webpack-hmr`)이 그 안에 101을 못 쓰면 Fast Refresh가 조용히 죽는다. upgrade 핸들러는 `getRequestHandler()`가 첫 요청 때 자동 등록하므로 직접 배선하면 리스너가 두 개가 된다.
  - 개발(`.next`)과 운영 산출물을 분리한다. 직접 `build/start`의 기본값은 `.next-prod`이고 `NEXT_DIST_DIR`을 존중한다. 운영 배포는 `yarn deploy`로 `.next-a`/`.next-b`를 교대한다. 실제 PM2 하위 `server.ts`의 환경으로 활성 빌드를 확인하고, 잠금 → 비활성 폴더 빌드 → PM2 재시작 → 새 빌드 manifest·홈페이지 확인 순으로 진행한다. 빌드 실패는 운영에 영향을 주지 않고 전환 실패는 이전 빌드로 복귀한다. 빌드 중 생성 타입 include는 해당 distDir로 한정하고 종료 시 `tsconfig.json`·`next-env.d.ts`를 복구한다. Blog와 같은 단일 프로세스 전환이라 재시작 순간의 짧은 재접속은 남는다.
  - **서버가 재시작되면 열려 있던 탭은 옛 클라이언트 번들을 그대로 들고 있다. 새로고침(하드 리로드)이 필요하다.** `tsx watch`는 파일이 바뀌면 Node 프로세스를 통째로 다시 띄우는데, 그때 브라우저의 HMR 소켓이 조용히 끊긴다. 탭은 이미 받아 둔 청크로 계속 렌더링하고 서버만 새 코드를 쓰므로, **양쪽이 같은 파일의 서로 다른 버전을 보게 된다.** `lib/routes.ts`처럼 서버·클라이언트가 함께 import하는 모듈을 고치면 증상이 특히 헷갈린다 — 서버는 `/courses`+BookOpen을 그리는데 클라이언트는 `/quiz`+ListChecks를 그려 hydration 불일치가 나고, `href("courseDetail")`이 "알 수 없는 라우트"로 죽는다(실제로 겪었다). **코드는 멀쩡한데 탭만 낡은 것**이므로 원인을 코드에서 찾으면 시간을 버린다. 의심되면 `.next/dev/static/chunks/**`에 새 식별자가 들어 있는지 grep해서 빌드와 탭 중 어느 쪽이 낡았는지부터 가른다.
  - **`node_modules`를 통째로 바꿨으면(패키지 관리자 교체, `yarn install` 재실행 등) dev를 멈추고 `.next`를 지운 뒤 다시 띄운다.** 웹팩 모듈 ID가 재설치로 바뀌는데 `.next`의 클라이언트 참조 매니페스트는 옛 ID를 들고 있어서, 서버는 200을 그대로 돌려주는데 브라우저만 `Element type is invalid. Received a promise that resolves to: undefined`로 죽는다. 이 오류는 실제로 `<ThemeSync />` 같은 멀쩡한 클라이언트 컴포넌트를 지목하므로 코드를 아무리 봐도 원인이 안 보인다 — production 빌드가 통과하는데 dev만 깨지면 캐시를 먼저 의심한다.
- `proxy.ts`는 판정을 다음 순서로 한다. ① 세션 쿠키가 없는 `/api/public/*`은 토큰 조회 전에 통과시킨다(요청마다 JWE 복호화 한 번을 아낀다). ② JWT를 한 번만 읽는다. ③ 쓰기 API 요청량 백스톱. ④ `play` 구역(`/b`·`/f`·`/go`·`/i`·`/j`·`/p`·`/s`)의 비로그인 요청은 통과시킨다. 승인 대기·반려 계정은 공개 `marketing`·`play` 요청과 그 화면에서 시작한 API 요청에 내부 헤더를 붙여 서버 인증 조회에서 게스트로 낮춘다. 따라서 공개 참여 기능은 그대로 동작하지만 비공개 멤버십과 회원 전용 API 권한은 얻지 못한다. 라우트 그룹 이름은 URL에서 지워지므로 `lib/routes.ts`의 접두사·매니페스트로 구역을 판정한다. ⑤ 이후 게이트.
- `proxy.ts`는 신규 사용자의 `ACCOUNT_PENDING | ACCOUNT_REJECTED | PROFILE | TEACHER_PENDING | COMPLETE` 상태와 임시 비밀번호 상태를 라우팅한다. 공개 루트 `/`는 온보딩 상태와 무관하게 볼 수 있지만, 계정·교사 승인 중 또는 계정 반려 상태에는 `/approval-pending`, 프로필 설정 중에는 `/onboarding`으로 보낸다. `mustChangePassword` 계정은 `/change-password`와 비밀번호 변경·인증 API만 허용한다. 나머지 API는 428로 막고, 보드 권한은 JWT로 확정하지 않으며 페이지와 모든 API가 DB의 최신 사용자·멤버십·정책을 다시 확인한다.
- Client Component가 받은 capability는 UI 노출용이다. 실제 보안 경계는 Route Handler와 서버 권한 함수다.

## 2. 페이지 진입점

| URL | Server Component와 조회 | 최종 화면·분기 |
|---|---|---|
| `/` | `app/(marketing)/page.tsx`; 로그인 상태면 `callbackUrl`·대시보드로 넘김 | `LandingPage`(서비스 소개·CSS 패드 예시·학생/교사 흐름·로그인 CTA). 로그인·회원가입 모달은 `/login`과 같은 `AuthForm`을 쓰되 버튼을 누를 때 동적 청크로 읽는다 |
| `/guide` | 없음 | 활용법. 패드 → 참여 → 피드백 → 퀴즈 → 리포트 → 관리 여섯 단계 |
| `/login` | `getCurrentUser`; 로그인 상태면 `callbackUrl`로 | `AuthForm`(아이디 로그인·2단계 회원가입·카카오). 로그인이 필요한 화면은 전부 `loginRedirectPath`를 거쳐 여기로 온다 |
| `/dashboard` | `app/(workspace)/dashboard/page.tsx` → 퀴즈·패드 개수, `getActivityPage`, `getRecentContentVisits`, `getCourseDashboardData` 병렬 조회 | **퀴즈·패드 통합 현황.** 최근 방문은 `BoardVisit`·`QuizVisit`·`FormVisit.lastVisitedAt`을 합친 최신순이며 생성·수정 시각은 사용하지 않는다. 교과목은 요약 카드와 `/courses` 바로가기만 남는다 — 구성은 아래 교과목 구역이 맡는다 |
| `/courses` | `app/(workspace)/courses/page.tsx` → `getCourseDashboardData` | `CourseList`(교과목 카드 그리드 + 생성). 개수만 세고 명단·목록은 싣지 않는다 |
| `/courses/[subjectId]` | `getCourseSummary`; 소유자가 아니면 `rosterMemberWhere`로 명단 소속을 확인 | `CourseDetail`(학생·퀴즈·패드 탭). 각 탭이 검색·페이지 단위로 따로 읽는다 |
| `/pad` | `app/(workspace)/pad/page.tsx` → `getDashboardHomeData` + 생성용 편집 가능 교과목을 병렬 조회 | `MyPadsView`(관계 탭·카드 그리드·템플릿·접근 요청). 패드 생성 Provider도 이 라우트에서만 로드 |
| `/onboarding` | 가입 승인된 `getCurrentUser` + 학교/학년/반·부서 목록 + 기존 교사 신청 조회 | 프로필 → 학생은 학교·학년·반·번호, 교사는 학교·부서 → 확인. 학생은 즉시 완료, 교사는 두 번째 승인 신청 |
| `/approval-pending` | 현재 사용자의 계정 가입 승인 상태와 필요 시 `TeacherApprovalRequest` 조회 | 자가 가입·최초 카카오 계정의 전체관리자 승인 또는 교사 역할 승인을 한 화면에서 안내. 세션을 15초마다 갱신해 승인 시 온보딩·원래 경로, 반려 시 재신청 흐름으로 이동 |
| `/pad/favorites` | `app/(workspace)/pad/favorites/page.tsx` → 같은 조회 | `FavoritesView`(정렬 + 즐겨찾기 카드 그리드만); 비로그인은 `/login?callbackUrl=%2Fpad%2Ffavorites`로 리다이렉트 |
| `/pad?q=...` | 검색 중에는 접근 가능한 패드 전체 조회 | `MyPadsView`의 제목·소유자 검색과 결과 그룹; 예전 `/search`는 `/pad`로 리다이렉트 |
| `/pad/folders/[folderId]` | `app/(workspace)/pad/folders/[folderId]/page.tsx` → 같은 조회 | `FolderView`(폴더 이름·이름변경·삭제 + 그 폴더의 그리드); 사용자 소유 폴더가 아니면 404 |
| `/profile` | `app/(workspace)/profile/page.tsx` → `getCurrentUser`만 | `ProfileForm`(닉네임·사진·소속·학생 번호·Credentials 비밀번호 변경·데이터 내보내기·탈퇴). 모달이 아니라 페이지 본문; 비로그인은 `/login?callbackUrl=%2Fprofile`로 리다이렉트 |
| `/change-password` | `getCurrentUser`; `mustChangePassword`와 Credentials 보유 여부 검사 | 명단 발급·관리자 초기화 계정의 최초 로그인 전용 변경 폼. 완료 계정은 `/dashboard`로 보냄 |
| `/admin/*` | `app/admin/layout.tsx`는 인증·공통 셸, `users`·`audit`·`settings` 등 각 하위 `page.tsx`가 자기 데이터만 조회 | 정식 하위 라우트별 관리 화면. 일반 교사는 자기 학교 구조를 읽고 학생 번호만 수정하며, 대표교사는 자기 학교 소속 구조·계정 발급을 관리. 예전 `/admin?tab=`은 새 경로로 리다이렉트 |
| `/quiz`, `/quiz/favorites`, `/quiz/assigned`, `/quiz/unassigned`, `/quiz/drafts` | `app/(workspace)/quiz/(library)/*` → 내 보관함용 `getQuizLibraryPage` | 고정 보기는 정식 하위 경로, 검색·과목·상태·정렬·페이지 번호만 쿼리. `(library)` layout을 공유하며 즐겨찾기·복제·공유·할당·세션 생성을 제공 |
| `/quiz/discover` | 공개·검색 가능 퀴즈 목록과 총합만 조회 | 다른 교사의 퀴즈 탐색·복제. 내 보관함 집계는 조회하지 않으며 예전 `/quiz?tab=discover`는 여기로 이동 |
| `/quiz/new` | 로그인 사용자 | 제목·설명·교과목·참여 방식 생성. 소유 한도는 `SystemSetting`이 정합니다 |
| `/quiz/[quizId]` | 공유받은 사용자 | 문항 읽기 전용 보기와 개인 초안 복제 |
| `/quiz/activities` | 교사·관리자 | 진행한 세션 목록과 리포트 진입. 누적 이력은 `?page=`로 30개씩 조회한다 |
| `/quiz/assignments` | 학생 | 할당받은 ASYNC 퀴즈 풀이·이어 풀기. 누적 과제는 `?page=`로 30개씩 조회한다. 사이드바에는 매니페스트의 `roles: ["STUDENT"]`로 학생에게만 뜬다 — 제한을 안 걸면 교사·관리자 메뉴에도 나오는데 페이지는 학생만 받아 "눌러도 안 열린다"가 된다. 주소로 직접 온 비학생에게는 리다이렉트가 아니라 왜 못 보는지와 `진행·기록`으로 가는 길을 보여 준다 |
| `/forms`, `/forms/open`, `/forms/drafts`, `/forms/closed` | 교사·관리자 | 상태별 정식 경로가 `(library)` layout의 헤더를 공유하고 설문을 20개씩 서버에서 조회. `?page=`만 페이지네이션 상태로 유지 |
| `/forms/[formId]` | 설문 접근 권한 | 개요·응답 링크·설정 요약. OWNER에게는 공유(`FormShare`) 다이얼로그 진입점도 뜬다 |
| `/forms/[formId]/edit` | 편집 권한 | 구글 설문지식 전체화면 편집기. 13가지 질문 유형과 서명 필드 |
| `/forms/[formId]/responses` | 설문 접근 권한(VIEWER 공유도 가능) | 응답 요약·질문별·개별 3탭 + XLSX 내보내기. 요약·목록 첫 페이지는 서버에서 미리 채우고, 개별 응답 상세와 다음 페이지는 클라이언트가 필요할 때만 불러온다 |
| `/s/[slug]` | `formClosedReason()`으로 응답 가능 여부 판정, `requiresLogin`이면 로그인 게이트 | 공개 응답 화면. 익명·로그인 응답, 서명 필드, 정원·마감 안내를 한 화면이 담당한다 |
| `/s/[slug]/done` | 없음(서버 컴포넌트가 `form.title`·`confirmationMessage`만 직접 조회) | 제출 완료 안내 |
| `/go/[slug]` | 전역 `ShortLink.slug`와 활성 연결 대상의 삭제·마감 상태 조회 | 경량 Route Handler가 패드 `/b/{slug}`, 퀴즈 참여 `/j/{pin}`, 설문 `/s/{slug}` 중 원래 공개 경로로 307 리다이렉트. 별칭 자체는 접근 권한을 부여하지 않으며 없거나 끝난 대상은 작은 text 404 |
| `/report`, `/report/quizzes`, `/report/pads`, `/report/forms` | 로그인 사용자 | 종류별 정식 경로가 `(activity)` layout의 헤더를 공유하고 `Activity` 한 테이블만 읽습니다. 예전 `?type=`은 새 경로로 이동 |
| `/report/students` | 리포트 범위 | 학생 목록. 고르면 그 학생의 퀴즈·패드 기록으로. 계정을 다루는 화면은 `/admin`이고 여기는 읽기 전용이라, 계정 발급 권한(`canManageStudent`)이 아니라 리포트 범위(`canViewStudentReport` — 같은 학교 교사면 가능)로 판정한다 |
| `/report/students/[studentId]` | 리포트 범위 | 한 학생의 퀴즈 응시 기록 |
| `/report/writeup` | 교사·관리자 | 활동 기록으로 생활기록부 문안을 만드는 화면. 문안 생성 자체는 아직 구현 전이다. 예전에는 `/recode`라는 별도 상단 섹션이었는데, 재료가 전부 리포트의 `Activity`라 사이드바 한 줄로 내렸다 — 상단 섹션 판정이 URL 접두사 기반이라 경로도 함께 옮겨야 했다 |
| `/b/[slug]` | `getBoardPageData`가 로그인·읽기·비밀번호·게시물 공개 상태와 capability 계산, 섹션별 첫 게시물 30개만 직렬화 | `PadCanvas`, cursor 더 보기, `PadAccessGate`, `PadPasswordGate`, 로그인 리다이렉트 또는 404 |
| `/b/[slug]/posts/[postId]` | `getBoardPageData(..., { focusPostId })`로 같은 보드 접근 정책과 해당 게시물만 조회 | `PostDetailPage`; 데스크톱 본문·댓글 2단, 모바일 1단. 수정·삭제 메뉴는 게시물 제목 오른쪽에 있고 수정 시 게시물 영역 자체가 인라인 `PostComposer`로 전환됨 |
| `/b/[slug]/print` | 보드 페이지와 같은 접근 검사 | `PadPrintView`; 읽을 수 있는 게시물의 인쇄·PDF·PNG 흐름 |
| `/b/[slug]/present` | 같은 접근 검사 후 `gatherBoardExportData(..., "PUBLISHED")`로 전체 게시 글 조회 | `PadPresentation` |
| `/b/[slug]/copy` | `getCopyLinkData`가 로그인·생성 역할·원본 접근·비밀번호 검사 | `PadReuseDialog` 또는 권한 획득 안내 |
| `/i/[token]` | 토큰 해시로 유효성·만료·사용 횟수만 읽기 검사 | `JoinBoardButton`; 참여는 별도 POST에서만 실행 |

루트 `app/layout.tsx`는 Pretendard 글꼴, 전역 CSS와 `pyxis-theme` 쿠키 기반 테마 속성만 담당한다. 사용자·보드 데이터는 이 루트 레이아웃에서 읽지 않는다.

`app/`은 셸을 기준으로 라우트 그룹 넷으로 나뉜다. 그룹 이름은 URL에서 지워지므로 이 구분은 주소를 바꾸지 않고 "어떤 껍데기를 두르는가"만 정한다.

| 그룹 | 셸 | 들어 있는 라우트 |
|---|---|---|
| `(marketing)` | 없음 | `/` 공개 랜딩, `/guide` 활용법 |
| `(auth)` | 없음 | `/login`, `/onboarding`, `/approval-pending`, `/change-password` — 로그인과 가입 완료 전 게이트 화면 |
| `(workspace)` | 상단 navbar + 사이드바 셸 | `/dashboard`, `/courses/**`, `/pad/**`, `/quiz/**`, `/forms/**`, `/report/**`, `/search`, `/profile` |
| `(focus)` | `.zone-frame`(전체 높이 flex 컬럼)만 | `/quiz/[quizId]/edit`, `/quiz/host/[sessionId]`, `/forms/[formId]/edit` — 사이드바 없는 전체화면 작업 화면 |
| `(play)` | `.zone-frame`(전체 높이 flex 컬럼)만 | `/b/[slug]`와 하위(`copy`·`present`·`print`), `/f/[attachmentId]`, `/go/[slug]`, `/i/[token]`, `/j`·`/j/[pin]`, `/p/[sessionId]`·`/p/[sessionId]/report`, `/s/[slug]`·`/s/[slug]/done` — 로그인 없이도 열리는 참여·공유 진입점. 짧은 세그먼트인 이유는 손으로 치거나 QR·프로젝터로 보는 주소이고, 프록시의 인증 건너뛰기 판정이 접두사 개수 비교로 끝나기 때문이다 |

로그인은 `/login` **페이지**다. `lib/auth/page-guard.ts`의 `loginRedirectPath`가 정본이고, 로그인이 필요한 화면은 전부 이걸 거친다 — 예전에는 홈의 `?login=1` 모달로 보냈는데 그러면 로그인 주소를 북마크하거나 링크로 보낼 수 없고 마케팅 페이지를 한 번 거쳐야 했다. 폼 자체는 `components/auth/auth-form.tsx` 하나이고 `/login` 페이지와 공개 홈의 모달이 함께 쓴다.

`/admin`은 라우트 그룹 밖이라 위에 아무것도 await하지 않는 루트 레이아웃뿐이다. 인증 게이트를 page.tsx에만 두면 React가 셸을 먼저 흘려보낸 뒤 redirect가 도착해 **비로그인 요청이 200으로 응답한다**(리다이렉트는 RSC 페이로드로만 실린다). 그래서 `app/admin/layout.tsx`가 응답 커밋 전에 사용자 조회를 먼저 한다. 역할 판정은 page.tsx가 계속 맡는다 — 권한 없는 로그인 사용자에게는 리다이렉트가 아니라 안내 화면을 보여 줘야 하기 때문이다.

`/admin`은 아직 어느 그룹에도 넣지 않았다. 자체 "관리 메뉴"를 그리므로 `(workspace)`에 넣으면 사이드바가 겹친다. 관리 콘솔을 독립 라우트로 나눌 때 함께 정리한다.

`(play)`와 `(focus)`의 `layout.tsx`는 셸을 그리지 않고 `.zone-frame`(`display:flex; flex-direction:column; min-height:100dvh`) 하나만 세운다. 이 구역 화면들은 quiz에서 이식하면서 `<main className="flex-1">`으로 남는 높이를 다 먹겠다고 선언했는데, 레이아웃이 없으면 그 부모가 곧 `body`이고 `body`는 `min-height:100dvh`만 있을 뿐 `display:block`이라 플렉스 컨테이너가 아니다 — `flex-1`이 아무 일도 하지 않아 1280×900에서 `/j`의 main이 688px, 호스트 콘솔이 400~747px에 그치고 아래에 배경 띠가 남았다. `body`를 통째로 flex로 바꾸면 `(workspace)`·`(auth)`·`(marketing)`까지 딸려 가므로 구역에만 건다. `.app-frame`과 선언은 같지만 클래스를 나눈 이유는 `.app-frame`에 `.home-nav`/`.app-shell` 자식 규칙이 붙어 있어서다.

하위 `layout.tsx`로는 부모가 그린 셸을 지울 수 없다. 그래서 편집기·발표처럼 전체화면이어야 하는 화면은 그룹을 따로 두는 것이 Next.js에서 셸을 벗는 유일한 방법이다.

`app/(workspace)/layout.tsx`(라우트 그룹이라 URL에는 안 나타남)는 위 표의 workspace 라우트가 공유하는 셸이다. 로그인 사용자에게만 `DashboardChrome`(좌측 사이드바·상단바·개수 Provider)을 그리고, Next.js가 라우트 이동 시 바뀐 `page.tsx`만 갱신하므로 라우트를 오가도 사이드바와 알림 SSE가 다시 마운트되지 않는다. 레이아웃의 DB 읽기는 현재 사용자와 읽지 않은 알림 개수뿐이다. 패드 홈·교과목·템플릿·접근 요청을 공용 레이아웃에서 읽지 않으며, 대시보드의 교과목 바로가기, 패드의 폴더·최근 방문, 퀴즈·설문의 최근 업데이트는 해당 섹션 진입 때 `/api/navigation/sidebar?section=...`가 지연 조회한다. 퀴즈·설문의 상태 필터는 사이드바와 중복하지 않고 본문에만 둔다. 상단 nav의 교과목 탭은 없고 `/courses/*`는 대시보드 영역으로 활성 판정된다. 알림 상세도 벨을 처음 열 때만 읽는다. 상주 내비게이션과 반복 콘텐츠 카드의 Next 자동 prefetch는 꺼서 보이는 모든 제품·상세 라우트가 초기 접속과 동시에 요청되지 않게 한다. 960px 미만에서는 같은 사이드바가 버튼으로 여닫는 드로어가 된다. 공개 루트와 `/b/[slug]`는 이 그룹 밖이며, 패드는 `AppShell showSidebar={false}`라 데스크톱 사이드바와 모바일 드로어 버튼을 모두 렌더링하지 않는다.

## 3. 주요 컴포넌트 계층

### 홈과 관리자

| 컴포넌트 | 책임 | 연결되는 API |
|---|---|---|
| `LandingPage`(`components/landing/`) | 공개 소개·반응형 패드 예시·일반/카카오 로그인 CTA | `/api/auth/*` |
| `DashboardChrome`(`components/shell/`) | layout에 상주하는 셸: 사이드바 + 상단바 + Provider | 직접 호출 없음 |
| `CourseList`/`CourseDetail`(`components/courses/`) | 교과목 목록·생성과 학생·퀴즈·패드 탭. 상세는 개수만 서버에서 받고 실제 목록은 탭이 페이지 단위로 읽는다 | `/api/subjects`, `/api/subjects/[subjectId]` |
| `RosterPanel`(`components/courses/`) | 학급 연결·해제·"명단만 복사", 명단 50명씩 페이지. 학급 연결·학생 추가는 공용 `SelectableList`/`PagedSelectableList`로 행 클릭 선택하며, 학생 후보는 학급을 고르거나 검색어를 입력해야 지연 로드된다 | `/api/subjects/[subjectId]/roster`, `/candidates` |
| `ResourcePanel`(`components/courses/`) | 퀴즈·패드 연결. 화면 전체가 아니라 **바뀐 것만** 델타로 저장 | `/api/subjects/[subjectId]/resources`, `/candidates` |
| `SelectableList`/`PagedSelectableList`(`components/ui/`) | 행 클릭으로 고르는 공용 선택 목록(체크박스 없이 행 클릭, shift 범위 선택, 전체선택/전체해제 툴바). `PagedSelectableList`는 검색+페이지네이션이 붙고 선택 상태를 목록과 분리해 들고 있어 페이지를 넘겨도 유지된다. `deferLoad`+`ready`로 선행 조건 전에는 읽지 않고 검색·페이지·필터 변경/언마운트 시 진행 중인 loader의 `AbortSignal`을 취소한다 | 부모가 넘긴 loader |
| `PageNumberNavigation`(`components/ui/`) | 리포트·퀴즈 기록·학생 과제가 공유하는 서버 이전/다음 페이지. query를 보존하고 파생 라우트 prefetch는 끈다 | 직접 호출 없음 |
| `CourseSelect`(`components/courses/`) | 퀴즈·패드 목록 카드에서 그 항목의 교과목을 바로 지정 | `/api/subjects/assign` |
| `ArchivedBoards` | 보관된 패드 복구·영구삭제 | 보드 복구, 관리자 보드 영구 삭제 |
| `home-actions.tsx` / `home-auth-dialog.tsx` / `logout-button.tsx` | 공개 화면에서 클릭할 때만 읽는 로그인·회원가입 모달 / 인증 셸의 로그인 폼을 싣지 않는 작은 로그아웃 버튼 | `/api/auth/register/check-login-id`, `/api/auth/register`, `/api/auth/*` |
| `PadGrid` | 목록 화면 공용 카드 그리드와 카드 액션 | favorite, template, `/api/dashboard` |
| `MyPadsView`/`FavoritesView`/`FolderView` | `/pad`·`/pad/favorites`·`/pad/folders/[id]` 각 화면 구성 | 위 `PadGrid`를 통해서만 |
| `ProfileForm` / `PasswordChangeForm` | `/profile` 고유 닉네임·사진·비밀번호·데이터 관리와 최초 로그인 강제 비밀번호 변경 | `/api/me/nickname-availability`, `/api/me`, `/api/me/password`, `/api/me/avatar`, `/api/me/export` |
| `PadReuseDialog` | 복제 제목·포함 항목 선택과 자동 복제 링크 | 보드 clone API |
| `NotificationBell` | 알림 목록·읽음 처리·실시간 새 알림 | notifications API와 개인 SSE |
| `OnboardingExperience` / `ApprovalPendingExperience` | 가입 승인 뒤 학생 학교·학년·반·번호 확정, 교사 승인 신청과 계정/교사 승인 상태 자동 확인 | onboarding API, NextAuth 세션 갱신 |
| `AdminShell` + 하위 페이지 패널 | 공통 관리자 사이드바는 layout에, 사용자·소속·승인·감사 상태는 각 라우트 청크에 둔다. 사용자 목록의 일괄 선택 툴바는 `SelectableList`와 같은 공용 `.select-toolbar`를 쓴다 | admin users, schools/groups/members, students/import/move, teacher-approvals, audit-logs |
| `SchoolDashboard` / `SchoolManager` | 학교별 학생·교사·학급 지표와 번호/학급 미지정 점검, 학교 메타데이터, 학급·부서·대표교사 관리 | schools PATCH, groups PATCH, user representative PATCH, students move |
| `StudentRosterImport` | XLSX 양식·미리보기·충돌 확인·초기 계정 발급·일회성 CSV 다운로드 | `/api/admin/students/import` |
| `RegistrationApprovalQueue` / `TeacherApprovalQueue` | 전체 로그인 식별자·학교·부서 확인, 체크박스 없는 행 선택·Shift 범위 선택·현재 페이지 전체선택과 선택 일괄 승인. 개별 승인/반려도 확인 모달만 거치며 감사 사유는 화면 입력 없이 자동 생성 | admin account-approvals, teacher-approvals |
| `UserEditor` | 역할·상태·시스템 권한·세션·PII 조회 | admin user 하위 API |
| `AppShell`/`AppSidebar`(`components/shell/`) | 데스크탑 고정 사이드바와 모바일·태블릿 드로어. 모든 메뉴가 정식 경로라 활성 항목은 `usePathname()`만으로 계산하며, 매니페스트의 `nav.parent`가 있는 항목은 들여쓴 하위 항목으로 그림 | 사이드바의 폴더 생성만 `/api/dashboard` POST |
| `NavCountsProvider`(`components/shell/nav-counts.tsx`) | 하위 항목 개수 배지를 화면 → 셸로 올리는 컨텍스트. 셸이 직접 조회하지 않는 이유는 `components/shell/overview.md` | 직접 호출 없음 |

### 보드 화면

```text
PadCanvas
├─ 상단 공통: NotificationBell, ThemeToggle, PadMoreMenu
├─ 패널: Share(원주소·QR·ShortLinkManager), Activity, ModerationQueue, Export, Trash
├─ 설정: PadSettingsTabs
│  ├─ Appearance / PostFieldDesigner / AttachmentPolicy
│  ├─ Sharing(공개 범위·비밀번호 조회/해제) / AccessRequests / InviteLinks
│  └─ Members
├─ SECTIONS 레이아웃: SectionColumn
│  ├─ PostComposer → MarkdownEditor / AttachmentUploadQueue
│  └─ PostCard → PostDetail → PostBody / MarkdownCodeBlock
└─ WALL/GRID/STREAM/TIMELINE/TABLE
   └─ PadLayoutRenderer → 레이아웃별 컴포넌트 → PostCard/PostDetail
```

| 컴포넌트 | 주 역할 | 연결되는 API |
|---|---|---|
| `PadCanvas` / `SectionsBoardView` | 보드 로컬 상태, 설정·멤버·섹션, 받은 페이지 로컬 검색, SSE 병합과 전 화면 공용 검색·글 추가 플로팅 액션. SECTIONS DnD는 포인터 가장자리 RAF 자동 스크롤과 `sectionBoardCollisionDetection`을 사용해 중첩된 가로 캔버스·세로 목록을 구분 | board PATCH/DELETE/follow, sections, members, section/post reorder |
| `SectionColumn` | 섹션 편집·삭제, 데스크톱 섹션별 글 추가, 게시물 30개 단위 더 보기. 숫자 인덱스 없는 한 줄 헤더 | section PATCH/DELETE, section posts |
| `LazyPostComposer` → `PostComposer` → `MarkdownEditor` | 보드의 새 글은 작성 모달, 단독 게시물 수정은 게시물 영역 전체를 바꾸는 인라인 표시. 로컬 임시저장, 글 생성·수정, 사용자 필드, 파일·링크 업로드 큐를 공유함. Milkdown CommonMark 입력 규칙은 Markdown을 즉시 시각화하되 값은 문자열로 유지하고, 파일 선택·촬영·드롭·이미지 붙여넣기 때 첨부 전용 상대 경로 블록을 현재 커서에 자동 삽입해 여러 첨부를 문단 사이에 배치함. 텍스트/HTML이 함께 있는 클립보드의 보조 이미지 파일은 첨부하지 않음 | section posts, post PATCH, post attachments/links |
| `PostCard` / `SortablePostCard` | 카드는 평문 요약 대신 상세와 같은 Markdown 제목 계층과 본문 배치 첨부·빠른 반응을 표시. 코드 블록만 첫 줄·카드 폭 말줄임으로 축약하고 내부 스크롤은 제외하되 작은 아이콘으로 원본 코드 전체 복사를 제공함. 수동 정렬 레이아웃에서만 별도 래퍼가 `@dnd-kit/useSortable`을 주입 | post reactions, 선택적으로 DnD context |
| `PostCard` / `PostDetail` / `PostBody` | 카드와 상세의 동일한 Markdown 계층, 본문 사이 첨부, 댓글·반응 편집, 첨부 순서·메타데이터. 전용 블록이 없는 과거 첨부는 상세 본문 위에 두고 빈 본문은 대체 문구 없이 생략하며, 정화한 Markdown 코드 블록에는 내부 가로 스크롤·언어 표시·복사 버튼을 제공 | post/comment/reaction/attachment API |
| `PadSettingsTabs` | 외형, 필드, 참여, 승인·동결, 접근·초대, 멤버 UI를 묶음 | 저장 자체는 `PadCanvas`; 하위 요청·초대 컴포넌트는 각 API 호출 |
| `PadSharePanel` / `ShortLinkManager` | 상단 공유창의 원주소 복사·QR과 관리 권한이 있는 사용자의 짧은 별칭 생성·변경·복사·삭제. 같은 관리기는 퀴즈 로비와 설문 공유창도 사용 | 클라이언트 QR 생성, `/api/short-links` |
| `PadSharingSettings` | 발견 범위와 공유 비밀번호 관리. 빈 비밀번호 저장은 유지, 해제는 독립 명령이며 소유자만 암호화된 현재 값을 다시 조회 가능 | board PATCH, board password GET |
| `PadAccessGate` / `PadAccessRequests` | 비멤버 요청 생성, 관리자 승인·거절 | access-requests GET/POST/PATCH |
| `PadInviteLinks` / `JoinBoardButton` | 초대 링크 생성·폐기와 명시적 참여 | invite-links, invite redeem |
| `PadModerationQueue` | 승인 대기 목록과 승인·거절 | pending-posts, post moderate |
| `PadActivityPanel` | 보드 공용 활동 타임라인 | board activity |
| `PadTrash` | 숨김 섹션·글·댓글 조회와 7일 내 복구 | board trash, 종류별 restore |
| `PadExportPanel` | 인쇄·발표 링크와 관리자용 CSV·XLSX·ZIP | export API와 print/present 페이지 |
| `usePadEvents` | visible 탭의 보드 SSE 연결, 엔티티 델타 전달, 숨김 시 연결 해제, 복귀·재연결 시 전용 JSON 정본 재동기화 | board events, realtime snapshot |

## 4. API와 소비 컴포넌트

표의 API는 모두 `app/` 아래 Route Handler다. 동적 ID는 클라이언트가 보낸 값이므로 서버에서 소속과 권한을 다시 조회한다.

### 인증·내 계정

| API | 메서드 | 주 소비자·역할 |
|---|---|---|
| `/api/auth/register/check-login-id` | POST | `home-actions`; 3~20자 영문·숫자 형식, 기존 계정, 예약 시스템 아이디 확인. IP·계정별 DB 제한 적용 |
| `/api/auth/register` | POST | `home-actions`; 서버에서 아이디·비밀번호 규칙을 다시 검사하고 암호화 로그인 식별자·scrypt 해시의 일반 학생 계정만 생성 |
| `/api/auth/[...nextauth]` | GET, POST | `home-actions`; Credentials·Kakao 인증, JWT 발급·갱신·로그아웃. IP·계정·조합별 DB 제한과 점진적 계정 대기 적용 |
| `/api/onboarding` | POST | `OnboardingExperience`; 고유 닉네임을 다시 검사하고 학생 학년·반·중복 없는 번호를 즉시 확정하거나 교사 승인 신청 생성 |
| `/api/me/nickname-availability` | POST | 온보딩·프로필; 로그인 사용자의 정규화 닉네임 HMAC 중복 확인 |
| `/api/me` | PATCH, DELETE | 고유 닉네임 변경, 계정 탈퇴 |
| `/api/me/password` | POST | Credentials 계정의 현재 비밀번호·새 강도 검증, 해시 교체, 강제 변경 해제와 전체 세션 무효화 |
| `/api/me/avatar` | POST, DELETE | 프로필 이미지 WebP 업로드·제거 |
| `/api/me/export` | GET | `/profile`의 내 데이터 JSON 다운로드 |
| `/api/users/[userId]/avatar` | GET | 저장된 공개 프로필 이미지 제공 |

### 홈·대시보드·재사용

| API | 메서드 | 주 소비자·역할 |
|---|---|---|
| `/api/boards` | POST | `CreateBoardActionsProvider`; 교과목 이름(`subjectName`, 퀴즈처럼 자유 입력 — 없으면 내 소유로 upsert)·같은 조직 멤버를 포함한 새 보드 생성. 둘 다 생략 가능하며 학생은 보관된 패드를 포함해 최대 10개, 사용자별 DB 트랜잭션 잠금으로 동시 요청 우회 차단 |
| `/api/boards/member-candidates` | GET | 새 패드 생성 모달; 전체관리자는 전체(소속 학교 불요), 교사·관리자는 같은 학교, 학생은 같은 학급의 활성 초대 후보 검색. 로그인 식별자는 마스킹 |
| `/api/boards/[boardId]/favorite` | PUT, DELETE | `PadGrid`; 팔로우와 별도인 개인 즐겨찾기 |
| `/api/boards/[boardId]/template` | PATCH | `PadGrid`; 관리 가능한 패드의 템플릿 표시 |
| `/api/boards/[boardId]/clone` | POST | `PadReuseDialog`; 선택 복제와 파일 롤백 |
| `/api/dashboard` | POST, PATCH, DELETE | `AppSidebar`(생성)·`FolderView`(이름 변경·삭제)·`PadGrid`(패드 포함) |

### 교과목과 퀴즈

| API | 메서드 | 주 소비자·역할 |
|---|---|---|
| `/api/subjects` | GET, POST | 퀴즈 생성 폼의 교과목 목록과 `CourseManager`의 생성. 생성은 교사·관리자만 가능 |
| `/api/subjects/[subjectId]` | PATCH, DELETE | **이름만** 바꾸거나 삭제. 삭제해도 퀴즈·패드는 미분류로 남는다 |
| `/api/subjects/[subjectId]/roster` | GET, POST | 명단 조회(50명씩)와 학생·학급 **델타**(추가/제거), 학급 명단 복사 |
| `/api/subjects/[subjectId]/resources` | POST | 퀴즈·패드 연결 **델타** |
| `/api/subjects/[subjectId]/candidates` | GET | 추가할 수 있는 학생·퀴즈·패드 후보. 검색·학급 필터·페이지네이션 |
| `/api/subjects/assign` | POST | 퀴즈·패드 **한 개**의 교과목 지정. 목록 카드에서 부른다 |
| `/api/quiz/quizzes`, `/api/quiz/sessions` | GET, POST | 호환용 컬렉션 조회와 생성. GET은 기본 50·최대 100개 페이지, POST JSON은 16KB 상한이며 현재 화면 목록은 Server Component 로더를 직접 쓴다 |
| `/api/quiz/quizzes/[quizId]/assignments` | GET, POST | `AssignmentDialog`(`components/quiz/quiz-library.tsx`); 학생에게 퀴즈를 할당. 후보는 학급·검색·50명 페이지로 조회(view=classes로 필터 학급 목록), POST는 1~100명에게 ASYNC 세션을 만들어 할당한다(`lib/quiz/assign-candidates.ts`) |
| `/api/quiz/subjects`, `/api/quiz/subjects/[subjectId]` | 동일 | 이전 클라이언트 호환용 재노출. 새 코드는 `/api/subjects`를 사용 |
| `/api/quiz/live-audio/[slot]` | GET | 라이브 호스트·학생 화면의 BGM/효과음 스트림. 현재 또는 최근 14개 교체 유예 revision URL만 허용하고 byte range·ETag·immutable 캐시를 제공 |
| `/api/admin/quiz-live-audio`, `/api/admin/quiz-live-audio/[slot]` | GET, PATCH / POST, DELETE | 전체관리자의 라이브 퀴즈 볼륨과 7개 음원 슬롯 관리. 실제 파일 검증·교체 롤백·감사 로그 적용 |

### 설문

| API | 메서드 | 주 소비자·역할 |
|---|---|---|
| `/api/forms` | POST | 새 설문 생성. 목록은 `/forms` 서버 컴포넌트가 `lib/forms/list.ts`에서 직접 페이지 단위로 읽는다. 생성은 교사·관리자만 |
| `/api/forms/[formId]` | GET, PUT, DELETE | 편집기의 문서 로드와 **전체 문서 저장**, 소프트 삭제. 저장 알고리즘은 `lib/forms/save.ts` |
| `/api/forms/[formId]/publish` | POST | `status=OPEN`. 완성도 검사는 편집기와 같은 `fieldCompletionError`를 쓴다 |
| `/api/forms/[formId]/close` | POST | `status=CLOSED`. 링크는 죽이지 않고 "마감됐다"를 알린다 |
| `/api/forms/[formId]/responses` | GET | 응답 집계(`lib/forms/summary.ts`)와 개별 응답 목록(페이지네이션). VIEWER 공유도 볼 수 있다 |
| `/api/forms/[formId]/responses/[responseId]` | GET | 응답 하나의 전체 답. 목록이 매번 다 실어 보내지 않고 펼칠 때만 부른다 |
| `/api/forms/[formId]/responses/export` | GET | XLSX. `exceljs`로 워크북을 굽고 `assertRateLimit`(5회/분)을 건다 |
| `/api/forms/[formId]/shares`, `/api/forms/[formId]/shares/[userId]` | GET, POST, DELETE | 공유 목록·부여·제거. 소유자만 관리할 수 있다(`requireOwnedForm`) — `/api/quiz/quizzes/[quizId]/shares`와 같은 자리. 후보·POST 대상은 `teacherShareCandidateScope`(같은 학교) 범위, 기존 share 행은 예외 |
| `/api/public/forms/[slug]` | GET | 공개 응답 화면이 읽는 설문 정의. 닫혀 있으면 질문 내용 없이 사유만 |
| `/api/public/forms/[slug]/responses` | POST, PATCH | 제출·수정. 로그인 사용자는 계정으로, 익명은 IP로 레이트리밋을 개별화한다 |

저장(PUT)은 **`status`를 건드리지 않는다.** 퀴즈처럼 저장이 발행을 취소하면 응답을 받는 중인 설문이 오타 수정만으로 닫힌다. 대신 `OPEN`에서도 질문 추가·수정·유형 변경·삭제가 전부 가능하다. 응답이 달린 질문을 지우려 하면 409 + `needsConfirm`으로 되묻는다.

응답 집계는 SQL `groupBy`가 아니라 필드당 답 전체를 한 번에 불러와 자바스크립트에서 버킷을 만든다(`lib/quiz/report.ts`의 `buildSessionReport`와 같은 전략) — `selectedOptionIds`가 배열 컬럼이라 다중 선택·그리드 집계가 `groupBy`로 표현되지 않고, 이 배포는 학교 단위라 무겁지 않다.

### 짧은 주소

| API | 메서드 | 주 소비자·역할 |
|---|---|---|
| `/api/short-links?targetType=...&targetId=...` | GET | `ShortLinkManager`; 기존 대상 관리 권한을 다시 확인한 뒤 현재 활성 별칭 조회. 응답은 `private, no-store`, 사용자별 120회/분 |
| `/api/short-links` | PUT | 같은 대상에 활성 별칭 하나를 생성·변경. 형식·same-origin·본문 16KB·사용자별 30회/분을 검사하고, 대상 행 잠금 안에서 활성 상태와 전역 예약 slug 충돌을 확인. 같은 대상만 자기 과거 slug를 복구 가능 |
| `/api/short-links?targetType=...&targetId=...` | DELETE | 현재 연결을 비활성화하되 slug 예약 행과 콘텐츠 원주소는 유지. 같은 관리 권한·same-origin·요청 제한 적용 |

`/go/[slug]`는 별칭에서 원래 공개 URL을 계산하는 리다이렉트 계층일 뿐 capability를 만들지 않는다. 도착한 `/b`, `/j`, `/s`가 기존 로그인·발견 범위·비밀번호·세션 상태를 다시 판정한다. 30초 양성/10초 음성 LRU 캐시, slug별 진행 요청 합치기, DB 조회 동시 24개·대기 96개 상한, 신뢰 IP별 240회/분 제한을 적용한다. 변경 시 캐시 세대도 올려 겹쳐 있던 과거 조회가 stale 값을 다시 넣지 못한다. 대상·생성자가 영구 삭제되면 FK만 `SET NULL`되고 예약 행은 남으며, 퀴즈 마감은 같은 트랜잭션에서 연결을 비활성화한다.

### 보드 설정·접근·운영

| API | 메서드 | 주 소비자·역할 |
|---|---|---|
| `/api/boards/[boardId]` | PATCH, DELETE | `PadCanvas`, `PadSharingSettings`; 설정·공유 정책 저장과 보관. PATCH 본문 256KB 상한. 새 공유 비밀번호는 제한된 비동기 scrypt와 AES-GCM으로 갱신하며 10분당 10회, `password: null`은 둘 다 제거 |
| `/api/boards/[boardId]/restore` | POST | 홈 보관함; 보드 복구 |
| `/api/boards/[boardId]/sections` | POST | `PadCanvas`; 섹션 생성 |
| `/api/boards/[boardId]/members` | POST | `PadCanvas`; 일반 `loginId`, 카카오 이메일 또는 후보 `userId`로 멤버 추가 |
| `/api/boards/[boardId]/members/candidates` | GET | 패드 설정; 기존 멤버를 제외하고 생성 화면과 같은 조직 범위의 초대 후보 검색 |
| `/api/boards/[boardId]/members/[userId]` | PATCH, DELETE | `PadCanvas`; 역할 변경·제거 |
| `/api/boards/[boardId]/access-requests` | GET, POST, PATCH | 접근 안내·설정 패널; 요청 생성과 승인·거절 |
| `/api/boards/[boardId]/verify-password` | POST | `PadPasswordGate`; 비동기 scrypt, 브라우저별 실패 8회/10분 + IP 전체 실패 60회/10분 뒤 현재 해시까지 묶은 보드 전용 서명 쿠키 발급 |
| `/api/boards/[boardId]/password` | POST | `PadSharingSettings`; same-origin·30분 이내 로그인·소유자 전용·5회/10분 뒤 현재 공유 비밀번호 복호화와 감사 기록. 응답은 `private, no-store` |
| `/api/boards/[boardId]/guest` | GET, POST | `GuestIdentityProvider`; 손님 표시 이름 확인·등록(권한은 주지 않음) |
| `/api/boards/[boardId]/follow` | GET, POST, DELETE | `PadCanvas`; 활동 팔로우와 최근 본 시각 |
| `/api/boards/[boardId]/invite-links` | GET, POST | `PadInviteLinks`; 목록·생성 |
| `/api/boards/[boardId]/invite-links/[linkId]` | DELETE | `PadInviteLinks`; 폐기 |
| `/api/invite/[token]/redeem` | POST | `JoinBoardButton`; 사용 횟수 증가와 멤버 참여 |
| `/api/boards/[boardId]/pending-posts` | GET | `PadModerationQueue`; 승인 대기 목록 |
| `/api/boards/[boardId]/activity` | GET | `PadActivityPanel`; 보드 공용 활동 타임라인 페이지네이션 |
| `/api/boards/[boardId]/events` | GET, SSE | `usePadEvents`; 글·댓글·첨부·반응·섹션·설정 델타 |
| `/api/boards/[boardId]/realtime-snapshot` | GET | SSE 재연결·권한 변경 때만 현재 뷰어의 보드 정본 |
| `/api/boards/[boardId]/search` | GET | 패드 제목·본문 서버 검색 호환 API(현재 `PadCanvas`는 전체 SSR DTO를 로컬 검색) |
| `/api/boards/[boardId]/trash` | GET | `PadTrash`; 복구 가능한 숨김 항목 |

### 섹션·게시물·댓글·반응

| API | 메서드 | 주 소비자·역할 |
|---|---|---|
| `/api/sections/[sectionId]` | PATCH, DELETE | `SectionColumn`, 레이아웃 편집 모달 |
| `/api/sections/[sectionId]/reorder` | POST | `PadCanvas`; LexoRank형 위치 갱신 |
| `/api/sections/[sectionId]/restore` | POST | `PadTrash` |
| `/api/sections/[sectionId]/posts` | GET, POST | 더 보기 cursor 페이지와 `PostComposer` 새 글 |
| `/api/posts/[postId]` | PATCH, DELETE | `PostComposer`, `PostDetail` |
| `/api/posts/[postId]/reorder` | POST | `PadCanvas`; 섹션 안/사이 이동 |
| `/api/posts/[postId]/restore` | POST | `PadTrash` |
| `/api/posts/[postId]/moderate` | POST | `PadModerationQueue`; 게시·거절, 활동·알림 생성 |
| `/api/posts/[postId]/comments` | GET, POST | `PostDetail`; 댓글 트리 조회·작성 |
| `/api/comments/[commentId]` | PATCH, DELETE | `PostDetail`; 댓글 수정·숨김 |
| `/api/comments/[commentId]/restore` | POST | `PadTrash` |
| `/api/posts/[postId]/reactions` | PUT, DELETE | `PostCard`, `PostDetail`; 단일/복수 정책을 트랜잭션에서 강제 |

### 첨부·링크·파일

| API | 메서드 | 주 소비자·역할 |
|---|---|---|
| `/api/link-preview` | POST | `LinkPreviewInput`; SSRF 방어 후 공개 메타데이터만 반환 |
| `/api/posts/[postId]/attachments` | POST multipart | `PostComposer` 업로드 큐; 파일별 XHR 진행률 |
| `/api/posts/[postId]/links` | POST | `PostComposer`; 로컬 파일 없는 LINK 첨부 |
| `/api/posts/[postId]/attachments/reorder` | POST | `PostDetail`; 게시물 첨부 전체 순서 저장 |
| `/api/comments/[commentId]/attachments` | POST multipart | `PostDetail`; 댓글 이미지·음성 최대 4개 |
| `/api/attachments/[attachmentId]` | PATCH, DELETE | `PostDetail`; 대체텍스트·캡션 수정과 숨김 |
| `/api/attachments/[attachmentId]/restore` | POST | `PadTrash` |
| `/f/[attachmentId]` | GET | `AttachmentViewer`, 카드 썸네일, 인쇄·발표; Range·download 정책 재검사 |

### 알림

| API | 메서드 | 주 소비자·역할 |
|---|---|---|
| `/api/notifications` | GET | `NotificationBell`; 개인 알림 목록 |
| `/api/notifications/[notificationId]` | PATCH | `NotificationBell`; 한 건 읽음 |
| `/api/notifications/read-all` | POST | `NotificationBell`; 모두 읽음 |
| `/api/notifications/events` | GET, SSE | `NotificationBell`; `notification.created` 신호 |

### 내보내기·발표

| API·페이지 | 메서드 | 주 소비자·역할 |
|---|---|---|
| `/api/boards/[boardId]/exports/csv?type=...` | GET | `PadExportPanel`; 관리자용 게시물·댓글·반응 CSV |
| `/api/boards/[boardId]/exports/xlsx` | GET | 관리자용 3시트 XLSX |
| `/api/boards/[boardId]/exports/attachments-zip` | GET stream | 관리자 + 다운로드 정책; 로컬 파일을 ZIP 스트리밍 |
| `/b/[slug]/print` | page | 읽기 권한 기반 인쇄·PDF·PNG |
| `/b/[slug]/present` | page | 읽기 권한 기반 게시 글 발표 |

### 관리자

| API | 메서드 | 주 소비자·역할 |
|---|---|---|
| `/api/admin/users` | GET | `AdminUsersPanel`; 역할·상태·학교·소속 필터와 로그인 아이디/이름 통합 검색. 입력 2자 이상이면 debounce 뒤 자동 조회하며 식별자는 마스킹하지 않는다(긴 카카오 이메일은 카드 UI에서만 축약). 교사는 요청 필터와 무관하게 자기 학교로 강제 제한 |
| `/api/admin/audit-logs` | GET | `AdminAuditPanel`; 감사 로그 cursor 조회 |
| `/api/admin/theme` | GET, PATCH | `ThemePanel`; 사이트 공통 브랜드 색상각·채도. GET은 관리 화면 접근 권한 전반, PATCH는 전체관리자만. 값은 저장 전후 모두 `normalizeBrandTheme`을 통과해 DB와 화면이 어긋나지 않는다 |
| `/api/admin/students/import` | GET, POST multipart | `StudentRosterImport`; XLSX 양식, 미리보기, 학교→학년→반과 학생 계정 일괄 생성 |
| `/api/admin/students/move` | PATCH | 선택한 학생 최대 100명을 도착 반으로 이동하고 빈 번호 자동 배정. 기존 학교 권한·번호 중복을 학교 단위 트랜잭션에서 검사 |
| `/api/admin/schools`, `/api/admin/schools/[schoolId]` | POST, PATCH, DELETE | 학교 생성·이름 변경·삭제 |
| `/api/admin/schools/[schoolId]/groups/**` | GET, POST, PATCH, DELETE | 학생 학년·반 번호와 교사 부서 이름을 구분한 소속 CRUD. 같은 학교 교사는 구성원을 조회하고 구조 변경은 허가된 관리자·대표교사만 수행 |
| `/api/admin/account-approvals` | GET | `RegistrationApprovalQueue`; 자가 회원가입·최초 카카오 로그인 계정의 전체관리자 승인 대기열 |
| `/api/admin/account-approvals/[userId]` | PATCH | 계정 가입 승인·반려. UI는 개별 처리와 선택 일괄 승인을 제공하고 처리 설명을 자동 전송 |
| `/api/admin/teacher-approvals` | GET | `TeacherApprovalQueue`; 전체관리자는 전체, 대표교사는 자기 학교 대기열 |
| `/api/admin/teacher-approvals/[requestId]` | PATCH | 신청 학교·교사 부서·학생 상태를 재검증하고 승인 또는 반려. UI는 처리 설명을 자동 전송해 별도 사유 입력칸을 두지 않음 |
| `/api/admin/users/[userId]` | PATCH | 행 편집기·소속 구성원 번호 편집기; 역할·상태·소속 및 학생 번호 변경. 일반 교사는 자기 학교 학생 번호만 허용 |
| `/api/admin/users/[userId]/permissions` | PUT | `UserEditor`; 보조관리자 시스템 권한 동기화 |
| `/api/admin/users/[userId]/revoke-sessions` | POST | `UserEditor`; `authVersion` 증가 |
| `/api/admin/users/[userId]/password-reset` | POST | 관리 가능한 Credentials 계정에 무작위 임시 비밀번호 발급, 강제 변경 설정, 세션 해제·감사 |
| `/api/admin/users/[userId]/pii` | POST | `UserEditor`; 상세 작업 모달에서 자동 감사 설명을 남긴 뒤 로그인 식별자·이름·프로필 URL을 일시 복호화 |
| `/api/admin/boards/[boardId]/purge` | DELETE | 홈 보관함; 보드와 실제 파일 수동 영구 삭제 |
| `/api/admin/boards/[boardId]/transfer` | POST | 현재 직접 연결된 UI 없음; 소유권 이전 운영 API |
| `/api/admin/posts/[postId]/purge` | DELETE | 현재 직접 연결된 UI 없음; 게시물 수동 영구 삭제 API |

## 5. 디자인 토큰과 색

색은 컴포넌트가 원시 Tailwind 팔레트(`emerald-600` 같은)나 리터럴 색을 직접 고르지 않고
`app/globals.css`가 선언한 토큰만 쓴다.

### 5.1 두 축: `--brand-h`와 `--brand-c`

브랜드 계열, 중립 회색, 장식 팔레트, 정보 계열이 **전부 두 변수에서 파생된다.**

```
--brand-h: 250   색상각          --info-h: calc(--brand-h - 50)
--brand-c: 1     채도 배율
```

전체관리자가 `/admin` → **테마** 탭에서 이 둘을 정하면 `SystemSetting.brandHue/brandChroma`에
저장되고, 루트 레이아웃(`app/layout.tsx`)이 `<html style="--brand-h:…; --brand-c:…">`로 얹는다.
기본값(250 / 100)과 같으면 속성 자체를 붙이지 않는다. 값 읽기는 `lib/settings/brand-theme.ts`의
`getBrandTheme()`이고, 요청당 한 번만 조회하도록 `cache()`로 감싸며 **조회에 실패해도 던지지
않는다** — 색 하나 때문에 공개 랜딩이 500이 되면 안 된다.

명도 곡선은 CSS가 고정으로 들고 있으므로 관리자가 어떤 값을 넣어도 본문 대비는 유지된다.
**관리자가 화면을 못 읽게 만들 수 없는 구조**이고, 그래서 색상환 전체를 열어 둘 수 있다.

`--info-h`가 고정 200이 아니라 브랜드에서 50° 떨어진 상대값인 이유는, 관리자가 브랜드를
청록(200)으로 바꾸면 고정값과 정면으로 겹쳐 라이브 무대의 포인트 색이 죽기 때문이다.

**상태색은 이 축을 따라가지 않는다.** 브랜드가 초록이 되어도 "위험"은 붉은색, "성공"은 초록이어야
뜻이 전달된다. 그래서 `--danger-*`(hue 25), `--warning-*`(75), `--success-soft`(150)만 색상각을
직접 쓴다. 대신 브랜드를 초록으로 두면 브랜드와 성공색이 같은 색상각이 되는데, 이건 고정
상태색을 쓰는 이상 피할 수 없는 교환이고 의미 전달을 우선한 결과다.

### 5.2 `.theme-scope` — 파생을 다시 계산해야 하는 자리

커스텀 속성은 **선언된 element에서 값이 확정된다.** `--brand` 정의 안의 `var(--brand-h)`는
`:root`의 값으로 치환되고, 자식은 그렇게 굳은 `--brand`를 물려받을 뿐이다. 그래서 자식에
`--brand-h`만 다시 얹어도 `--brand`는 꿈쩍하지 않는다.

실제 화면은 `<html>`(=`:root`)에 얹으므로 문제가 없다. 하지만 테마 탭의 프리셋 버튼·미리보기처럼
"한 상자 안에서만 다른 색"이 필요하면 그 상자에서 파생을 다시 계산해야 한다. 그래서 토큰 블록의
셀렉터가 `:root, .theme-scope`이고 다크도 `:root[data-theme="dark"] .theme-scope`를 함께 받는다.
같은 공식을 JS로 옮겨 적으면 미리보기와 실물이 갈라지므로 **공식은 CSS 한 벌만 둔다.**

`--brand-h`를 얹으면서 `theme-scope` 클래스를 빠뜨리면 그 상자만 통째로 기본 색으로 보인다
(실제로 그렇게 만들었다가 프리셋 스와치 6개가 전부 같은 파랑으로 나왔다).

### 5.3 토큰의 두 성격

| 종류 | 예 | 다크 모드 | 쓰는 곳 |
|---|---|---|---|
| **의미 토큰**(테마 따라 뒤집힘) | `--ink`/`--surface`/`--surface-inset`/`--line`, `--brand`/`--brand-strong`, `--brand-soft(-fg)`, `--danger-soft(-fg)`, `--warning-soft(-fg)`, `--on-accent` | 값이 뒤집힌다 | 테마를 따라가는 일반 문서 화면 |
| **명도 스케일**(고정) | `--brand-50…950`, `--info-50…950`, `--danger-50…950`(hue 25), `--warning-50…950`(hue 75) | **뒤집지 않는다.** 컴포넌트가 테마별로 단계를 고른다(`bg-brand-100 dark:bg-brand-900`) | 라이브 무대처럼 테마와 무관하게 밝기가 고정된 면 |
| **형상·컨트롤 토큰** | `--radius-xs…xl`, `--radius-pill`, `--control-height-xs…lg`, `--control-radius`, `--field-radius`, `--dialog-radius` | 색과 무관해 동일 | CSS 클래스 기반 버튼·입력·카드·대화상자 |

`--surface-inset`은 채워진 칩·코드 블록·스켈레톤처럼 "면 위에 한 단계 얹은" 자리다. 라이트에서는
표면보다 어둡고 다크에서는 표면보다 밝아서, 하드코딩하면 두 테마 중 하나가 반드시 어긋난다.

장식색 `--deco-1…6`은 섹션 열 머리띠·멤버 아바타처럼 **서로 다르기만 하면 되는** 자리에 쓴다.
색상각을 브랜드에서 상대적으로 돌려 두어(`calc(var(--brand-h) + 150)` 등) 브랜드를 바꾸면 장식
팔레트도 함께 돌며 조화를 유지한다. CSS 색상각은 360을 넘으면 자동으로 감긴다(400 → 40).

라이브 무대(`components/quiz/live-game-ui.tsx`의 `LiveGameSurface`)는 사용자의 테마와 상관없이 항상
어둡다(`bg-brand-950`). 그래서 그 위에는 **고정 스케일만** 쓴다. 뒤집히는 `--danger-soft`를 얹으면
같은 배지가 라이트에서는 흰 분홍, 다크에서는 어두운 적갈색이 되어 "보임 ↔ 안 보임"으로 갈린다.
포인트 색을 브랜드 파랑이 아니라 `--info-*`(사이언)로 두는 이유도 같다 — 배경이 파랑이라 포인트까지
같은 색상각이면 대비가 죽는다.

퀴즈의 보기색도 별도 violet/fuchsia/teal 팔레트 대신 브랜드·정보·경고·강조·성공·위험의 공용
역할 토큰을 조합한다. 순위 메달의 금·은·동과 정답 공개 효과처럼 색 자체가 의미인 소수의 기능색만
고정 팔레트를 유지한다.

지켜야 할 것:
- **리터럴 색을 새로 추가하지 않는다.** 예전에는 전역 CSS와 CSS 모듈에 하드코딩 색이 399개
  있었고, 토큰만 파랑으로 갈아끼운 탓에 **그중 초록 계열이 111개**였다 — 다크 모드의 카드·버튼이
  올리브색이고 사이드바만 푸른 회색인 상태가 오래 남아 있었다. 지금 남은 리터럴은 카카오 노랑
  (`#fee500`), 유튜브 빨강(`#ff0033`)과 그 위의 흰 글자뿐이고, 전부 외부 브랜드라 정당하다.
- **CSS 모듈에 `var(--surface, #fff)` 같은 fallback을 쓰지 않는다.** globals.css가 항상 정의하므로
  죽은 값이고, 하필 전부 초록 시절 색이라 "모듈에 하드코딩 색이 남아 있다"처럼 보이게 만들었다.
  fallback이 의미 있는 건 컴포넌트가 인라인으로 주입하는 `--board-accent`·`--layout-gap`뿐이다.
- **주석 안에서 토큰 이름을 별표로 줄여 쓴 뒤 슬래시를 붙이지 않는다.** 그 두 글자가 곧 주석 종료
  기호라 거기서 주석이 끝나고, 다음 줄부터 본문으로 파싱되면서 빌드가 `Unknown word --brand-h`로
  죽는다(실제로 두 번 겪었다). 나열할 땐 쉼표를 쓴다.
- **element 리셋은 반드시 `@layer base` 안에 둔다.** 레이어 밖 규칙은 명시도와 무관하게 레이어 안
  규칙을 전부 이기므로, `button { color: inherit }`가 레이어 밖에 있으면 `<button>`/`<a>`에 붙인
  Tailwind 색·글꼴 유틸리티가 **통째로 죽는다**(실제로 그랬다. 클래스는 붙어 있고 유틸리티도
  생성돼 있는데 화면만 안 맞아 원인을 찾기 어렵다).
- **색을 섞을 땐 `color-mix(in srgb, …)`.** `in oklch`는 색상각을 짧은 호로 보간해서 파랑을 흰색에
  섞으면 분홍을 지나간다.
- **`@theme`에 반경·그림자를 올리지 않는다.** Tailwind 기본 `rounded-sm`/`shadow-sm`을 조용히 덮어써서
  이식 화면의 레이아웃이 틀어진다. CSS 클래스에서는 `:root`의 형상·컨트롤 토큰을 직접 사용한다.
- **`@custom-variant dark`를 지우지 않는다.** 없으면 `dark:` 변형이 에러 없이 통째로 무시된다.
- **버튼 글자색에 `text-white`를 쓰지 않는다.** 뒤집히는 `--brand-strong` 위에는 `text-on-brand`,
  밝기가 고정된 `--brand-800~950` 위에는 `text-brand-fg`를 쓴다.
- Tailwind 4는 정의되지 않은 유틸리티를 **에러 없이 그냥 만들지 않는다.** `tsc`도 빌드도 통과하고
  콘솔도 조용한 채 화면만 무스타일이 되므로, 색을 바꾼 뒤에는 `getComputedStyle`로 눈이 아니라
  값으로 확인해야 한다.

카드 치수도 같은 곳에서 정한다. `--card-min-h`(240px)와 `--card-cover-h`(88px)를 패드 목록
(`components/home/pad-dashboard.module.css`)과 퀴즈 보관함(`components/quiz/quiz-library.tsx`)이 함께
읽어, 스타일 방식이 다른 두 화면(CSS 모듈 ↔ Tailwind)의 카드가 같은 크기로 떨어진다. 단 수가 바뀌는
지점(600/720/1080px)도 패드 쪽 사다리를 정본으로 양쪽이 맞춘다.


## 6. 공통 서버 계층

| 경로 | 책임 |
|---|---|
| `lib/auth/auth-options.ts` | Credentials·Kakao 인증, JWT의 내부 사용자 ID·세션 버전·온보딩·강제 비밀번호 변경 상태 |
| `lib/auth/credentials.ts` | 일반 계정 `loginId`와 회원가입·변경 비밀번호 정책의 서버 계약 |
| `lib/auth/password.ts` | 고정 비용 scrypt 사용자 비밀번호 해시·검증과 미등록 계정 더미 연산 |
| `lib/auth/registration.ts`, `lib/auth/security.ts` | 예약 시스템 아이디 선점 차단, DB 기반 실패 IP·계정별 제한, 점진적 대기와 집계 보안 이벤트. 정상 로그인은 학교 공용 IP 버킷에 누적하지 않음 |
| `proxy.ts` | 신규 사용자 프로필 설정·교사 승인 대기와 임시 비밀번호 계정의 페이지/API 게이트, 요청별 nonce CSP 발급, 전체 쓰기 API의 요청량 백스톱 |
| `lib/security/request-identity.ts`, `lib/security/rate-limit*.ts` | 신뢰 가능한 요청자 식별과 인메모리 고정 윈도 제한, `assertRateLimit`/`RateLimitError`. 동적 리소스 scope별 인스턴스를 만들지 않고 정책별 최근 32개 제한기를 공유·폐기한다 |
| `lib/realtime/sse-stream.ts` | 두 SSE 라우트 공용 스트림: enqueue 예외 격리, 연결 수 상한, 백프레셔 종료, heartbeat |
| `lib/auth/current-user.ts` | NextAuth 세션에서 ID를 읽고 DB의 최신 활성 사용자 DTO 조회 |
| `lib/auth/authorization.ts` | 역할·시스템 권한·보드 capability·동결·승인 정책의 중앙 판정 |
| `lib/board/permissions.ts` | 보드, 소유자, 현재 사용자 멤버 역할을 한 번에 조회 |
| `lib/board/queries.ts` | 홈 공개 보드와 보드 페이지 SSR DTO, 게시물 30개 초기 페이지 |
| `lib/dashboard/queries.ts`, `lib/dashboard/sidebar.ts` | 패드 홈의 개인 보드·즐겨찾기·템플릿·요청 DTO / 패드 사이드바 전용 폴더·최근 방문 작은 DTO |
| `lib/subjects/course-dashboard.ts` | 교과목 목록·요약. 개수만 세고 명단은 UNION 한 방으로 계산한다 |
| `lib/subjects/roster.ts` | 명단 = 개별 배정 ∪ 연결 학급. 페이지 조회, 학생 후보 검색, 학급 연결 목록 |
| `lib/subjects/resources.ts` | 퀴즈·패드 후보의 검색·페이지네이션 |
| `lib/subjects/mutations.ts` | 학생·학급·자원 델타 적용과 권한 재검사 |
| `lib/subjects/scope.ts` | 교과목이 다룰 수 있는 학생·학급의 학교 경계 |
| `lib/board/validators.ts` | 보드·섹션·글·댓글·반응 요청 스키마 |
| `lib/post-fields/*`, `lib/reactions/*` | JSON 필드 버전과 반응 키·집계 검증 |
| `lib/board/activity.ts` | 보드 전체에 보이는 활동 로그와 팔로우 |
| `lib/notifications/create.ts` | 개인 알림 저장과 사용자 SSE 발행 |
| `lib/files/*` | multipart 스트리밍, MIME·시그니처, WebP·썸네일, UUID 저장명, Range·정리 |
| `lib/link-preview/*` | DNS·리다이렉트 단계별 SSRF 방어와 HTML 메타 파싱 |
| `lib/board-reuse/*` | 안전한 비공개 복제, 선택 항목, 파일 복사·실패 롤백 |
| `lib/exports/*` | 내보내기 권한, 공통 조회, CSV·XLSX·ZIP 생성 |
| `lib/security/*`, `lib/users/*` | PII AES-GCM/HMAC과 목적별 최소 DTO |
| `lib/users/student-roster.ts` | XLSX 3MB·500행·필수 열·수식·숫자·중복 검사, 학생 ID/초기 비밀번호 계산과 템플릿 생성 |
| `lib/users/teacher-approvals.ts` | 가입자 신청 상태와 학교 범위 관리자 승인 대기열 DTO |
| `lib/users/share-scope.ts` | 퀴즈·설문 공유 후보/대상 범위 판정(`teacherShareCandidateScope` — VIEW_USERS면 전체, 아니면 내 학교) |
| `lib/http.ts` | 인증·권한 오류 응답과 same-origin 검사 |
| `lib/prisma.ts` | `DATABASE_URL`을 지연 로딩하는 Prisma 단일 인스턴스와 연결 풀 |

## 7. 대표 상호작용 흐름

### 교과목 구성과 학생 배정

**교과목의 명단은 두 축의 합집합이다.**

```text
개별 배정(SubjectStudent)  ∪  연결된 학급(SubjectSchoolGroup)의 활성 학생
```

학생 400명 규모에서 반 하나를 넣으려고 체크박스를 28번 누르는 건 쓸 수 없고, 반대로 "이 반에서
3명만 빼고" 같은 예외도 실제로 생긴다. 그래서 둘 다 둔다. 학급 쪽은 **살아 있는 연결**이라 전학·반
이동이 자동으로 반영되고, 그 순간 명단을 고정하고 싶으면 "명단만 복사"가 연결 대신 개별 배정 행을
그만큼 만든다(이후 반 변경을 따라가지 않는다).

1. `/courses` 본문은 교과목마다 **개수만** 센다. 학생 수는 개별·학급이 겹칠 수 있어 `students.length`로
   셀 수 없고, `countCourseStudents`가 UNION 한 방으로 계산한다. 대시보드 사이드바는 이 집계를
   재사용하지 않고 교과목 이름·링크만 별도 조회하므로 교과목 수만큼 count 쿼리를 만들지 않는다.
2. `/courses/[subjectId]`의 각 탭이 필요할 때 따로 읽는다 — 명단은 50명씩, 후보는 검색+페이지 단위.
3. 변경은 **전부 델타**다. 학생·학급은 `POST …/roster`, 퀴즈·패드는 `POST …/resources`가 받는다.
4. 서버는 매번 교과목 소유권, 리소스 소유권, 학생의 활성 상태와 학교 범위를 다시 검사한다.
5. 교과목 삭제 시 퀴즈·패드는 `subjectId = null`(미분류)이 되고 명부와 학급 연결만 사라진다.

**왜 델타여야 했나.** 예전 `PATCH`는 `studentIds` 전체 배열을 받아
`deleteMany({ notIn: studentIds })`로 통째로 교체했다. 그 방식은 **클라이언트가 명단 전부를 들고
있어야만** 안전해서 페이지네이션과 양립할 수 없다 — 화면에 없는 학생이 지워진다. 게다가 배열 상한이
500이라 500명을 넘는 교과목은 이름조차 못 바꿨다(zod가 요청 전체를 거부). 페이지네이션은 델타 전환이
선행 조건이지 별개 작업이 아니다.

### 글 작성과 첨부

1. `PostComposer`의 `MarkdownEditor`가 Milkdown CommonMark 입력 규칙으로 백틱 인라인 코드·제목·인용·목록·코드 블록을 편집 즉시 문서 노드로 바꾸되, listener가 직렬화한 Markdown 문자열만 `usePostDraft`와 부모 상태에 전달한다. 파일을 큐에 넣거나 이미지를 붙여넣으면 현재 커서에 Milkdown이 보존하는 `pyxis-upload/{id}` 상대 경로 블록을 자동 삽입하고, 기존 첨부·링크의 배치 버튼도 같은 방식으로 동작한다. 초안 복구처럼 외부 값이 실제로 달라질 때만 `replaceAll`을 호출해 일반 입력의 커서와 실행 취소 기록을 보존한다.
2. 붙여넣기 데이터에 `text/plain` 또는 `text/html`이 있으면 편집기 입력을 우선하고 파일 항목을 무시한다. 파일만 있는 스크린샷·이미지 클립보드는 기존 파일 검증·중복 제거 큐로 보낸다.
3. `POST /api/sections/[sectionId]/posts`가 최신 보드 권한·동결·필드 버전·승인 모드와 본문 20,000자 상한을 검사하고 Markdown 문자열을 저장한다.
4. 파일은 성공한 글 ID를 대상으로 `/attachments`에 파일별 HTTP multipart로 최대 3개씩 업로드한다. 이미지는 서버에서 다시 검증한 뒤 WebP와 썸네일로 변환한다.
5. 링크는 `/api/link-preview`로 미리보기 후 `/links`에 URL 메타데이터만 저장한다.
6. API가 `BoardActivity`와 엔티티 델타가 든 `BoardEvent`를 만들고, 모든 브라우저는 SSE를 로컬 상태와 드래그 낙관 배열에 직접 병합한다. 전체 RSC 갱신은 하지 않는다.
7. 업로드·링크 저장이 끝나면 임시 블록을 현재 게시물의 `pyxis-attachment/{id}` 상대 경로 블록으로 바꾸고 실패한 블록은 공개 본문에서 제거한다. 읽기 화면의 `PostBody`는 현재 게시물 DTO에 포함된 ID만 실제 `AttachmentViewer`로 교체하고 나머지 Markdown은 `react-markdown` + `rehype-sanitize`로 렌더링한다. 카드와 상세에서 제목 계층은 같지만 카드의 fenced code는 첫 줄만 말줄임하고, 상세의 fenced code만 바깥 페이지 폭을 늘리지 않는 내부 가로 스크롤과 복사 도구를 제공한다. 전용 블록이 없는 첨부는 상세 본문 위에 두고, 빈 본문은 아무 요소도 만들지 않는다.

### 손님(비로그인) 글쓰기

전체 공개(`PUBLIC`) + 방문자 권한 `WRITER` + `loginRequired = false`인 보드에서만 열립니다. 이 셋을 한 자리에서 판정하는 함수가 `boardAcceptsGuestPosts`이고, **모든 손님 경로가 매 요청 이 함수를 다시 부릅니다.**

1. 손님이 링크·QR로 보드를 연다. 이때는 아무것도 묻지 않는다 — 구경만 하려는 사람을 막지 않기 위해서다.
2. 글쓰기 버튼을 누르는 순간 `GuestIdentityProvider`가 이름을 한 번 묻고 `POST /api/boards/[boardId]/guest`로 보낸다.
3. 서버가 `bgs_{boardId}` HttpOnly 쿠키를 발급한다. 보드 비밀번호 쿠키와 같은 방식의 HMAC 서명이고 DB 테이블은 없다(`lib/board/guest-session.ts`). 댓글도 같은 쿠키를 쓰므로 이름은 패드당 한 번만 묻는다.
4. 글 작성 API는 `authorId` 대신 `guestId`·`guestName`을 채운다. 상태는 `guestPostsRequireApproval`이면 `PENDING`, 아니면 보드의 승인 모드를 따른다(`determineGuestPostStatus`).
5. 수정·삭제·첨부는 `resolveGuestPostOwner`(댓글은 `resolveGuestCommentOwner`)가 ①보드가 지금도 열려 있는지 ②쿠키 서명이 맞는지 ③그것이 이 손님 것인지 셋을 모두 확인한 뒤에만 통과한다.

`yarn verify:guest`가 이 규칙 29가지를 실제 HTTP 요청으로 확인합니다(실행 중인 서버 필요).

전제 몇 가지를 못 박아 둡니다.

- **쿠키는 권한이 아니라 신분증입니다.** 위조해도 권한이 생기지 않고, 교사가 설정을 끄면 이미 쿠키를 가진 손님도 그 즉시 새 글·수정이 막힙니다(이미 쓴 글은 남습니다).
- **보드 주소는 바뀌지 않습니다.** 손님 글쓰기를 켜고 끈다고 slug를 바꾸면 이미 인쇄한 QR이 죽습니다.
- **손님은 사진만 올립니다.** 문서·압축·영상은 계정이 있는 사람 몫입니다. 이미지는 sharp가 전부 WebP로 다시 인코딩하므로 원본 바이트가 그대로 남지 않습니다. 개당 10MB, 글당 5개입니다.
- **손님은 댓글도 씁니다.** 글쓰기와 같은 문(`boardAcceptsGuestComments` = 손님 글쓰기 + 보드의 댓글 허용)을 쓰고, 자기 댓글만 고치고 지웁니다. 다만 **반응(좋아요)은 계정이 필요합니다** — `Reaction`이 (postId, userId) 복합 키라 계정 없이는 중복을 셀 수 없습니다.
- **댓글에는 승인 대기가 없습니다.** `Comment`에 상태 컬럼이 없어서 손님 댓글도 회원 댓글처럼 바로 보이고, 부적절하면 관리자가 지웁니다. 글의 `guestPostsRequireApproval`은 댓글에 적용되지 않습니다.
- **제한은 IP와 손님 세션을 함께 씁니다.** 학교는 한 반이 같은 공인 IP로 나가므로(NAT) IP만으로 세게 걸면 전원이 막힙니다. DB를 건드리기 전에 IP로 느슨하게 한 번, 손님 세션이 확인된 뒤 세션·보드 기준으로 좁게 한 번 겁니다.
- **자기 글은 자기에게만 보입니다.** 승인 대기 중인 글은 작성자 본인(`guestId` 일치)과 관리자에게만 노출됩니다. 화면에는 `guestId`를 내리지 않고 서버가 계산한 `isMine`만 내려보냅니다 — 식별자를 내리면 같은 화면을 보는 다른 사람이 남의 손님 신분을 알게 됩니다.

### 카드에서 바로 댓글 읽고 쓰기

게시물을 열지 않아도 카드에서 대화가 보이고 이어집니다(패들렛과 같은 자리).

1. 목록 조회(`lib/board/queries.ts`, 섹션 게시물 GET)가 게시물마다 댓글을 **한 페이지(20개)** 함께 읽어 `comments`로 내려보냅니다.
2. 카드는 그 댓글 전부와 작성 진입점을 그립니다(`components/pad/comments/post-card-comments.tsx`). 데스크톱은 내용에 따라 늘어나는 전체 폭 인라인 입력, 모바일은 약 155px에서 시작하는 하단 작성 시트를 씁니다. **카드는 댓글을 부르는 요청을 만들지 않습니다** — 접었다 펴는 단계도, "모두 보기"도 없습니다.
3. 한 페이지를 넘긴 드문 경우에는 최신 20개를 싣고 "이전 댓글 N개는 게시물을 열면 볼 수 있어요" 한 줄을 덧붙입니다. 버튼이 아니라 안내이고, 조용히 잘라내지 않습니다.
4. 인라인 작성·삭제는 화면 이동 없이 그 자리에서 반영되고, 다른 사람이 쓴 댓글도 SSE 댓글 델타가 카드 상태에 바로 합쳐집니다.

염두에 둔 것들입니다.

- **중첩 take는 N+1이 아닙니다.** 실제 SQL을 세어 확인했습니다 — 게시물이 몇 개든 댓글 조회 1개와 작성자 조회 1개가 늘 뿐입니다. 이름 복호화 비용도 재 봤습니다: 600회(게시물 30개 × 댓글 20개, 최악의 경우)에 17.6ms입니다.
- **댓글 이벤트는 개수만 보내면 안 됩니다.** `comment.created`는 카드에 넣을 댓글 DTO와 최신 개수를 함께 보내며, 수정·삭제는 해당 댓글 patch를 보냅니다. `PadCanvas`가 이를 카드 상태에 직접 병합하므로 남이 쓴 댓글도 전체 새로고침 없이 곧바로 보입니다.
- **본문 스냅샷이 더 최신 댓글을 되돌리면 안 됩니다.** 글 수정 이벤트가 카드 스냅샷을 보내더라도 클라이언트에 이미 도착한 댓글·첨부·내 반응 컬렉션은 보존합니다. 낮은 글 `version`의 늦은 이벤트도 버립니다.
- **상세 화면의 `ThreadedComments`를 카드에 그대로 넣지 않았습니다.** 넓은 상세 영역용이라 230px 카드에서는 이름이 잘리고 카드 높이가 과도하게 늘어납니다. 카드는 좁은 폭 전용 표시와 작성기를 쓰고 멘션 자동완성·수정은 상세 화면에 둡니다. 댓글이 늘면 카드가 그만큼 길어지며 카드 안에 별도 스크롤 영역은 만들지 않습니다. 긴 문자열은 `overflow-wrap: anywhere`, 사용자 줄바꿈은 `pre-wrap`으로 처리합니다. HTTP(S) 주소만 안전한 새 탭 링크로 만들고 HTML은 해석하지 않습니다.
- **모바일 시트는 카드 DOM이나 레이아웃 뷰포트를 기준으로 삼지 않습니다.** 카드·섹션의 dnd-kit `transform` 아래에 fixed 요소를 두면 카드가 위치 기준이 되므로 공용 `Modal bottom` 변형을 `document.body` 포털로 렌더합니다. 게시물 작성기와 같은 `visualViewport.height`·`offsetTop`을 `resize`·`scroll`마다 반영해 화면 전체의 키보드 바로 위에 시트를 붙입니다. 입력은 한 줄에서 최대 132px까지 자라고 그 뒤에만 내부 스크롤합니다.
- **댓글 첨부는 게시물 첨부와 다른 배열입니다.** 로그인 사용자는 이미지·음성·PDF, 손님은 이미지만 댓글당 4개까지 올립니다. 카드 DTO와 `commentAttachment` SSE 델타가 `commentId`를 함께 보내며 `reconcile-sections.ts`는 해당 댓글에만 생성·수정·삭제를 합칩니다.
- **댓글 영역은 카드의 클릭·드래그를 먹습니다.** 카드 자체가 드래그 손잡이이자 "글 열기" 버튼이라, 그대로 두면 글자를 끌어 선택할 때 카드가 따라오고 모바일에서 입력창을 길게 누르면 드래그가 시작됩니다.
- **표(TABLE) 레이아웃에서는 붙이지 않습니다.** 카드가 한 칸에 들어가고 옆으로 열이 이어지는 구조라 입력창이 행 전체를 흔듭니다.
- **댓글 수는 한 곳에서만 말합니다.** 댓글 영역이 붙으면 카드 바닥의 숫자를 뺍니다(`postCommentsVisible`가 두 곳의 판정을 하나로 유지합니다).

### 문서 미리보기(PDF·한글)

첨부를 내려받지 않고 그 자리에서 넘겨 봅니다.

1. 형식 판정은 `components/pad/attachments/file-kind.ts` 한 곳입니다. `Attachment.type`만으로는 한글·워드·PPT·엑셀·ZIP이 전부 DOCUMENT/FILE로 뭉쳐지므로 **확장자를 먼저** 보고 MIME으로 보완합니다.
2. PDF는 `pdfjs-dist`로 캔버스에 그립니다(`pdf-viewer.tsx`). 한글(HWP·HWPX)은 `@rhwp/core`(Rust+WASM)가 쪽마다 SVG를 만듭니다(`hwp-viewer.tsx`).
3. 둘 다 화면에서 동적으로 부르고, 실행 자산은 `public/pdfjs/`·`public/rhwp/`에서 같은 출처로 받습니다(`scripts/sync-viewer-assets.mjs`).

전제 몇 가지입니다.

- **iframe을 쓰지 않습니다.** 예전에는 PDF가 `<iframe src="/f/…">` 하나였는데 화면에 아무것도 뜨지 않았습니다 — 파일 응답에 `X-Frame-Options: DENY`(next.config.ts)와 `frame-ancestors 'none'`(proxy.ts)이 붙어 같은 출처인데도 프레임이 막히기 때문입니다. pdf.js는 바이트를 fetch해 캔버스에 그리므로 **그 보안 헤더를 그대로 두고** 뷰어를 만들 수 있고, iOS Safari가 iframe 속 PDF의 첫 쪽만 보여 주는 문제도 없습니다.
- **CSP에 `'wasm-unsafe-eval'`과 `worker-src 'self'`가 필요합니다.** 앞의 것은 WebAssembly 컴파일만 허용하고 eval·new Function은 그대로 막습니다(`'unsafe-eval'`과 다릅니다). 없으면 pdf.js의 JBIG2·JPEG2000 디코더와 rhwp가 컴파일 단계에서 막힙니다.
- **자산은 저장소에 커밋하지 않습니다.** 합쳐 12MB라 설치·빌드 때 복사하고(.gitignore), 복사본에 버전을 적어 패키지를 올리면 자동으로 다시 만듭니다.
- **지연 로딩을 실제로 확인했습니다.** 목록 화면은 뷰어 자산을 0건 받고, PDF 글은 pdf.js 워커만, 한글 글은 rhwp WASM(6.9MB)만 받습니다.
- **rhwp SVG는 주입 전에 한 번 거릅니다.** 지금 출력에는 스크립트도 이벤트 핸들러도 없지만(확인함), 문서 내용이 흘러드는 출력이라 `<script>`와 `on*`을 제거한 뒤 넣습니다.
- **오피스 문서(pptx·docx·xlsx)는 서버가 PDF로 바꿔 같은 뷰어로 봅니다.** 브라우저용 pptx 렌더러는 마스터·레이아웃·임베드 폰트를 못 살려 수업 자료로 쓰기 어렵습니다. 변환은 `/f/[id]?variant=preview`에서 하고(권한 검사가 원본과 같은 자리에 있어 두 벌로 갈라지지 않습니다), 결과는 원본 옆 `<저장명>.preview.pdf`로 캐시합니다.
- **변환기는 선택입니다.** LibreOffice가 없으면 그 경로가 501을 돌려주고 화면은 내려받기 카드로 되돌아갑니다 — 기능이 없다고 앱이 실패하지 않습니다. `SOFFICE_PATH`로 실행 파일을 지정할 수 있습니다.
- 신뢰할 수 없는 업로드를 큰 변환기에 넣는 경로라 울타리를 칩니다: 시간 제한(90초), 동시 실행 1개, 입력 60MB, 단일 실행(동시 5요청으로 확인), HOME 격리.
- **변환 전에 외부 참조를 잘라 냅니다**(`lib/files/office-sanitize.ts`). 원격 이미지를 가리키는 docx를 넣으면 LibreOffice가 그 주소를 **서버에서** 실제로 가져오고(SSRF), 가져온 내용은 결과 PDF에 박혀 업로더에게 돌아옵니다. `file:///…`이면 서버 로컬 파일이 실려 나갑니다. 둘 다 이 저장소에서 실제로 재현하고 막은 뒤 다시 재현해 차단을 확인했습니다. OOXML의 바깥 참조는 전부 `*.rels`의 `TargetMode="External"`로 모이므로 그 길목을 끊습니다.
- rels를 거치지 않는 경로(필드 코드 등)는 변환기 프로필의 **죽은 프록시**(http·https·ftp를 127.0.0.1:1로)로 함께 막습니다. LibreOffice의 "링크 갱신 안 함" 설정은 시험해 보니 듣지 않았습니다.
- **PDF 안의 자바스크립트는 실행되지 않습니다.** pdf.js의 스크립팅은 기본이 꺼짐이고 우리는 켜지 않습니다(별도 샌드박스 모듈이 있어야 동작합니다).
- 첨부를 브라우저에 인라인으로 돌려주는 MIME은 `application/pdf`와 image·video·audio뿐이고 나머지는 전부 내려받기로 나갑니다 + `nosniff`. 저장형 XSS의 기본 방어선입니다.

### 게시물 승인

1. 승인 모드에 따라 새 글은 `PENDING` 또는 `PUBLISHED`가 된다.
2. `PadModerationQueue`가 pending-posts를 읽고 moderate API를 호출한다.
3. API는 `Post.status`, `POST_MODERATED` 활동, 작성자 개인 알림을 함께 남긴다.
4. 보드 SSE는 게시물 변경을, 사용자 SSE는 알림 벨 갱신 신호를 전달한다.

### 접근 요청과 초대

- 접근 요청: `PadAccessGate` → access-requests POST → 관리자 설정 패널 GET/PATCH → 승인 시 `BoardMember` 생성·요청 상태 변경·활동·알림.
- 초대 링크: 관리자가 해시 토큰 생성 → 사용자가 `/i/[token]`에서 확인 → 버튼으로 redeem POST → 멤버·팔로우 생성. 페이지 진입만으로 자동 참여하지 않는다.

### 학생 가입과 교사 승인

1. 카카오는 검증 이메일이 DB에 없을 때, 일반 회원가입은 `loginId`·비밀번호 검증을 통과했을 때 소속 없는 `STUDENT`, `registrationApprovalStatus = PENDING`, `onboardingCompletedAt = null` 사용자로 생성한다. 일반 계정은 salt+scrypt 해시만 저장하며 관리자 부트스트랩 권한을 자동 부여하지 않는다.
2. 전체관리자가 가입 승인 대기열에서 계정을 승인해야 프로필 온보딩으로 넘어간다. 대기·반려 계정은 공개 `marketing`·`play` 구역에서는 게스트로 낮춰 패드·퀴즈·설문 공개 참여를 막지 않지만 회원 전용 API는 사용할 수 없다.
3. 학생 선택은 학교의 `CLASS`인지 확인한 뒤 사용자 소속과 완료 시각을 저장한다.
4. 교사 선택은 학교의 `DEPARTMENT`인지 확인하고 실제 역할을 바꾸지 않은 채 `TeacherApprovalRequest(PENDING)`만 저장한다. 해당 학교 대표교사와 전체관리자에게 알림을 보낸다.
5. 전체관리자 또는 같은 학교 대표교사가 승인하면 신청 상태, `TEACHER` 역할, 학교·부서, 완료 시각과 감사 로그를 한 트랜잭션에 저장한다. 반려하면 자동 생성한 처리 설명과 함께 `REJECTED`로 바꾸고 재신청 화면으로 보낸다.
6. 두 승인 대기열은 행 클릭·Shift 범위 선택·현재 페이지 전체선택으로 여러 요청을 모아 한꺼번에 승인할 수 있고, 개별 승인·반려도 별도의 사유 입력 없이 확인 모달만 거친다.
7. 대기 화면의 NextAuth 세션 갱신과 다음 로그인은 DB 상태를 다시 읽으므로 브라우저가 끊겨도 승인 결과가 유지된다.

### 관리자 학생 명단과 최초 비밀번호

1. 전체관리자 또는 학교 대표교사가 `학생 계정 발급`에서 학교·학년·반·번호·이름 XLSX와 접두어를 제출한다. 대표교사는 자기 학교 이름만 사용할 수 있다.
2. 미리보기와 등록 요청은 각각 파일을 서버에서 다시 파싱한다. 3MB·500명·수식 금지·숫자 범위·파일 내부와 DB 아이디 중복을 검사한다.
3. 등록 시 scrypt 초기 비밀번호 해시를 먼저 계산하고, 학교 → `SchoolGrade` → `SchoolGroup(CLASS)`와 `User(STUDENT)`를 직렬화 트랜잭션으로 생성한다. 하나라도 충돌하면 일부 계정을 남기지 않는다.
4. 접두어는 1~10자 영문자·숫자만 허용한다. `{접두어}{학년}{반 2자리}{번호 2자리}` 로그인 아이디와 아이디와 동일한 초기 비밀번호는 응답·CSV에서 한 번만 관리자에게 제공하며 초기 비밀번호는 DB·감사 로그에 평문으로 저장하지 않는다. (예전 `{이름 첫 글자}{학생 코드}` 초기 비밀번호는 한글이 섞여 로그인 불가 사고로 폐기. 양식 파일명은 브랜딩 없는 `forms.xlsx`.)
5. `mustChangePassword` JWT는 `/change-password`와 변경 API만 열어 준다. 새 비밀번호는 일반 가입과 같은 규칙을 통과해야 하며, 성공하면 `authVersion`을 올려 모든 기기의 기존 세션을 끊는다.
6. 관리자는 사용자 상세 작업에서 Credentials 계정을 무작위 임시 비밀번호로 초기화할 수 있고, 같은 강제 변경·세션 해제·감사 기록 흐름을 사용한다.

### 학교 대시보드·대표교사·반 이동

1. `SchoolDashboard`는 `getSchoolDirectory()`가 학교별 학생·교사·학급 수와 번호/학급 미지정 학생을 집계해 그립니다.
2. `SchoolManager`는 학교 아래에서 학년→반과 교사 부서를 분리해 보여주고, 전체관리자에게 대표교사 지정·해제 UI를 제공합니다.
3. 대표교사 변경은 일반 사용자 PATCH를 재사용하되 전체관리자만 허용하고, 활성 교사·학교 소속을 서버에서 다시 검증해 감사 로그와 함께 저장합니다. 정지·교사 역할 이탈·학교 이동·삭제 시 자동 해제합니다.
4. 사용자 목록에서 학생만 선택하면 반 이동 작업이 열립니다. 서버는 대표교사의 기존 학교와 도착 학교 범위를 모두 확인하고, 학교 advisory lock 안에서 빈 출석번호를 확정합니다.
5. 전출·재적 상태·담임·정원·학년도 진급은 현재 제품 범위에 없어 UI·API와 관련 DB 컬럼을 제거했습니다.

### 실시간 처리

```text
쓰기 API 성공
├─ publishBoardEvent(boardId)
│  └─ /api/boards/[id]/events → usePadEvents
│     ├─ 글·댓글·첨부·반응·섹션: 엔티티 델타 로컬 병합
│     ├─ 드래그 중: 같은 델타를 낙관 배열에도 병합
│     └─ 재연결·권한 변경만 realtime-snapshot JSON으로 수렴
└─ createNotification(userId)
   └─ publishUserEvent → /api/notifications/events → NotificationBell 재조회

LIVE 퀴즈 Socket.IO
├─ session:{id} → 호스트·학생 공용 문항/공개/순위/종료
├─ session:{id}:hosts → 참여자 델타/답안 수/진행 중 참여형 집계
├─ session:join ACK → 현재 단계 + 재접속 정본(호스트는 명단 포함)
└─ student:submit-answer → 현재 문항 1회 조회·검증·채점 → 호스트 집계 예약
```

업로드 파일 바이트 자체는 SSE나 WebSocket으로 전송하지 않는다. 보드 SSE는 변경된 카드/댓글/첨부 메타데이터와 위치 patch만, 알림 SSE는 작은 변경 신호만 전달한다. 이벤트 버스는 프로세스 내부 `EventEmitter`이므로 현재는 단일 앱 인스턴스가 전제다.

발행은 동기 `emit`이라 구독자 쪽 예외가 발행자(쓰기 API)까지 올라간다. `lib/realtime/sse-stream.ts`가 모든 전송을 감싸 이 경로를 끊고, 동시에 연결 수 상한(사용자·보드당 6, 학교 NAT를 고려한 익명 보드/IP 버킷 240, 프로세스 전체 `MAX_SSE_CONNECTIONS`)과 백프레셔 종료를 함께 강제한다. 상한을 넘은 새 연결은 429로 거절하며 기존 연결은 유지된다.

공개 범위·멤버처럼 접근 결과가 달라질 수 있는 이벤트 뒤에는 기존 SSE를 종료해 다음 연결에서 권한을 다시 검사한다. 멤버 초대·역할·제거 이벤트는 요청자·대상자·관리자에게만 보내므로 학생 한 명의 변경 때문에 같은 패드의 모든 학생이 스냅샷을 조회하지 않는다.

LIVE 퀴즈는 양방향 명령이 필요해 Socket.IO를 사용한다. 참여자 입·퇴장 때 호스트가 REST 세션 전체를 다시 읽지 않고 완성된 참가자 델타를 병합하며, 입장 ACK를 기다리는 동안 먼저 온 델타는 ID별로 보존해 늦은 스냅샷이 UI를 되돌리지 못하게 한다. 동시에 입장하거나 답을 제출한 100명은 진행 중인 세션 전문·현재 문항·플랫폼 정책 조회 Promise를 공유하고, 완료된 세션 객체 자체는 캐시하지 않아 다음 단계 변경을 가리지 않는다. 공개 소켓은 학교 NAT를 고려해 IP당 기본 200개, 참가자당 3개, 프로세스 전체 500개의 서로 다른 상한을 적용한다.

## 8. 데이터 모델 관계

```text
User
├─ 소유 Board / BoardMember
├─ BoardFollow / BoardFavorite / BoardVisit
├─ DashboardFolder ─ DashboardFolderBoard ─ Board
├─ Notification
├─ UserSystemPermission
├─ AdminAuditLog
└─ TeacherApprovalRequest ─ School / SchoolGroup(DEPARTMENT) / 검토 User

학교 소속
└─ School
   ├─ code / level / district / academicYear / operatingStatus
   ├─ SchoolGrade ─ SchoolGroup(CLASS: displayName / capacity / homeroomTeacher) ─ User.studentNumber
   └─ SchoolGroup(DEPARTMENT)

인증 보안
├─ User.loginIdentifierLookup / nameLookup: 원문 없는 고유 HMAC 조회 키
├─ AuthRateLimit: IP·계정·IP+계정별 만료 제한 상태
└─ AuthSecurityEvent: 시간대별 성공·실패·제한 집계(90일 보존)

Board
├─ guestPostsRequireApproval: 손님 글을 승인 후 공개할지
├─ passwordHash(scrypt, 방문자 검증) / passwordEncrypted(AES-GCM, 소유자 재확인)
├─ Section ─ Post
│            ├─ authorId(계정) XOR guestId+guestName(손님) — DB CHECK로 강제
│            ├─ Attachment (uploaderId XOR guestId — 같은 규칙)
│            ├─ Comment (authorId XOR guestId+guestName — 같은 규칙) ─ CommentMention / 댓글 Attachment
│            └─ Reaction
├─ BoardMember / BoardAccessRequest
├─ BoardInviteLink
├─ BoardActivity
└─ BoardFollow / BoardFavorite / BoardVisit

Subject (owner: User)
├─ Quiz[] (선택적 subjectId)
├─ Board[] (선택적 subjectId)
├─ Form[] (선택적 subjectId)
└─ SubjectStudent[] ─ student User / assignedBy User

Activity (type: QUIZ_SESSION | PAD_BOARD | FORM)
├─ QuizSession.activityId (필수·unique)
├─ Board.activityId (필수·unique)
└─ Form.activityId (필수·unique)

ShortLink
├─ slug: 전역 고유 `/go/{slug}` 별칭
├─ targetType: BOARD | QUIZ_SESSION | FORM
├─ boardId / quizSessionId / formId 중 대상에 맞는 하나 또는 영구 삭제 뒤 모두 null(DB CHECK)
├─ disabledAt: 연결 해제·변경·퀴즈 마감 시각; 행과 slug 예약은 유지
└─ 대상별 활성 행 하나(부분 unique) + 전역 slug unique; 대상·생성자 삭제 시 FK만 SetNull

Form (owner: User)
├─ slug: 공개 응답 주소 /s/{slug}. 제목이 아니라 무작위 — 주소가 내용을 알려 주면 안 된다
├─ status: DRAFT(링크 죽음) / OPEN(응답 받음) / CLOSED(안내만)
├─ FormField[] — 유형별 nullable 열을 가진 넓은 표 하나(Question과 같은 전략)
│   └─ FormFieldOption[] (그리드에서는 **열**. 행은 FormField.gridRows 배열)
├─ FormResponse[]
│   ├─ respondentId(로그인) 또는 guestTokenHash(익명 쿠키 sha256)
│   ├─ dedupeKey + @@unique([formId, dedupeKey]) — 1인 1응답을 DB가 막는다
│   └─ FormAnswer[] (fieldId는 RESTRICT — 응답 달린 질문을 실수로 못 지운다.
│       fieldType·fieldTitle·selectedOptionTexts·gridValue[].rowLabel은 응답 시점 스냅샷)
├─ FormShare[] (QuizShare 복사본: userId + permission(VIEWER|EDITOR) + grantedById)
└─ Notification[] (formId, type: FORM_SHARED)
```

- `deletedAt`은 보드·섹션·글·댓글의 7일 복구 가능한 숨김 상태다. 첨부는 삭제 즉시 파일과 행을 지우며, 실패 시에만 `deletedAt` 행을 재시도 표식으로 남긴다. 서버는 시작 1분 뒤와 이후 7일마다 만료 휴지통과 실패 파일을 정리한다.
- `Board.state`와 `freezeAt`은 쓰기 동결이며 보관 상태가 아니다.
- `Notification`은 개인 수신함, `BoardActivity`는 보드 공용 타임라인이다.
- `BoardFollow`는 활동 알림 구독, `BoardFavorite`은 사용자가 직접 저장한 즐겨찾기, `BoardVisit`은 실제 최근 방문 시각이다.
- `ShortLink`는 콘텐츠별 하나, 별칭별 하나만 존재한다. 공개 식별자를 짧게 만드는 테이블이지 접근 역할이나 만료 전용 토큰이 아니므로 실제 권한은 리다이렉트된 대상 라우트가 판정한다.
- 일반 아이디 또는 카카오 이메일인 로그인 식별자와 이름·프로필 URL은 암호문으로, 중복 판정용 로그인 식별자·닉네임은 목적별 HMAC으로, 일반·초기·임시 계정 비밀번호는 salt+scrypt 단방향 해시로 저장하고 Client Component에는 목적별 DTO만 전달한다. 초기·임시 평문은 발급 응답에서만 한 번 전달한다.
- `TeacherApprovalRequest`는 승인 전 희망 학교·부서를 보관하고, 승인 시에만 실제 `User.role/schoolId/schoolGroupId`로 연결한다.
- 설문의 **1인 1응답은 응용 코드가 아니라 DB가 막는다.** `allowMultipleResponses`가 false일 때만 `dedupeKey`에 `u:{respondentId}` 또는 `g:{guestTokenHash}`를 넣고 true면 null을 넣는데, PostgreSQL이 유니크 인덱스에서 null을 서로 다르게 보므로 제약 하나가 두 정책을 다 표현한다. "조회했더니 없어서 만들었다"는 동시 요청을 막지 못하고, 설문 링크는 단톡방에 뿌려지므로 실제로 동시에 온다.
- 서명 입력은 `signature_pad`의 캔버스 보간을 쓰지만 저장은 이미지 파일이 아니라 `FormAnswer.signatureStrokes`의 **0~1 정규화 좌표 + 선택적 압력·상대 시간 JSON**이다. 기존 `{x,y}` 데이터도 호환되며, 래스터로 둘 때 필요한 저장소 한도·정리 스위퍼·열람 권한 검사가 없다.
- **설문을 통째로 지울 때는 답변을 먼저 지운다.** `FormAnswer.fieldId`가 RESTRICT라 활동만 지우면 `Activity → Form → FormField` cascade가 그 제약에 걸려 통째로 실패한다(P2003). 순서는 `scripts/fixtures.ts`의 `deleteFormFixture()`가 정본이다.
- `SubjectStudent`는 학생과 교과목의 다대다 명부다. 퀴즈 풀이 할당(`QuizAssignment`)과는 별개이므로 교과목 배정만으로 퀴즈 세션이 자동 배포되지는 않는다.
- 학생 학급은 `SchoolGrade`와 반 번호로 정규화하고, 출석번호는 `User.studentNumber`, 강제 비밀번호 변경 여부는 `User.mustChangePassword`가 보관한다.
- 학생 번호 변경은 `(schoolGroupId, studentNumber)` 고유 제약과 API의 선행 충돌 검사로 같은 반 중복을 막는다. 번호만 바꿀 때는 권한·소속 변화가 아니므로 학생 세션 버전을 올리지 않고, 변경 전후 값과 화면이 자동 생성한 작업 설명은 감사 로그에 남긴다.

## 9. 저장소와 운영 전제

- PostgreSQL 스키마는 `prisma/schema/**`(도메인별 멀티파일), 이력은 `prisma/migrations/**`, 생성 타입은 `generated/prisma/**`에 있다.
- 교과목 확장 마이그레이션은 `20260809000000_expand_subjects_to_courses`이며 `Board.subjectId`와 `SubjectStudent`를 추가한다.
- 설문 도메인 마이그레이션은 `20260811000000_form_domain`이며 `Form`·`FormField`·`FormFieldOption`·`FormResponse`·`FormAnswer`·`FormShare`와 `ActivityType.FORM`을 추가한다.
- 패드 비밀번호 재확인 마이그레이션은 `20260824010000_add_board_password_encrypted`이며 기존 `passwordHash`를 건드리지 않고 nullable `passwordEncrypted`를 추가한다. 과거 패드는 다음 비밀번호 변경 때 암호화본이 채워진다.
- 짧은 주소 마이그레이션은 `20260825010000_add_short_links`이며 `ShortLinkTargetType`·`ShortLink`와 전역 slug/대상별 고유 인덱스, 대상 하나만 연결하는 CHECK, 대상 삭제 cascade를 추가한다.
- 짧은 주소 보안 마이그레이션은 `20260825020000_harden_short_links_and_board_password`이며 `disabledAt`, 활성 대상별 부분 unique, FK `SET NULL`, nullable 생성자를 적용해 변경·삭제·마감 뒤에도 slug를 예약한다. `BOARD_PASSWORD_VIEWED` 감사 액션도 함께 추가한다.
- **이 서버의 DB 사용자에게는 데이터베이스 생성 권한이 없어 `prisma migrate dev`가 shadow DB를 못 만든다(P3014).** 마이그레이션 SQL은 `prisma migrate diff --from-config-datasource --to-schema prisma/schema --script`로 뽑아 주석을 달고, 적용은 `prisma migrate deploy`로 한다. 기존 마이그레이션이 전부 손으로 쓰인 이유이기도 하다.
- 첨부와 아바타는 오브젝트 스토리지 없이 `UPLOAD_DIR`의 로컬 영구 디스크를 사용한다. DB와 파일 백업을 함께 해야 한다.
- 라이브 퀴즈 오디오도 `UPLOAD_DIR/system/quiz-live-audio`의 로컬 파일이다. Socket.IO에는 음원을 싣지 않고 단계 이벤트만 보내며, 각 브라우저가 버전 URL을 HTTP range/immutable 캐시로 받는다. 수업 중 관리자 교체가 기존 range를 끊지 않도록 이전 revision은 최근 14개까지만 유예하고 상한 밖 파일을 정리한다. N100 단일 서버에서는 MP3/M4A를 낮은 비트레이트로 압축하고 앞단 프록시의 정적 캐시를 활용해야 첫 재생 때 100명이 같은 원본을 동시에 내려받는 대역폭을 줄일 수 있다.
- 파일·SSE 구조 때문에 현재 운영은 단일 앱 인스턴스가 기준이다. 다중 인스턴스로 갈 때는 공유 파일 저장소와 Redis 또는 PostgreSQL pub/sub 계층이 필요하다.
- 인증 속도 제한은 `AuthRateLimit`에 저장하므로 앱 재시작·다중 인스턴스에서도 공유된다. Vercel의 위조 방지 헤더 외 프록시 전달 IP는 `.env.example`의 신뢰 옵션을 명시적으로 켠 배포에서만 사용하며, 운영에서는 WAF의 인증 경로 IP 제한도 함께 둔다.
- 일반 회원가입은 항상 `STUDENT`를 만들고 `BOOTSTRAP_SUPER_ADMIN_EMAIL`을 선점할 수 없다. 해당 이메일의 최초 전체관리자 승격은 카카오가 검증한 이메일 경로에서만 일어난다.
- 학생 명단 등록은 최대 500개의 고비용 scrypt 연산을 수행할 수 있어 해당 관리자 Route Handler만 `maxDuration = 300`을 선언한다. 실행 환경의 함수 시간 한도가 더 짧으면 학년 단위 파일로 나누거나 장기 작업 큐로 옮겨야 한다.
- 쓰기 API는 일반적으로 same-origin, 요청량 제한, 활성 세션, Zod 입력, 최신 대상 소속, capability, 동결 상태 순서로 검사한다. 단, 학교 NAT에서 정상 사용자를 공유 IP로 묶지 않기 위해 인증이 필요한 제한은 세션 확인 뒤 사용자 ID를 키로 삼고, 인증·가입 경로는 비싼 계정 조회·해시보다 제한 검사를 앞세운다. 공개 JSON과 문서 전체 저장은 `readJsonWithLimit`으로 실제 스트림 크기를 제한한다.
- 요청량 제한은 두 겹이다. `proxy.ts`가 `/api/auth/*` 밖의 모든 쓰기 메서드에 계정(또는 신뢰 IP)당 분당 200회 백스톱을 걸고, 비용이 큰 라우트는 더 좁은 상한을 둔다(`lib/security/overview.md`에 목록). `/go`도 신뢰 IP별 240회/분과 프로세스 전체 DB 조회 동시성 상한을 적용한다. 인증 경로는 `AuthRateLimit` DB 제한이 이미 더 촘촘하므로 백스톱에서 제외한다. 신뢰할 수 있는 IP를 얻을 수 없는 배포에서는 익명 제한을 걸지 않는다 — 그 구간과 분산 공격은 WAF 몫이므로 운영 Cloudflare에도 `/go/*`와 공개 비밀번호 확인 경로의 IP 제한을 둔다.
- 공개 퀴즈 소켓의 IP별 기본 상한은 학교 NAT의 100명 수업과 순간 재연결을 고려한 200이다. 이 값만 무제한으로 풀지 않고 참가자별 3개 탭과 프로세스 전체 500개 상한을 함께 유지해 N100의 연결 수를 보호한다. 정책 캐시는 30초지만 동시 첫 조회는 한 Promise로 합치고, DB가 일시 실패해 쓴 기본값은 캐시하지 않아 다음 요청이 복구를 바로 확인한다.
- CSP의 `connect-src`는 `'self'`에 더해 `APP_ORIGINS`에서 뽑은 호스트의 `ws://`·`wss://`를 허용한다. 퀴즈 실시간 계층(Socket.IO)이 폴링으로 시작해 WebSocket으로 업그레이드하는데, `'self'`는 브라우저마다 ws 스킴으로 해석되지 않아(w3c/webappsec-csp#7) 업그레이드만 막히고 Socket.IO가 조용히 롱폴링으로 되돌아간다 — 기능은 살아 있고 지연·부하만 늘어 알아채기 어렵다. `ws: wss:`처럼 스킴 전체를 열면 임의 호스트로의 유출 채널이 되므로 CSRF 검사에 이미 쓰는 오리진 목록에서 호스트만 파생시킨다.
- 보안 응답 헤더 중 CSP만 `proxy.ts`가 요청마다 새 nonce와 함께 발급하고, 나머지 고정 헤더(HSTS·X-Frame-Options·nosn·Referrer-Policy·Permissions-Policy)는 `next.config.ts`가 프록시 매처 밖 경로까지 덮는다. nonce는 Next.js가 주입하는 부트스트랩·플라이트 스크립트에 프레임워크가 자동 적용한다. 앱이 직접 렌더링하는 인라인 스크립트는 두지 않으며, 테마는 `pyxis-theme` 쿠키를 `app/layout.tsx`가 읽어 서버 HTML의 `data-theme`로 렌더링한다.
- 상세 정책을 바꿀 때는 `UI → Route Handler → lib 도메인 모듈 → Prisma/파일 → 활동·알림·SSE` 순서로 영향 범위를 확인한다.

## 10. 기능을 찾는 빠른 기준

| 바꾸려는 것 | 먼저 볼 파일 |
|---|---|
| 공개 홈·로그인 진입 | `app/page.tsx`, `components/landing/*`, `components/home/home-actions.tsx` |
| 통합 대시보드·교과목·학생 배정 | `app/(workspace)/dashboard/page.tsx`, `components/dashboard/course-manager.tsx`, `lib/subjects/course-dashboard.ts`, `app/api/subjects/**` |
| 내 패드·역할별 노출 | `app/(workspace)/pad/page.tsx`, `components/home/*`, `lib/dashboard/*` |
| 보드 접근 정책 | `lib/board/permissions.ts`, `lib/auth/authorization.ts`, `lib/board/queries.ts` |
| 보드 화면 상호작용 | `components/pad/pad-canvas.tsx`, 하위 패널·레이아웃 |
| 게시물 입력 계약 | `components/pad/post-composer.tsx`, `components/pad/composer/markdown-editor.tsx`, section posts API, `lib/post-fields/*` |
| 댓글·반응 | `post-detail.tsx`, comments/reactions API, notifications |
| 첨부 파일 | attachments API, `lib/files/*`, `/f/[attachmentId]` |
| 실시간 갱신 | 패드·알림: `use-pad-events.ts`, events Route Handler / LIVE 퀴즈: `lib/realtime/socket-server.ts`, `host-session.tsx`, `play-session.tsx` |
| 관리자 권한·학생 명단 | `app/admin`, `components/admin/*`, `app/api/admin/*`, `lib/users/student-roster.ts`, `lib/auth/*` |
| 최초 가입·교사 승인 | `app/(auth)/onboarding`, `app/(auth)/approval-pending`, `app/api/onboarding`, `app/api/admin/account-approvals`, `app/api/admin/teacher-approvals`, `lib/users/registration-approvals.ts`, `lib/users/teacher-approvals.ts` |
| 사람이 입력하는 짧은 주소 | `components/share/short-link-manager.tsx`, `app/api/short-links`, `lib/short-links`, `app/(play)/go/[slug]` |
| 색·디자인 토큰 | `app/globals.css`(팔레트·`@theme`·`@layer base` 리셋), 5장 |
| 카드 크기·격자 | `app/globals.css`의 `--card-min-h`/`--card-cover-h`, `components/home/pad-dashboard.module.css`, `components/quiz/quiz-library.tsx` |
| 설문 질문 유형·응답 확인 | `lib/forms/field-types.ts`, `lib/forms/validation.ts`, `components/forms/field-card.tsx` |
| 설문 저장·발행 규칙 | `lib/forms/save.ts`, `app/api/forms/**`, `lib/forms/access.ts` |
| 편집기 자동 저장·드래그 정렬 | `lib/editor/*` — 퀴즈 편집기와 설문 편집기가 함께 쓴다 |
| DB 변경 | `prisma/schema/**` → `migrate diff`로 SQL 생성 → 주석 달아 `prisma/migrations/**` → `migrate deploy` → `generated/prisma/**` |

새 폴더나 기능을 추가하면 해당 폴더의 `overview.md`와 이 문서의 관련 흐름이 실제 구현과 계속 맞는지 함께 확인한다. 작업이 끝날 때마다 `mdFiles/report.md`의 작업 현황도 갱신한다 — 문서 갱신은 검증(`lint`·`tsc`·`verify:*`·`build`)과 같은 급의 마무리 단계다.
