# Overview

이 폴더는 보드 멤버 초대와 역할 변경·제거 API를 담당합니다. 모든 변경은 서버에서 보드 관리 권한을 다시 확인합니다.

`groups/route.ts`는 한 명씩 검색해 초대하는 대신 학급·부서(SchoolGroup) 하나를 골라 소속 활성
인원 전체를 한 번에 멤버로 추가합니다. 범위는 `lib/board/member-candidates.ts`의
`boardMemberCandidateScope`와 같은 조직 경계를 씁니다 — 학생 소유자는 자기 학급만, 그 외(교사
등)는 자기 학교 전체만 대상으로 그룹을 고를 수 있습니다. 역할은 항상 `MEMBER`로 고정하고, 이미
멤버인 사람은 역할을 건드리지 않고 건너뜁니다(단건 초대의 `upsert`와 다른 점). 대상 수만큼
`boardMember.create`를 순차 실행하지 않고 `createMany`(`skipDuplicates: true`) 한 번으로
묶습니다 — `lib/forms/save.ts`가 겪은 것과 같은 종류의 인터랙티브 트랜잭션 5초 제한을 피하기
위해서입니다. 다만 활동 기록·소켓 알림·팔로우 등록은 단건 초대와 동일하게 **추가된 인원마다**
개별 호출합니다.
