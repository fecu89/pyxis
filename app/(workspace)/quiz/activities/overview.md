# app/sessions 개요

교사용 결과·진행 관리 페이지(API의 `app/api/sessions`와는 별개). 루트 `page.tsx`는 `결과 보기` 목록, `[sessionId]/`는 ASYNC 호스트 관리와 PIN/QR 공유, `[sessionId]/report/`는 참여자·문항 상세 리포트를 제공한다. 새 세션은 퀴즈 카드/편집 화면에서 만들며 `new/`는 `/quizzes`로 리다이렉트한다.
