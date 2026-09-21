# app/(play)/f 개요

첨부 파일 스트리밍(`/f/[attachmentId]`). 보드 접근 정책을 확인한 뒤 원본 또는 `?variant=thumbnail`
파생본을 내려보냅니다.

주소가 짧은 이유는 게시물 본문 마크다운에 사용자가 직접 붙여넣기 때문입니다. 옛 `/files/:id`는
`next.config.ts`가 영구 리다이렉트로 살려 둡니다 — 이미 밖으로 나간 URL이 있을 수 있습니다.
