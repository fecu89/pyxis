# Overview

이 폴더는 pyxis 구현에서 `lib/board` 영역을 담당합니다.

`activity.ts`는 `BoardActivity`(보드별 활동 로그) 기록과 `BoardFollow`(자동 팔로우) 추가·해제를 담당합니다. 보드 생성·멤버 추가·접근 요청 승인 시 자동으로 팔로우가 걸리고, 게시물 생성·수정·삭제, 댓글 작성, 멤버 참여, 접근 요청 처리마다 활동이 기록됩니다. 개인화된 "나에게 온" 알림(`Notification`)은 `lib/notifications/create.ts`가 별도로 담당하며, 이 활동 로그와는 독립적인 트리거로 만들어집니다(활동 = 보드 전체의 타임라인, 알림 = 나에게 온 항목만).

`member-candidates.ts`는 새 패드 생성과 기존 패드 설정이 공유하는 초대 후보 정책입니다. 전체관리자(SUPER_ADMIN)는 소속 학교가 없어도 전체 활성 사용자, 교사·관리자는 같은 학교, 학생은 같은 학급의 활성 사용자만 최대 20명씩 보여 주며 로그인 식별자는 검색에만 복호화한 뒤 응답에서 마스킹합니다. 새 패드 생성은 교과목 이름(`subjectName`)을 요청자 소유 교과목으로 upsert해 연결하고, 멤버가 이 범위 안에 있는지 다시 검사한 뒤 `Board`·OWNER/MEMBER 관계·팔로우를 한 트랜잭션에서 만듭니다. 교과목과 초대 멤버는 모두 선택 사항입니다.

`subject-invite.ts`의 `inviteSubjectRosterToBoard(boardId, subjectId, actor)`는 패드가 교과목에 **새로 연결되는 순간**(생성 시 `subjectId` 지정, `/api/subjects/assign`으로 지정, 교과목 화면에서 패드를 연결) 그 교과목 명단(`lib/subjects/roster.ts`의 `rosterMemberWhere` — 개별 배정 ∪ 연결 학급) 학생 전체를 한 번에 멤버로 초대합니다. **1회성입니다** — 이후 명단이 바뀌어도 자동으로 반영되지 않고, 이미 멤버인 학생은 건드리지 않습니다. 퀴즈는 대상이 아닙니다(빈 퀴즈에 학생을 배정하는 흐름 자체가 없습니다). 대상 인원만큼 개별 `create`를 순차 실행하지 않고 `createMany`(`skipDuplicates: true`) 한 번으로 묶어 인터랙티브 트랜잭션 5초 제한을 피합니다 — `app/api/boards/[boardId]/members/groups/route.ts`(학급·부서 일괄 추가)와 같은 패턴입니다. 팔로우도 `createMany` 한 번, 대상 ID가 없는 활동/SSE는 일괄 작업당 한 번만 만들며, 동시 요청에서 실제 추가 건수가 0이면 부수효과를 생략합니다. 여러 패드를 한 요청에서 연결할 때는 ID를 먼저 중복 제거하고 DB pool을 독점하지 않는 작은 묶음으로 초대합니다. 학생의 개인 교과목 분류는 허용하지만, 자동 초대는 명단 조회 전에 actor의 교과목 관리 역할을 확인해 학생이면 건너뜁니다. 교사에서 학생으로 역할이 바뀌어 과거 과목 소유권이 남아 있어도 명단을 읽지 않습니다.

`invite-links.ts`는 초대 링크 토큰을 다룹니다. padupgrade.md 5.2 규칙에 따라 토큰 원문은 DB에 저장하지 않고 SHA-256 해시(`tokenHash`)만 저장하며, 원문은 생성 응답에서 1회만 내려줍니다. 초대 링크로 부여 가능한 역할은 `MEMBER`/`VIEWER`로 제한해, 링크가 유출되어도 관리자 권한을 얻을 수 없게 합니다.

`queries.ts`의 `getBoardPageData`는 각 섹션에서 현재 사용자가 읽을 수 있는 게시물의 **첫 30개만** SSR DTO에 담습니다. 카드마다 첨부·반응·댓글 한 페이지가 붙기 때문에 게시물을 전부 직렬화하면 오래 운영한 패드의 HTML/RSC payload와 하이드레이션 비용이 무제한으로 커지기 때문입니다. 공용 페이지 크기는 `pagination.ts`의 `SECTION_POST_PAGE_SIZE`가 정본이고, `GET /api/sections/[sectionId]/posts?cursor=...`가 다음 페이지를 잇습니다. 인쇄·발표는 결과물에 전체 글이 필요하므로 `getBoardPageData(..., { allPosts: true })`를 명시해 화면 최적화와 분리합니다.

