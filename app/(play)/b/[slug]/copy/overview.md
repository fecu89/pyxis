# 자동 복제 링크 화면

공유 가능한 `/b/{slug}/copy` 주소에서 원본 요약과 복제 옵션을 보여줍니다. GET 렌더 중에는 DB를
변경하지 않고, 사용자가 명시적으로 복제 버튼을 누른 POST 요청에서만 새 보드를 만듭니다.

`components/home/pad-reuse-dialog.tsx`가 이 주소를 클립보드로 배포하므로, 옛 `/copy/:slug`는
`next.config.ts`가 영구 리다이렉트로 살려 둡니다.
