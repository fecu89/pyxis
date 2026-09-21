# 사용자 데이터 접근 개요

이 폴더는 암호화된 사용자 레코드를 목적별 최소 DTO로 변환합니다.

- 공개 작성자 DTO: ID, 표시 이름, 프로필 이미지
- 로그인 사용자 DTO: 본인 로그인 식별자·유형, 역할, 상태, 세션 버전, 비밀번호 Credential·변경 대기 여부, 학생 번호, 시스템 권한
- 관리자 목록 DTO: 전체 로그인 식별자·유형, 역할·상태·소속, 비밀번호 Credential·변경 대기 여부, 학생 번호, 보드 수, 시스템 권한. 이름·아이디 검색은 학교·역할 조건으로 먼저 좁힌 최대 1,000명을 복호화해 부분 일치시키고 HMAC 정확 일치를 별도로 합칩니다.

Prisma 사용자 레코드 전체나 암호화 컬럼을 Client Component에 직접 전달하지 않습니다.

`admin-policy.ts`는 보조관리자가 학생·교사 범위만 변경하도록 대상 역할별 관리 한계를 중앙화합니다.

`organization.ts`는 관리자용 학교별 전체 인원수·학년/반·부서별 인원수 디렉터리와 가입 화면용 최소 선택 목록을 각각 만듭니다. 학생 학급은 `School → SchoolGrade → SchoolGroup(CLASS)` 관계와 반 번호 순으로, 교사 부서는 `SchoolGroup(DEPARTMENT)`로 별도 정렬합니다. 가입 화면에는 학생이면 `CLASS`, 교사·관리자면 `DEPARTMENT`만 표시하며, 저장 API도 선택한 그룹이 해당 학교와 역할 유형에 속하는지 다시 검증합니다. 기본 학교·반·부서 ID는 초기 데이터 보호에만 사용하고 신규 회원에게 자동 배정하지 않습니다.

`student-roster.ts`는 관리자 XLSX 명단의 파일 크기·머리글·수식·숫자 범위·중복 아이디를 검사합니다. 접두어는 1~10자 영문자·숫자로만 받고 `{접두어}{학년}{반 2자리}{번호 2자리}` 로그인 ID와 한 번만 전달할 초기 비밀번호를 계산합니다. 템플릿 생성과 실제 등록 요청이 같은 계약을 사용합니다.

`student-search.ts`는 이름·로그인 아이디가 암호화 필드라 DB가 `LIKE` 검색을 못 하는 문제를 대신 푸는 스캔 검색 헬퍼(`searchActiveStudents`)입니다. 호출자가 role·status·학교/학급 범위까지 완성한 `where`를 넘기면, 검색어가 없을 때는 DB `count`/`skip`/`take`로, 있을 때는 `STUDENT_SEARCH_SCAN_LIMIT`(600)명까지 복호화해 이름·아이디 부분 일치와 1~2자리 출석번호를 메모리에서 매칭합니다(넘기면 `truncated: true`). 교과목 학생 후보(`lib/subjects/roster.ts`의 `getCourseStudentCandidates`)와 퀴즈 할당 학생 후보(`lib/quiz/assign-candidates.ts`의 `getAssignableStudentCandidates`)가 이 함수 하나를 공유합니다 — 두 화면 다 "누가 대상인가"만 각자의 `where`로 조립하고, "이름으로 어떻게 찾는가"는 여기가 도맡습니다.

`share-scope.ts`는 교사 간 콘텐츠 공유(퀴즈·설문)의 대상 범위 판정 `teacherShareCandidateScope`를 둡니다 — VIEW_USERS 권한이 있으면 전체, 아니면 내 학교, 무소속이면 빈 결과. 퀴즈 공유 라우트와 `lib/forms/shares.ts`가 후보 목록(GET)과 공유 대상 검증(POST)에 같은 함수를 씁니다. quiz·forms 어느 한 도메인의 규칙이 아니라 "사용자 후보를 어디까지 노출할지"의 규칙이라 users에 있고, `lib/auth/permissions.ts`처럼 순수 판정만 두어 verify 스크립트가 부분 조회한 actor로도 부를 수 있습니다.

`teacher-approvals.ts`는 가입자 본인의 교사 신청 상태와 관리자용 승인 대기열을 분리해 조회합니다. 권한이 확인된 관리자 목록에는 복호화한 일반 아이디·카카오 이메일 원문과 유형을 전달하고, 학교 대표교사의 목록은 자기 학교로 제한합니다.
