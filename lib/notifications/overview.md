# 알림 개요

`create.ts`의 `createNotification`은 특정 사용자를 대상으로 하는 개인 알림(`Notification` 테이블) 한 건을 만들고, `lib/realtime/user-events.ts`로 실시간 신호를 보냅니다.

- 알림을 만드는 사람(`actorId`)이 받는 사람(`userId`)과 같으면 만들지 않습니다(자기 행동에 스스로 알림받지 않음).
- 받는 사람이 지금 그 보드의 SSE에 연결되어 있으면(`lib/realtime/board-viewers.ts`로 확인) 일반 보드 알림을 생략합니다. 단, 접근 요청 도착·승인·거절(`ACCESS_REQUEST_*`)은 보드 카드 변경만으로 확인할 수 없는 개인 알림이므로 접속 중에도 저장하고 알림 SSE를 보냅니다.
- 트리거: 내 글에 댓글(`POST_COMMENTED`), 내 글에 반응(`REACTION_ON_POST`, 새로 좋아요를 누른 경우만), 내가 관리하는 보드에 새 멤버(`MEMBER_JOINED`), 내가 관리하는 보드에 접근 요청 도착(`ACCESS_REQUEST_RECEIVED`), 내 접근 요청이 승인·거절(`ACCESS_REQUEST_APPROVED`/`ACCESS_REQUEST_REJECTED`), 새 계정·교사 가입 신청과 승인·반려(`ACCOUNT_APPROVAL_*`, `TEACHER_APPROVAL_*`). 접근 요청 도착 알림은 정확한 요청을 모달에서 처리할 수 있도록 `accessRequestId`도 저장합니다.
- 보드 전체의 활동 타임라인(누가 무엇을 했는지)은 이 알림과 별개로 `lib/board/activity.ts`의 `BoardActivity`가 담당합니다. 알림은 "나에게 온" 항목만 다루고, 활동 로그는 보드에 접근 권한이 있는 모두에게 보이는 공용 기록입니다.
- 상주 워크스페이스 셸과 패드 본문 SSR은 `getNotificationSummary`로 읽지 않은 개수만 셉니다. 알림 20개와 관련 패드·글·퀴즈·설문 제목은 사용자가 벨을 처음 열 때만 `/api/notifications`가 읽습니다. 벨을 열기 전 SSE/탭 복귀 보충은 `?summary=1`만 호출하고, 상세를 이미 읽은 뒤에는 전체 목록을 갱신합니다. 요청 순번을 요약과 상세로 나눠 늦은 응답이 목록이나 배지를 되돌리지 않습니다.
- 브라우저 탭이 숨겨지면 `NotificationBell`은 EventSource와 재시도 타이머를 닫고, 다시 보일 때 연결과 보충 조회를 즉시 수행합니다. 여러 백그라운드 탭이 사용자당 SSE 상한과 브라우저 연결을 점유하지 않으면서 배지·목록은 복귀 시 최신 상태로 맞춥니다.
