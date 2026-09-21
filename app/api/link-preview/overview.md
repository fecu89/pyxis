# 링크 미리보기 API 개요

`POST /api/link-preview`는 글 작성 화면에서 붙여 넣은 공개 HTTP(S) URL의 제목·설명·대표 이미지를 반환합니다.

- 활성 로그인 사용자가 필요합니다.
- 요청 본문은 `{ "url": "https://..." }`이며 URL은 2,048자 이하입니다.
- 같은 출처의 변경 요청만 허용합니다.
- 사용자별 1분당 20회로 제한합니다.
- 네트워크·SSRF 방어와 메타데이터 추출은 `lib/link-preview/overview.md`를 따릅니다.
- 응답은 사용자의 URL을 포함할 수 있으므로 `private, no-store`로 반환합니다.
