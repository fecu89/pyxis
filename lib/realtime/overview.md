# 실시간 처리 개요

pyxis의 사용자 데이터 업로드는 WebSocket이 아니라 일반 HTTP multipart 요청입니다. 보드 변경 알림은 단방향 SSE(`EventSource`)를 사용하고, 개발 화면의 `/_next/webpack-hmr` WebSocket은 Next.js HMR 전용입니다.

보드 이벤트는 단순한 “바뀌었음” 신호가 아니라 변경된 글 카드 스냅샷, 댓글·첨부 델타, 서버가 확정한 이동 위치, 섹션/보드 patch를 전달합니다. `PadCanvas`는 요청을 보낸 본인의 이벤트도 포함해 이를 로컬 상태에 적용하므로 새 글·본문·댓글·첨부·정렬마다 Server Component 전체를 다시 실행하지 않습니다. SSE는 20초 heartbeat와 프록시 버퍼링 방지 헤더를 사용합니다.

현재 이벤트 버스는 프로세스 내부 `EventEmitter`이므로 로컬 업로드 디스크와 마찬가지로 단일 앱 인스턴스를 전제로 합니다. 100~200개의 SSE 연결은 작은 알림 스트림만 유지하며 Prisma 연결을 점유하지 않습니다. 여러 앱 인스턴스로 확장할 때는 PostgreSQL LISTEN/NOTIFY 또는 Redis pub/sub 같은 공유 이벤트 계층이 필요합니다.

`sse-stream.ts`는 두 SSE 라우트가 공유하는 스트림 골격이며, 직접 `ReadableStream`을 다룰 때 문제가 됐던 세 가지를 한곳에서 막습니다.

- **enqueue 예외 격리** — `publishBoardEvent`는 `EventEmitter`의 동기 `emit`이라, 끊어진 연결의 컨트롤러에 `enqueue`하면 그 `TypeError`가 발행자(=쓰기 API Route Handler)까지 그대로 올라가 DB 저장이 끝난 요청을 400으로 실패시켰습니다. heartbeat의 `setInterval` 콜백에서 같은 일이 나면 잡아줄 곳이 없어 `uncaughtException`이 됩니다. 모든 쓰기를 감싸 실패 시 조용히 연결만 정리합니다.
- **연결 수 상한** — LINK/PUBLIC 보드의 SSE는 비로그인도 붙을 수 있어 상한이 없으면 연결마다 리스너 + 20초 타이머 + 스트림이 그대로 쌓입니다. 로그인 사용자는 보드당 6개입니다. 학교 NAT 아래 QR 접속 100명 이상이 같은 IP를 쓰는 경우를 고려해 익명 보드/IP 버킷은 240개로 두고, 프로세스 전체는 `MAX_SSE_CONNECTIONS`(기본 2000)로 제한해 초과분을 429로 거절합니다.
- **백프레셔** — 응답을 읽지 않는 클라이언트에 대해 `controller.desiredSize`가 일정 이하로 내려가면 연결을 끊습니다. 브라우저 `EventSource`가 자동 재연결하고, 다시 `ready`가 오면 `usePadEvents`가 `/api/boards/[boardId]/realtime-snapshot` JSON 정본을 한 번 받으므로 놓친 이벤트가 있어도 계속 어긋난 채 남지 않습니다.
- **접근권한 재검증** — 공개 범위·멤버처럼 읽기 권한이 달라질 수 있는 이벤트는 현재 연결에 먼저 알린 뒤 SSE를 종료합니다. 자동 재연결이 events Route Handler 진입부의 권한 검사를 다시 거치므로, 공개→비공개나 멤버 제거 뒤 예전 연결로 후속 이벤트가 새지 않습니다.
- **멤버 이벤트 표적화** — 초대·역할 변경·제거는 요청자, 대상자, 관리자 연결에만 전달합니다. 학생 한 명을 승인할 때 같은 패드의 나머지 학생 100명이 모두 스냅샷을 다시 조회하지 않습니다.

`user-events.ts`는 `board-events.ts`와 같은 구조의 사용자별(개인 알림) SSE 채널입니다(`user:{userId}` 채널명). `app/api/notifications/events`가 이 채널을 구독해 알림 벨에 실시간으로 새 알림을 알립니다.

`board-viewers.ts`는 "지금 이 보드의 SSE에 연결되어 있는 사용자" 메모리 레지스트리입니다. `app/api/boards/[boardId]/events`가 연결·해제 시점에 등록·해제하고, `lib/notifications/create.ts`가 알림을 만들기 전에 이걸 확인해 지금 그 보드를 보고 있는 사용자에게는 중복 알림을 만들지 않습니다. 사용자별 **연결 수를 세는 참조 카운트**입니다 — `Set<userId>`로 두면 같은 사용자가 탭 두 개를 열었을 때 항목이 하나만 생기고, 탭 하나를 닫는 순간 아직 보고 있는 다른 탭까지 "안 보는 중"으로 잡혔습니다. 이벤트 버스와 마찬가지로 프로세스 내부 상태라 단일 인스턴스 전제입니다.

