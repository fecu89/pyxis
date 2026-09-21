# app/(play)/i 개요

보드 초대 링크(`/i/[token]`). 토큰을 확인해 초대 대상 보드를 보여주고, 로그인한 사용자가
참여 버튼을 누르면 `/api/invite/[token]/redeem`이 멤버십을 만듭니다.

`components/pad/pad-invite-links.tsx`가 이 주소를 절대 URL로 만들어 클립보드에 넣으므로,
옛 `/invite/:token`은 `next.config.ts`가 영구 리다이렉트로 살려 둡니다.
