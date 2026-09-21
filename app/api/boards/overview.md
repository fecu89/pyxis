# Overview

이 폴더는 pyxis 구현에서 `app/api/boards` 영역을 담당합니다.

`POST /api/boards`는 학생을 포함한 활성 사용자가 새 패드를 만들 수 있게 하고, 입력 스키마를 통과한 뒤 소유자
멤버십과 함께 빈 패드(섹션 없음)를 생성합니다. 학생은 보관된 패드까지 포함해 최대 10개를 소유할 수 있으며,
사용자별 PostgreSQL advisory transaction lock 안에서 개수를 확인해 동시 생성으로 한도를 넘지 못하게 합니다. 복제와
관리자 소유권 이전도 같은 정책을 사용합니다. 섹션은 사용자가 직접 추가합니다. `discoveryScope=LINK`
요청은 클라이언트가 다른 방문자 권한이나 로그인 요구 값을 보내더라도 `visitorPermission=READER`,
`loginRequired=false`로 정규화합니다.

교과목은 퀴즈 생성과 같은 방식으로 `subjectName`(이름 자유 입력, 최대 60자)을 받습니다 —
이미 있는 내 교과목이면 연결하고, 없으면 트랜잭션 안에서 upsert로 새로 만듭니다(항상 요청자
소유라 타인 교과목 연결 검사가 필요 없습니다). 교과목이 연결됐으면 패드 생성 트랜잭션이 끝난 뒤
`lib/board/subject-invite.ts`의 `inviteSubjectRosterToBoard`가 그 교과목 명단 학생 전체를
한 번에 멤버로 초대합니다(1회성 — 이후 명단 변경은 자동 반영되지 않음).