`post-snapshot.ts`는 첫 보드 조회, 게시물 다음 페이지, 실시간 글 이벤트가 공유하는 카드 select와 직렬화를 제공합니다. Route Handler마다 첨부·댓글·반응 필드를 따로 복제해 이벤트와 첫 화면의 DTO가 어긋나는 일을 막습니다. 이벤트용 직렬화는 viewer 값을 비운 공용 스냅샷을 만들고, SSE 라우트가 승인 상태와 작성자 메타데이터로 구독자를 거른 뒤 연결별 `isMine`을 채웁니다.

클라이언트는 페이지 요청을 섹션별 `AbortController`로 관리하고, 요청 도중 SSE 재정렬로 cursor가 달라지면 늦은 응답을 버립니다. 아직 받지 않은 페이지가 있을 때는 보이지 않는 카드의 이웃을 알 수 없으므로 게시물 수동 정렬을 잠시 막고, 모든 페이지를 받은 뒤 다시 허용합니다. 검색은 현재 받은 카드에서 즉시 처리하며 뒷페이지가 있으면 그 범위를 화면에 알립니다.

카드 재정렬과 새 글 생성은 둘 다 대상 `Section` 행에 `FOR UPDATE` 잠금을 건 뒤 position을 읽고 씁니다. 재정렬 요청이 잠금을 기다리는 사이 새 글이 앞뒤 앵커 사이에 들어왔을 수도 있으므로, 잠금 뒤 현재 배열에서 유효한 앵커 바로 옆 항목을 다시 찾아 실제 인접 position 사이에 배치합니다. 섹션 생성·재정렬도 같은 이유로 `Board` 행을 공통 잠금으로 사용합니다. 이 방식으로 두 요청이 동일 position을 갖는 경쟁 조건을 막고, 클라이언트는 새 글 SSE를 받을 때 현재 드래그 배치를 유지한 채 새 카드만 병합합니다.

보드 접근 모델은 기존 `visibility`(PUBLIC/MEMBERS/INVITE_ONLY/PRIVATE) 하나 대신 `discoveryScope`(PRIVATE/LINK/PUBLIC) + `visitorPermission`(NO_ACCESS/READER/COMMENTER/WRITER) + `loginRequired`로 발견 범위와 방문자 권한을 분리했습니다(padupgrade.md 4.2). 기존 MEMBERS/INVITE_ONLY/PRIVATE는 전부 `discoveryScope=PRIVATE, visitorPermission=NO_ACCESS`로 통합했고, PUBLIC은 `discoveryScope=PUBLIC, visitorPermission=READER, loginRequired=false`로 마이그레이션했습니다(`prisma/migrations/20260726050000_*`, `20260726060000_*`). LINK는 비로그인 읽기가 기본이며 관리자가 `WRITER`를 명시하면 손님 글쓰기와 로그인 방문자의 참여를 허용합니다. PUBLIC과 같은 손님 세션·승인·사진 첨부 제한을 재사용하고, 공개 목록·검색 비노출은 그대로 유지합니다. `visitor-policy.ts`는 설정 UI·API·목록이 공유하는 순수 정책입니다. 배포 전 `20260911000000_link_guest_opt_in` 마이그레이션으로 과거 LINK 권한을 읽기 전용으로 정규화해 자동 권한 확대를 방지합니다.

`mutation-access.ts`는 글·댓글·첨부 변경 및 복구·영구삭제 요청에서 페이지와 같은 읽기·비밀번호 경계를 적용합니다. 실제 멤버와 VIEW_ALL_BOARDS 관리자는 비밀번호를 우회하고, 비멤버는 현재 비밀번호 해시에 맞는 검증 쿠키가 필요합니다. 권한·동결·자기 콘텐츠 소유권은 각 작업에서도 다시 검사합니다. `queries.ts`의 자기 콘텐츠 편집 capability는 서버의 canEditPost와 같은 규칙을 따릅니다.

