# 퀴즈 공유 API 개요

퀴즈 소유자가 교사 후보와 현재 공유 목록을 조회하고 `VIEWER` 또는 `EDITOR` 권한을 부여·변경·회수한다. 공유받은 교사에게는 퀴즈 링크가 포함된 알림을 생성한다. 관리자 외 사용자는 본인 소유 퀴즈만 공유 설정할 수 있다.

GET의 `candidates`는 같은 학교 활성 교사로 좁힌다(`lib/users/share-scope.ts`의 `teacherShareCandidateScope` — VIEW_USERS 권한이 있으면 전체, 아니면 내 학교, 무소속이면 후보 없음. 설문 공유 `lib/forms/shares.ts`와 같은 함수이고, `/api/boards/member-candidates`의 `boardMemberCandidateScope`와 같은 판정). 후보 목록이 검색형 리스트 UI로 바뀌며 전 플랫폼 교사 300명을 그대로 노출하던 표면을 줄이기 위해서다. POST의 대상 검증에도 같은 scope가 걸린다 — 단 이미 share 행이 있는 대상은 scope와 무관하게 업서트를 허용해, 후보 축소 이전에 맺어진 학교 밖 공유의 권한 변경이 막히지 않는다. 범위 밖 대상은 존재하지 않는 대상과 같은 "공유할 교사를 찾을 수 없습니다."로 응답해 존재 여부를 흘리지 않는다. 이미 공유된 대상(`shares`)은 이 범위와 무관하게 학교 밖 교사여도 그대로 표시·제거할 수 있다 — 기존 공유 관계 확인·해제가 끊기면 안 된다.
