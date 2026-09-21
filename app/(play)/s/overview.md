# 설문 응답 라우트 개요

이 폴더는 pyxis의 설문(Forms) 공개 응답 경로를 담당합니다.

- `/s/{slug}`: 응답 화면. 서버 컴포넌트(`page.tsx`)의 유일한 책임은 `requiresLogin` 게이트뿐입니다
  — 로그인이 필요한데 세션이 없으면 callbackUrl을 보존해 로그인으로 보냅니다. 마감·초안·정원
  초과 같은 나머지 상태는 서버가 404/500을 내면 안 되므로(설문 링크는 단톡방에 그대로 붙고,
  마감된 뒤에도 열어 보는 사람이 있습니다) 전부 클라이언트(`components/forms/form-runner.tsx`)가
  `/api/public/forms/{slug}`를 불러 친절한 안내로 보여줍니다.
- `/s/{slug}/done`: 제출 완료 화면. API를 다시 왕복하지 않고 서버 컴포넌트가 `form.title`·
  `confirmationMessage`를 직접 Prisma로 조회합니다.

응답 입력 UI(`AnswerField`)와 제출 오케스트레이션(`FormRunner`)은 `components/forms/`에 있고,
서버 쪽 검증·저장 로직은 `app/api/public/forms/overview.md`와 `lib/forms/overview.md`를
참고하세요.
