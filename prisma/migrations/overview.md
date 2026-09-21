# Prisma 마이그레이션 개요

이 폴더는 pyxis PostgreSQL 스키마 변경 이력을 순서대로 보관합니다.

- 초기 마이그레이션: 보드·글·첨부·댓글·반응·멤버십 초기 모델
- `20260726000000_add_board_access_requests`: 비멤버의 접근 요청과 승인 상태 모델
- `20260726010000_add_user_roles_permissions_pii`: 사용자 역할·상태·세션 버전, 시스템 권한, 감사 로그와 암호화 개인정보 컬럼
- `20260726020000_drop_plain_user_pii`: 백필 검증 후 사용자 평문 이메일·이름·프로필 이미지 컬럼 제거
- `20260726030000_add_notifications_invite_links_deleted_status`: 인앱 알림, 초대 링크, 삭제 사용자 상태
- `20260726040000_add_board_activity_follow_hashed_invite`: 활동·팔로우와 해시 기반 초대 링크
- `20260726050000_add_discovery_scope_visitor_permission`: 발견 범위·방문자 권한·로그인 및 비밀번호 설정
- `20260726060000_drop_board_visibility`: 백필을 마친 기존 공개 범위 제거
- `20260727000000_add_post_status_moderation_board_state`: 게시물 승인 상태·승인 방식·보드 동결 상태
- `20260727010000_add_post_moderation_notification_types`: 승인 활동과 결과 알림
- `20260727020000_add_board_freeze_at`: 예약 동결 시각
- `20260727030000_add_post_participation_and_board_design`: 게시물 필드·댓글 멘션/첨부·반응·레이아웃/디자인 설정
- `20260727040000_add_board_reuse_dashboard_folders`: 보드 템플릿 표시, 개인 즐겨찾기와 사용자별 다중 보드 폴더
- `20260728000000_add_board_visits`: 알림 팔로우와 분리된 사용자별 최근 방문 시각
- `20260728010000_add_school_groups`: 학교와 역할별 반/부서 관계, 청학고등학교·3학년 5반·3학년부 초기 데이터, 조직 변경/회원 삭제 감사 액션
- `20260728020000_add_user_auditlog_indexes`: 관리자 사용자 목록과 감사 로그 조회 인덱스
- `20260729000000_add_school_audit_actions`: 학교·반/부서 CRUD 감사 액션 6종
- `20260730000000_add_user_onboarding`: 신규 카카오 계정의 가입 정보 완료 시각. 기존 사용자는 마이그레이션에서 완료 상태로 백필
- `20260730010000_add_teacher_approval_requests`: 학교별 교사 가입 신청·승인·반려 상태와 감사·알림 유형
- `20260801000000_add_user_password_credentials`: 카카오 계정과 함께 쓸 수 있는 일반 이메일 로그인용 nullable scrypt 해시
- `20260801010000_add_auth_security_nickname_uniqueness`: 닉네임 HMAC 고유 키, DB 공유형 인증 제한과 HMAC 인증 이벤트 집계
- `20260801020000_add_student_roster_password_reset_grade_hierarchy`: 학교 → 학년 → 반 계층, 학생 번호, 최초 비밀번호 변경 상태, 학생 명단 발급·관리자 비밀번호 초기화 감사 액션. 기존 `N학년 M반` 이름은 자동 백필
- `20260802000000_add_student_number_uniqueness`: 같은 학급의 출석번호 중복을 막는 `(schoolGroupId, studentNumber)` 복합 고유 인덱스. 번호 미지정 `NULL`은 여러 명 허용
- `20260802010000_add_academic_management`: 학교 코드·급별·지역·학년도·운영 상태, 학급 별칭·정원·담임, 학생 학적 상태와 학적 변경·반 이동·진급 감사 액션. 기존 삭제되지 않은 학생은 `ENROLLED`로 백필
- `20260802020000_remove_unneeded_academic_features`: 실제 운영 범위에 필요하지 않은 학생 학적 상태 enum/컬럼, 학급 별칭·정원·담임 관계, 학교 학년도 컬럼 제거. 과거 감사 로그 해석을 위해 기존 감사 action enum 값은 유지
- `20260806000000_merge_quiz_domain`: quiz 도메인 병합. `Activity` 공통 활동과 퀴즈 10개 모델, enum 9종을 추가하고 `NotificationType`·`SystemPermission`·`AdminAuditAction`에 값을 더합니다. `Notification`의 `boardId`/`postId`/`commentId`를 실제 외래키로 승격하고 `quizId`/`assignmentId`를 추가하며, `SystemSetting`이 quiz의 `AppPolicy`(퀴즈 한도·재인증 창·일괄 발급 상한)를 흡수합니다. `DROP`이 하나도 없는 순수 추가 마이그레이션입니다
- `20260807000000_activity_required`: `Board.activityId`·`QuizSession.activityId`를 필수로 좁힙니다. NOT NULL을 걸기 **전에** 활동이 없는 기존 행을 백필하고, 남은 행이 있으면 `RAISE EXCEPTION`으로 멈춥니다 — NOT NULL이 실패하는 것보다 이유가 분명합니다. 필수 컬럼에 `SET NULL`은 성립하지 않으므로 두 외래키를 `CASCADE`로 다시 겁니다(활동을 지우면 대상도 지운다는 뜻이고, 반대 방향은 FK로 표현할 수 없어 영구 삭제 경로가 활동을 먼저 지웁니다)
- `20260812000000_add_user_password_set_audit_action`: 관리자·학교 대표교사가 학생 비밀번호를 무작위가 아니라 직접 지정했을 때 무작위 초기화(`USER_PASSWORD_RESET`)와 구분해 기록하는 `USER_PASSWORD_SET` 감사 액션 추가
- `20260817010000_raise_classroom_quiz_join_limit`: 학교 NAT 한 IP 뒤에서 한 반이 동시에 공개 퀴즈에 참여해도 서로 차단하지 않도록 `publicQuizJoinPerMinute` 기본값과 기존 기본 설정을 20에서 120으로 올립니다. 잘못된 PIN은 애플리케이션의 별도 20회/분 제한이 유지됩니다.
- `20260818010000_add_quiz_live_audio`: `SystemSetting.quizLiveAudio` JSONB를 추가합니다. 대기실/진행 BGM과 단계별 효과음의 파일 메타데이터·볼륨을 한 설정 묶음으로 저장하며 기존 행은 null일 때 애플리케이션 기본값을 사용합니다.
- `20260818020000_raise_public_quiz_ip_connection_limit`: 한 학교 IP 뒤의 100명 공개 퀴즈와 순간 재연결을 수용하도록 `publicQuizSocketConnectionsPerIp` DB 기본값을 80에서 200으로 올리고, 아직 80을 쓰는 기존 싱글턴 설정만 200으로 이동합니다. 참가자별 3개 탭·프로세스 전체 500개 상한은 그대로입니다.
- `20260820000000_add_registration_approval_and_access_notification`: 자가 회원가입·최초 카카오 로그인의
  계정 승인 상태와 검토 기록을 추가합니다. 기본값은 `APPROVED`라 기존·관리자 발급 계정은 유지되며,
  응용 코드가 자가 가입만 `PENDING`으로 생성합니다. 패드 접근 요청 알림에는
  `BoardAccessRequest` 외래키를 연결해 알림에서 특정 요청을 바로 처리합니다.
- `20260824010000_add_board_password_encrypted`: 패드 소유자 전용 현재 비밀번호 확인을 위한 AES-GCM 암호문 컬럼을 추가합니다. 기존 scrypt 해시는 그대로 유지하므로 과거 패드의 접근 검증은 변하지 않고, 암호화본은 다음 비밀번호 설정·변경 때부터 채워집니다.
- `20260825010000_add_short_links`: 패드·퀴즈 세션·설문이 원주소를 유지하면서 전역 `/go/{slug}` 별칭 하나를 가질 수 있게 합니다. CHECK 제약이 대상 하나만 연결되도록 보장하고 대상 영구 삭제 시 별칭도 함께 삭제합니다.
- `20260825020000_harden_short_links_and_board_password`: 변경·해제·퀴즈 마감 뒤 slug를 `disabledAt` 예약 행으로 보존합니다. 활성 대상별 부분 unique 인덱스와 FK `SET NULL`로 과거 QR 탈취를 막고, 패드 공유 비밀번호 원문 조회 감사 액션을 추가합니다.
