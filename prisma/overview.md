# Prisma 개요

`schema/`는 PostgreSQL 모델을 도메인별로 나눠 정의하고(`base`·`identity`·`activity`·`quiz`·`pad`·`form`), `migrations/`는 배포 순서대로 적용할 변경 이력을 보관합니다. 모델 수가 많아 Prisma 7의 멀티파일 스키마를 사용합니다.

- 학생 소속은 `School → SchoolGrade → SchoolGroup(type=CLASS)` 계층이며 `User.studentNumber`가 반 안의 1~99 출석번호를 저장합니다. `(schoolGroupId, studentNumber)` 복합 고유 인덱스가 같은 반의 번호 중복을 막고, 교사 부서는 학년과 무관한 `SchoolGroup(type=DEPARTMENT)`입니다.
- `School`은 코드·급별·지역·운영 상태를 저장합니다. 대표교사는 별도 학급 관계가 아니라 활성 교사의 `User.isSchoolRepresentative`로 표현하며 전체관리자만 부여·회수합니다.
- 일반 로그인 비밀번호는 `User.passwordHash`의 scrypt 해시만 저장합니다. `mustChangePassword`는 명단 발급·관리자 초기화 뒤 전용 비밀번호 변경이 필요한 상태입니다.
- 패드 공유 비밀번호는 방문자 검증용 `Board.passwordHash`와 소유자 재확인용 AES-GCM `Board.passwordEncrypted`를 분리합니다. 암호화본은 보드 ID에 묶이며 API 응답이나 감사 로그에 포함하지 않습니다.
- `ShortLink`는 패드·퀴즈 세션·설문 중 하나에 `/go/{slug}` 별칭을 연결합니다. 연결 해제 뒤에도 `disabledAt` 예약 행이 남고 전역 slug unique가 과거 주소 탈취를 막습니다. 대상별 활성 주소 하나는 부분 unique 인덱스, 대상·생성자 영구 삭제 뒤 보존은 nullable FK와 `SET NULL`이 담당합니다.
- `AdminAuditLog`에는 학생 명단 발급·비밀번호 초기화·반 이동·대표교사 변경을 포함한 민감한 관리 작업과 사유를 남기되 평문 비밀번호는 넣지 않습니다. 제거 전 기록을 읽을 수 있도록 과거 학적·진급 감사 action enum 값은 보존합니다.
- `Subject`는 교과목입니다. `Quiz.subjectId`와 `Board.subjectId`는 선택 관계라 어느 교과목에도 속하지 않을 수 있고, `SubjectStudent`가 학생의 다중 교과목 배정을 보관합니다. 교과목 삭제 시 퀴즈·패드는 유지한 채 미분류가 되고 학생 배정만 제거됩니다.
- 글·댓글 작성자와 첨부 업로더의 사용자 FK는 명시적 `Restrict`입니다. 회원 삭제는 User 행을 지우지 않고 익명화·`DELETED` 처리하므로 콘텐츠의 작성자 연결을 보존하며, 손님 작성자 CHECK 제약과 충돌하는 `SetNull`을 사용하지 않습니다.
- `form.prisma`는 설문(구글 설문지 + 서명) 도메인입니다. `Form.activityId`는 `QuizSession`·`Board`와 같은 이유로 필수이고, 1인 1응답은 `FormResponse.dedupeKey`와 `@@unique([formId, dedupeKey])`가 막습니다 — PostgreSQL이 유니크 인덱스에서 null을 서로 다른 값으로 보므로 제약 하나가 "1인 1응답"과 "복수 응답 허용"을 모두 표현합니다. `FormAnswer.fieldId`는 `RESTRICT`라 설문을 지울 때 답변을 먼저 지워야 합니다(`lib/forms/overview.md`).
- 스키마 변경 뒤에는 새 SQL 마이그레이션, `prisma validate`, `prisma generate`, 실제 마이그레이션 적용을 함께 수행합니다. 생성 결과는 `generated/prisma/`에 둡니다. 이 서버의 DB 사용자에게는 데이터베이스 생성 권한이 없어 `prisma migrate dev`가 shadow DB를 못 만듭니다(P3014). 마이그레이션 SQL은 `prisma migrate diff --from-config-datasource --to-schema prisma/schema --script`로 뽑아 주석을 달고, 적용은 `prisma migrate deploy`로 합니다.
