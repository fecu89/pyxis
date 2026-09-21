# 설문 공유 API 개요

설문 소유자가 교사 후보와 현재 공유 목록을 조회하고 `VIEWER` 또는 `EDITOR` 권한을 부여·회수한다. `app/api/quiz/quizzes/[quizId]/shares`와 같은 자리·같은 규칙이다 — 학생은 설문을 소유할 길이 없어 퀴즈의 "학생 콘텐츠는 공유 못 함" 분기가 필요 없다.

GET·POST 모두 `lib/forms/shares.ts`(`listFormShares`·`upsertFormShare`)를 그대로 쓴다 — 한때 lib 파일 경계 때문에 GET이 라우트 인라인 쿼리로 갈라져 두 벌이었는데, scope가 `lib/users/share-scope.ts`의 `teacherShareCandidateScope`로 통합되면서 라우트는 다시 lib 호출로 돌아왔다(응답 모양 불변).

`candidates`는 같은 학교 활성 교사로 좁힌다(`teacherShareCandidateScope` — 퀴즈 공유 라우트와 같은 함수: VIEW_USERS 권한이 있으면 전체, 아니면 내 학교, 무소속이면 후보 없음). POST의 대상 검증에도 같은 scope가 걸린다 — 단 이미 share 행이 있는 대상은 scope와 무관하게 업서트를 허용해, 후보 축소 이전에 맺어진 학교 밖 공유의 권한 변경이 막히지 않는다. 범위 밖 대상은 존재하지 않는 대상과 같은 "공유할 교사를 찾을 수 없습니다."로 응답해 존재 여부를 흘리지 않는다. 이미 공유된 대상(`shares`)은 범위와 무관하게 그대로 표시·제거된다. 회귀는 `scripts/verify-forms-responses.ts`의 `checkShares`가 잡는다.
