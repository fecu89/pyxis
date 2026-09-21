# 라이브 퀴즈 오디오 스트림

`GET /api/quiz/live-audio/[slot]?v=[revision]`은 호스트·학생 브라우저에 관리자 지정 음원을 전달합니다.

- `SystemSetting`의 현재 슬롯 또는 최근 14개 교체 유예 목록에서 슬롯과 revision이 일치할 때만 파일을 엽니다. 관리자가 수업 도중 파일을 바꿔도 이미 열린 브라우저의 후속 range 요청이 404가 되지 않습니다.
- byte range(206/416), `Accept-Ranges`, `Content-Length`, ETag를 지원해 브라우저 탐색·재생 재개가 전체 파일 재전송으로 이어지지 않습니다.
- revision URL은 1년 `immutable`로 캐시합니다. 관리자가 파일을 교체하면 새 페이지의 URL 자체가 바뀌고, 이전 URL은 제한된 유예 목록 동안 같은 바이트를 유지합니다.
- 저장 경로는 `resolveStoredFile`로 `UPLOAD_DIR` 아래인지 다시 검증하고, 응답은 `nosniff`와 제한된 CSP를 사용합니다.
- 음원은 비밀 자료가 아니므로 스트림 자체에는 로그인 검사를 두지 않습니다. 참여 권한 검사는 음원 URL을 포함한 퀴즈 페이지에서 먼저 수행합니다.
