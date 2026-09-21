# 게시물 링크 첨부 API

`POST /api/posts/[postId]/links`는 링크 미리보기에서 사용자가 확정한 HTTP(S) URL을 로컬 파일 없는 `AttachmentType.LINK` 행으로 저장합니다.

요청마다 로그인·보드 접근·게시물 편집·파일 업로드·동결 정책을 다시 검사합니다. URL 메타데이터를
가져오는 SSRF 방어 요청은 `/api/link-preview`가 담당하며, 이 라우트는 검증된 URL과 표시용
제목·설명·대표 이미지 URL을 저장합니다. 대표 이미지는 `Attachment.previewImageUrl`의 nullable
메타데이터일 뿐 서버 파일 경로나 프록시 주소로 취급하지 않습니다. 미리보기 UI를 우회한 직접
요청도 링크와 대표 이미지의 DNS 결과가 공개 주소인지 저장 전에 다시 확인해 내부망 URL을 거부합니다.
