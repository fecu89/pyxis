# 대시보드 데이터 개요

이 폴더는 홈 Server Component에 전달할 사용자별 보드 요약을 구성한다. `lib/board/queries.ts`의 기존 공개·내 보드·보관함 조회를 재사용하고, 대시보드 전용 관계와 상태만 추가한다.

- `BoardVisit`·`QuizVisit`·`FormVisit`의 `lastVisitedAt`을 실제 최근 방문 시각으로 사용한다. 각 콘텐츠의 읽기 권한을 통과한 로그인 사용자가 상세·편집·응답 관리 화면을 열면 `after()`에서 upsert한다. 기능별 사이드바에는 최신순 최대 6개, 메인 대시보드에는 세 종류를 합쳐 최신순 최대 8개를 전달한다. 생성·수정 시각은 최근 방문 순서에 영향을 주지 않는다.
- 현재 사용자가 소유한 보드는 `OWNED`, 멤버십으로 참여한 보드는 `SHARED`, 전역 `VIEW_ALL_BOARDS` 권한으로만 보이는 보드는 `MANAGED`, 즐겨찾기나 폴더에만 저장한 접근 가능 보드는 `SAVED`로 분리한다.
- `DashboardBoard.canWritePosts`는 시스템 권한, 멤버 역할, `allowMemberPosting`, 공개 범위와 비멤버 `visitorPermission`을 실제 게시물 작성 정책과 같은 순서로 계산한다. `lib/board/visitor-policy.ts`를 공유해 LINK/PUBLIC의 명시적 WRITER 설정을 반영하고, 홈은 이 값으로 글쓰기 가능/보기 전용을 구분한다. PRIVATE와 과거 LINK/loginRequired=true는 방문자 쓰기를 열지 않는다.
- `BoardFavorite`, 알림 구독용 `BoardFollow`, 방문 이력 `BoardVisit`은 서로 독립적이다. 즐겨찾기한 보드는 홈의 즐겨찾기 필터에 표시되며, 접근 권한을 잃으면 데이터는 남아 있어도 DTO에서 제외된다.
- `DashboardFolder` 이름은 NFKC·공백 정리·소문자 `nameKey`로 사용자 안에서 중복을 막는다. `DashboardFolderBoard`는 다대다 연결이라 한 보드를 여러 폴더에 넣을 수 있고, 폴더를 지워도 보드나 즐겨찾기는 삭제하지 않는다.
- 즐겨찾기·폴더에 저장한 보드는 조회 시점에 최신 발견 범위·멤버십·전역 권한과 보드 전용 비밀번호 쿠키를 다시 확인한다. 저장 행 자체는 보드 읽기 권한을 부여하지 않는다.
- `BoardAccessRequest`의 `PENDING`·`REJECTED` 상태를 사용자 본인에게만 전달한다. 승인된 요청은 멤버십 보드 목록으로 이동하므로 요청 목록에서 제외한다.
- 읽을 수 있는 공개 템플릿과 본인이 관리하는 템플릿을 별도 갤러리 DTO로 전달한다. 템플릿 여부도 보드 읽기·관리 권한을 대신하지 않는다.
- 소유자 개인정보는 기존 공개 작성자 DTO로만 복호화하며 암호문·로그인 식별자는 대시보드 DTO에 포함하지 않는다.
- 검색·정렬·탭 전환은 이미 서버 권한으로 필터링된 최소 DTO를 클라이언트에서 처리한다. 이 UI 필터는 서버 권한 검사를 대신하지 않는다.