`board-password.ts`는 보드 비밀번호 보호를 담당합니다(padupgrade.md 5.1). 방문자 검증에는 salt+scrypt 해시(`passwordHash`)만 사용하고 scrypt는 동시 4개·대기 32개의 비동기 큐에서 실행합니다. 맞힌 방문자의 `bpv_{boardId}` HMAC 쿠키는 보드 ID와 **현재 해시**를 함께 서명하므로 비밀번호 변경·해제 후 재설정 즉시 과거 인증이 무효화되며 운영에서는 `Secure`가 붙습니다. 새로 설정한 값은 AES-256-GCM 암호문(`passwordEncrypted`)도 함께 저장하고, 보드 ID AAD·소유자 전용·캐시 금지 POST에서만 복호화합니다. 원문 조회는 30분 이내 재로그인, 10분당 5회, `BOARD_PASSWORD_VIEWED` 감사 로그를 요구합니다. 공개 검증 실패는 학교 NAT를 고려해 브라우저별 8회와 IP 전체 60회를 분리하고 성공은 세지 않습니다. 비밀번호 검사는 **멤버·전역 관리자에게는 적용하지 않고**, `visitorPermission`으로 들어온 비멤버 방문자에게만 적용합니다. `updateBoardSchema`는 `createBoardSchema.partial()`로 만들지 않습니다 — zod `.default()`가 `.partial()` 뒤에도 생략 필드를 기본값으로 채워 부분 PATCH를 리셋시키기 때문입니다.

게시물 승인제와 보드 동결은 별도 파일 없이 `lib/auth/authorization.ts`의 `determineInitialPostStatus`/`canModeratePosts`/`isBoardFrozen`과 각 API 라우트에 나눠 구현했습니다(padupgrade.md 4.3, 5.3, 5.4). `Board.moderationMode`(NONE/MANUAL/STUDENTS_ONLY)에 따라 새 글의 초기 `Post.status`가 PENDING 또는 PUBLISHED로 정해지고, PENDING 글은 작성자 본인과 `canModeratePosts` 권한자만 조회·첨부파일 접근이 가능합니다. 승인·거절은 `POST /api/posts/[postId]/moderate`가 처리하며 `BoardActivity`(`POST_MODERATED`)와 작성자 알림(`POST_APPROVED`/`POST_REJECTED`)을 함께 남깁니다. 동결은 `Board.state`(ACTIVE/FROZEN) 즉시 전환과 `Board.freezeAt` 예약 두 가지 방식을 지원하는데, 예약은 별도 크론 없이 `isBoardFrozen`이 매 요청마다 `freezeAt <= now`를 판정하는 지연 평가 방식이라 그 시각에 실시간으로 밀어내지는 못하고 다음 쓰기 요청부터 막힙니다. 동결 중에는 게시물·섹션의 생성/수정/삭제/정렬과 댓글·반응이 모두 막히지만, 섹션 이름 변경·삭제 같은 관리자 구조 조정은 정리 작업을 위해 의도적으로 막지 않습니다. `BoardState`에는 `ARCHIVED`를 추가하지 않았습니다 — 보관은 계속 기존 `deletedAt` + 7일 복구 흐름이 전담합니다.

`validators.ts`는 padupgrade.md 6~7의 보드 표현 설정, 게시물 필드 설정과 제출 값, 첨부 메타데이터·링크·순서, 댓글 멘션, 반응 변경 요청을 크기·enum·URL·색상 allowlist로 검사합니다. `postFieldConfig`와 `customFieldValues`의 내부 구조 검증은 `lib/post-fields`에 위임하고, Route Handler가 클라이언트 JSON을 그대로 Prisma에 넣지 않게 합니다.

`queries.ts`는 레이아웃·정렬·카드 외형·작성자/시각 표시·반응/다운로드 정책과 안전하게 파싱한 게시물 필드 설정을 SSR 보드 DTO에 포함합니다. 게시물 첨부는 댓글 첨부를 제외하고 메타데이터를 전달하며, 반응 원본 행은 노출하지 않고 키별 수와 현재 사용자의 키만 집계합니다. 자동 정렬은 조회 시점에 적용되고 수동 정렬에서만 저장 위치 드래그를 허용합니다.

홈 조회도 `attachmentDownloadPolicy`와 `isTemplate`을 포함해 서버에서 보드 복제·템플릿 capability를 계산할 수 있게 합니다. 즐겨찾기·폴더에 저장된 보드는 저장 여부만으로 접근시키지 않고 `lib/dashboard/queries.ts`가 이 폴더의 기존 접근 정책과 비밀번호 확인을 다시 적용합니다.
