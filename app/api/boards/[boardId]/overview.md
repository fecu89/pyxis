# Overview

이 폴더는 pyxis 구현에서 `app/api/boards/[boardId]` 영역을 담당합니다.

- 루트 `PATCH`는 패드 관리 권한을 다시 검사한 뒤 256KB 이하 설정을 부분 수정합니다. LINK는 기본적으로
  `READER/loginRequired=false`이며, 관리자가 명시한 WRITER는 손님 글쓰기로 보존합니다. 공개 범위만 LINK로
  바꾼 요청은 이전 쓰기 권한을 자동 승계하지 않으며 무관한 PATCH는 현재의 정상 설정을 유지합니다.
- `guest/`는 LINK/PUBLIC의 손님 글쓰기 허용과 보드 비밀번호를 확인한 뒤 표시 이름·서명 쿠키를 관리합니다.
  이 쿠키는 권한이 아니므로 글·댓글·첨부 변경은 매 요청 `getBoardMutationAccess`와 작업별 권한을 다시 검사합니다.
- `activity/`: `GET`으로 이 보드의 `BoardActivity` 로그를 시간 역순 커서 페이지네이션으로 조회합니다. 보드 읽기 권한(`canReadEffectiveBoard`)만 있으면 누구나 볼 수 있고, `actorId`·`since`·`until` 쿼리로 필터링합니다.
- `follow/`: `GET`으로 내 팔로우 여부를, `POST`/`DELETE`로 팔로우·해제를 처리합니다.
- `background-image/`: `GET`은 패드 읽기 권한과 비밀번호 검증 쿠키를 확인한 뒤 로컬 WebP를 스트리밍합니다. `POST`/`DELETE`는 `canManageBoardSettings`와 same-origin 검사를 통과해야 하며, 업로드는 한 파일·10MB·JPG/PNG/WebP로 제한해 실제 시그니처를 검사한 뒤 최대 1920×1200 WebP로 재인코딩합니다. DB에는 캐시 갱신용 버전 쿼리가 붙은 내부 URL만 저장합니다.
- `invite-links/`: `GET`(목록)·`POST`(생성)는 `canManageBoardSettings`만 가능하고, 역할은 `MEMBER`/`VIEWER`로 제한합니다. 생성 시 원문 토큰은 응답에서 1회만 내려주고 DB에는 해시만 저장합니다(`lib/board/invite-links.ts`). `invite-links/[linkId]`의 `DELETE`로 폐기(`revokedAt`)합니다. 실제 참여 처리는 `app/api/invite/[token]/redeem`이 별도로 담당합니다.
- `verify-password/`: `POST`로 비밀번호를 확인하고 보드 ID와 현재 해시를 함께 HMAC 서명한 쿠키를 내려줍니다. 비밀번호가 바뀌면 과거 쿠키는 즉시 무효화됩니다. 성공 요청은 제한을 소비하지 않고 실패만 브라우저별 8회/10분, 학교 NAT 전체 IP별 60회/10분으로 셉니다. 비동기 scrypt 작업 큐가 CPU·libuv 포화를 제한합니다.
- `password/`: 민감한 읽기를 `POST`로만 받고 same-origin, 30분 이내 로그인, 소유자 전용, 5회/10분을 검사합니다. 평문은 `private, no-store` 응답에만 담고 감사 로그에는 조회 사실만 남깁니다.
