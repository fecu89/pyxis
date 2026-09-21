# 교사 가입 승인 마이그레이션

`TeacherApprovalRequest`는 신청자별 현재 교사 신청 한 건을 저장합니다. 신청 학교·교사 부서, `PENDING | APPROVED | REJECTED`, 검토자·사유·시각을 기록하며 학교별 승인 대기열 인덱스를 둡니다.

승인 전 사용자의 실제 역할은 `STUDENT`이고 `onboardingCompletedAt`도 비어 있습니다. 승인 트랜잭션에서만 `TEACHER` 역할, 학교, 부서와 완료 시각을 함께 반영합니다. 승인·반려 감사 액션과 신청·결과 알림 유형도 추가합니다.
