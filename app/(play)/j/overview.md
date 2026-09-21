# app/(play)/j 개요

PIN 참여 구역. 손으로 치거나 QR·프로젝터로 보는 주소라 한 글자 세그먼트를 씁니다.

- `page.tsx`: PIN 코드 입력 화면. 게임 진행 화면의 색을 이어받았고, 입력 자체는 참여 레코드를
  만들지 않고 `/j/[pin]`으로 넘깁니다.
- `[pin]/page.tsx`: **로그인 세션과 공개 세션을 한 라우트가 처리합니다.** 세션을 한 번 조회해
  `requiresLogin`으로 그 자리에서 분기합니다. 예전에는 `/join/[pin]`과 `/public/join/[pin]`으로
  갈려 서로에게 리다이렉트했고, 그래서 정상 참여에도 왕복이 한 번씩 끼었습니다.
- `[pin]/share-image/[version]`: 참여 링크 미리보기 이미지.

옛 주소 `/join`, `/join/:pin`, `/public/join/:pin`은 `next.config.ts`가 여기로 영구 리다이렉트합니다.
