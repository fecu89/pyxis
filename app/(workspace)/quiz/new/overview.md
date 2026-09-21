# app/quizzes/new 개요

제목·설명·로그인 필요 여부·교과목을 입력해 빈 퀴즈를 만드는 폼. 교과목은 `/api/subjects`의 기존 목록을 `datalist`로 고르거나 새 이름을 직접 입력할 수 있다. 생성 성공 시 `POST /api/quizzes` 응답의 `quiz.id`로 `/quizzes/[quizId]/edit`로 이동한다. 학생은 서버에서 소유 퀴즈 10개 한도를 검사한다.
