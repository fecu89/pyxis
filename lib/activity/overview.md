# Overview

퀴즈 세션·패드 보드·설문이 공유하는 **활동** 계층입니다. 병합의 목적지인 `/report`가 세 테이블을
각자 조회해 응용 코드에서 머지하지 않고 `Activity` 한 테이블만 읽도록 하는 것이 존재 이유입니다.
따로 조회해 합치면 정렬과 페이지네이션이 특히 지저분해집니다.

- `ensure.ts`: `createActivity()`는 소유자의 **현재** 소속을 읽어 활동을 만듭니다. 활동을 연
  시점의 학교·학급을 고정하는 것이 핵심이라, 소유자가 학교를 옮기거나 반이 바뀌어도 과거
  리포트가 따라 움직이지 않습니다. 반드시 대상(보드·세션) 생성과 **같은 트랜잭션**에서 불러야
  둘 중 하나만 남는 상태가 생기지 않습니다.
- `students.ts`: `/report/students` 목록의 조회 계층. 학교·학급 조건으로 먼저 좁힌 뒤 최대 600명만
  복호화하는 공용 학생 검색으로 이름·아이디·출석번호 부분 검색을 지원합니다. 삭제나 필터 변경 뒤
  페이지 번호가 범위를 벗어나도 마지막 유효 페이지로 보정합니다. 볼 수 있는 범위는
  `report.ts`의 `scopeFor`와 같습니다 — 목록에 보이는 학생은 상세도 열려야 하고, 그 반대도
  마찬가지입니다.
- `report.ts`: `/report`의 조회 계층. 볼 수 있는 범위는 전체관리자·콘텐츠 권한자는 전부,
  교사는 자기 학교, 그 외는 자기가 연 것만입니다. 활동이 삭제된 뒤 오래된 페이지 URL을 열어도
  빈 화면이 되지 않도록 페이지 번호를 현재 마지막 페이지로 보정합니다.

## activityId는 필수입니다

`Board.activityId`와 `QuizSession.activityId`는 **NOT NULL**입니다(마이그레이션
`20260807000000_activity_required`가 기존 행을 백필한 뒤 좁혔습니다). nullable로 두면 생성 경로
어딘가가 활동을 빠뜨려도 화면은 멀쩡히 뜨고 그 활동만 `/report`에서 조용히 사라집니다 — 눈으로는
발견되지 않는 종류의 결함이라 컴파일러와 DB가 잡게 했습니다. 실제로 필수로 좁히는 순간
`tsc`가 패드 복제 경로와 시드, 검증 스크립트 fixture 16곳을 잡아냈습니다.

## 삭제 방향

FK는 모듈 테이블 쪽(`Board.activityId`)에 있으므로 `onDelete: Cascade`는 "활동을 지우면 보드·세션도
지운다"는 뜻입니다. 반대 방향은 FK로 표현할 수 없어, **하드 삭제 경로가 활동을 먼저 지우고
cascade로 대상을 함께 내립니다.** 대상만 지우면 활동이 고아로 남아 `/report`에 열 수 없는 행으로
뜹니다. 해당 경로는 다음과 같습니다.

- `app/api/admin/boards/[boardId]/purge` — 보드 영구 삭제
- `app/api/quiz/sessions/[sessionId]` DELETE, `app/api/quiz/sessions/bulk-delete`
- `lib/board-reuse/clone-board.ts`의 복제 실패 롤백
- 검증 스크립트의 fixture 정리(`scripts/fixtures.ts`의 `createPadActivity`로 만든 것들)

`syncActivity()`는 여전히 `activityId`가 없으면 아무 일도 하지 않습니다 — 타입상 필수라 실제로는
도달하지 않지만, 부분 select로 넘어오는 호출부를 위한 방어입니다.