`BoardEvent.activityId`는 변경과 함께 `recordBoardActivity()`가 만든 기록이 있을 때 그 `BoardActivity.id`를 연결합니다(post/comment/member/access 이벤트 일부). 모든 변경이 활동으로 남는 것은 아닙니다. 특히 글·섹션 재정렬과 여러 구조 변경은 활동 레코드 없이 SSE만 발행하므로, 재연결 때 `/activity?since=...` 한 건만 확인해서는 놓친 순서 변경을 검출할 수 없습니다. `use-pad-events.ts`는 두 번째 이후 `ready`마다 전용 JSON 스냅샷을 요청해 이 공백을 닫습니다. 여러 교실 탭이 동시에 복귀할 때 N100 서버에 조회가 한순간에 몰리지 않도록 탭마다 150~500ms 지터를 두며, 조회 중 더 최신 이벤트가 오면 낡은 응답을 버리고 다시 시도합니다.

평상시에는 `reconcile-sections.ts`의 `applyBoardEventDelta`가 생성·수정·삭제·이동, 댓글, 첨부, 반응, 섹션을 모두 엔티티 단위로 적용합니다. 글 `version`보다 늦은 이벤트는 버리고, 본문 스냅샷이 그 사이 도착한 댓글·첨부·현재 사용자의 반응을 되돌리지 않도록 기존 viewer 상태와 관련 컬렉션을 보존합니다. 드래그 낙관 배열이 있으면 같은 델타를 그 배열에도 적용하며, 요청 실패 시 배열 전체가 아니라 움직인 카드만 원래 이웃 사이로 복구합니다.

승인 대기·거절 글의 카드와 첨부 이벤트에는 내부 `delivery` 메타데이터가 붙습니다. events Route Handler가 글 작성자·관리자만 통과시키고 guest ID를 제거한 뒤, 연결별 `isMine`과 반응 작성자의 `actorReactions`만 개인화해 보냅니다. 내부 식별자와 비공개 본문은 일반 구독자에게 전달되지 않습니다.

SSE냐 WebSocket이냐는 이 정합성 규칙과 별개입니다. 패드를 Socket.IO로 옮기더라도 이벤트에 작업 ID·서버 revision·변경된 엔티티 스냅샷을 싣고, 클라이언트의 미확정 로컬 작업 위에 순서대로 재적용해야 같은 경쟁 조건이 되살아나지 않습니다. 현재 패드는 쓰기를 기존 HTTP API가 맡고 서버→브라우저 델타만 필요한 구조라, N100 한 대와 패드당 100명 규모에서는 WebSocket으로 전면 교체하지 않고 SSE 연결을 유지하는 편이 단순하고 충분합니다.

## Socket.IO (퀴즈 실시간)

- `socket-server.ts`: 퀴즈 세션의 문항 시작·정답 공개·리더보드·답안 제출을 다루는 이벤트 핸들러와, 소켓 사용자 재검증(`verifySocketUser`).
- `host-presence.ts` / `session-presence.ts`: 호스트 연결 상태와 세션별 접속자 수를 메모리에서 추적합니다.

`socket-server.ts`는 같은 `Server` 인스턴스에 핸들러가 두 번 등록되지 않도록 `globalThis`의 `WeakSet`으로 보호합니다. 그래서 개발 재평가나 잘못된 초기화 호출이 호스트 부재 sweep interval과 connection listener를 중복 생성하지 않습니다. 운영 정책 변경으로 공개 소켓의 분당 이벤트 상한 값이 계속 달라져도 제한기 캐시는 최대 8개만 유지하고, 밀려난 제한기의 sweep timer와 버킷을 `dispose()`해 놓습니다.

`namespaces.ts`는 서버와 클라이언트가 함께 쓰는 namespace 이름입니다. 기본 namespace(`/`)는 의도적으로 비워 둡니다 — `io.use()`는 기본 namespace에만 적용되므로 기본을 특정 기능에 써 버리면 나중에 추가하는 namespace가 그 인증 미들웨어를 받지 못해 규칙이 조용히 어긋납니다. 모든 기능은 이름 있는 namespace(`/quiz`, `/quiz-public`)를 씁니다.

소켓 서버 모듈은 `server.ts`가 Next 번들러 **밖에서** 직접 로드하므로, Route Handler가 import하는 인스턴스와 다른 인스턴스가 됩니다. 그래서 어떤 Route Handler도 소켓 서버를 import하지 않습니다. 쓰기 API에서 소켓 이벤트를 쏘아야 하면 `globalThis` 브리지를 명시적으로 만듭니다.
