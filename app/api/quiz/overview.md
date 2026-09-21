# Overview

퀴즈 도메인 API입니다. quiz 프로젝트에서 이식하면서 `/api/quizzes`·`/api/subjects`·`/api/sessions`를
`/api/quiz/*` 아래로 모았습니다 — 패드와 퀴즈가 같은 `/api` 아래 살게 되므로 도메인 접두어가
없으면 어느 서비스의 라우트인지 알 수 없고, 나중에 공통 코어(`/api/admin`, `/api/me`)와도 뒤섞입니다.

- `quizzes/`: 퀴즈 CRUD, 문항 편집·정렬, 발행, 복제, 즐겨찾기, 공유(교사 간), 학생 할당.
  할당 대상 학생의 범위는 `VIEW_USERS` 보유자는 전체, 그 외 교사는 **자기 학교**다. quiz에서는 마지막 갈래가 "내가 발급한 학생"(`User.createdById`)이었는데 병합 스키마에는 그 컬럼이 없어 Prisma가 거절하고 할당이 전부 400으로 실패했다. 스프레드로 넘기는 값이라 타입 검사에도 안 걸렸다 — 관리 콘솔의 회원 조회와 같은 학교 기준으로 통일했다.
- `subjects/`: 교과목 CRUD. 소유자별로 정규화한 이름에 고유 제약이 있습니다
- `sessions/`: LIVE·ASYNC 세션 생성·진행·종료·리포트, PIN 참여
- `live-audio/[slot]`: 라이브 퀴즈 페이지가 관리자 지정 음원을 읽는 공개 스트림. 현재 또는 최근 교체 유예 목록의 `revision` 쿼리가 정확히 맞아야 하며 range 요청, ETag, immutable 캐시를 지원합니다. 음원 메타데이터는 호스트·학생 페이지의 서버 렌더 데이터로 전달하므로 별도 초기 설정 fetch는 없습니다.

호환용 `GET /api/quiz/quizzes`와 `GET /api/quiz/sessions`는 화면의 Server Component 로더와 별개로 남아 있지만 무제한 목록은 반환하지 않습니다. 둘 다 `page`·`pageSize`(기본 50, 최대 100)와 `pagination` 메타데이터를 사용하고 응답은 private no-store입니다. 두 컬렉션의 POST 본문도 16KB 스트림 상한을 적용합니다.

LIVE의 고빈도 진행은 Route Handler가 아니라 `lib/realtime/socket-server.ts`가 담당합니다. 한 반의 동시 입장은 같은 세션 전문 조회를 진행 중 Promise로 합치고, 참여자·답안 진행률·실시간 참여형 집계는 호스트 전용 room에만 보냅니다. 답안 제출은 현재 문항의 채점 필드를 한 번 읽어 검증과 채점에 함께 사용하며, 종료된 세션의 재접속 ACK도 최종 TOP 3를 복원합니다. ASYNC의 HTTP 답안 Route도 `loadAsyncParticipation()`이 읽은 현재 문항을 채점기에 재사용합니다.

병합하며 바뀐 곳
- 학생·교사 조회에서 `username`·`displayNameEncrypted`가 사라졌습니다. 표시 이름은
  `toPublicAuthorDTO(nameEncrypted)`, 로그인 아이디는 `decryptUserLoginIdentifier`로 얻습니다.
- 공유 후보 목록의 "연락처 마스킹"은 이메일 마스킹이 아니라 로그인 식별자 마스킹입니다
  (`maskLoginIdentifier`) — 병합 스키마는 카카오 이메일과 일반 아이디를 한 컬럼에 담습니다.
- 요청량 제한은 pad의 `assertRateLimit`을 씁니다. quiz의 `enforceRateLimit`은 `x-forwarded-for`를
  검증 없이 신뢰해서 pad의 `trustedClientIdentifier`보다 약합니다.
