// 스키마의 열거형을 여기서 다시 손으로 적지 않고 생성된 타입을 그대로 씁니다. quiz 병합으로
// SystemPermission에 퀴즈 권한 4개가 늘었을 때, 손으로 적은 유니온은 조용히 뒤처져 서버가 내려준
// 값을 타입이 거부하는 상태가 됩니다. 생성 타입을 쓰면 permissionLabels 같은
// Record<SystemPermission, string>이 컴파일 단계에서 누락을 잡아줍니다.
// (generated/prisma/enums는 순수 타입·상수 모듈이라 클라이언트 컴포넌트에서도 안전합니다.)
import type { SystemPermission, UserRole, UserStatus } from "@/generated/prisma/enums";
import type { AdminSection } from "@/lib/admin/navigation";

export type { SystemPermission, UserRole, UserStatus };

// 관리자 하위 라우트 식별자. URL·권한·레거시 `?tab=` 리다이렉트가 같은 유니온을 씁니다.
export type AdminTab = AdminSection;

export type AdminUserRecord = {
  id: string;
  name: string | null;
  loginIdentifier: string;
  loginType: "LOGIN_ID" | "KAKAO_EMAIL";
  role: UserRole;
  status: UserStatus;
  authVersion: number;
  hasPasswordCredential: boolean;
  mustChangePassword: boolean;
  studentNumber: number | null;
  lastLoginAt: string | null;
  createdAt: string;
  ownedBoardCount: number;
  memberBoardCount: number;
  systemPermissions: SystemPermission[];
  school: { id: string; name: string } | null;
  schoolGroup: { id: string; name: string; type: "CLASS" | "DEPARTMENT" } | null;
  isSchoolRepresentative: boolean;
};

export type SchoolDirectoryItem = {
  id: string;
  name: string;
  code: string | null;
  level: "ELEMENTARY" | "MIDDLE" | "HIGH";
  district: string | null;
  operatingStatus: "OPERATING" | "PLANNED" | "INACTIVE";
  userCount: number;
  studentCount: number;
  teacherCount: number;
  unnumberedStudentCount: number;
  unassignedStudentCount: number;
  isDefault: boolean;
  groups: {
    id: string;
    name: string;
    type: "CLASS" | "DEPARTMENT";
    grade: number | null;
    classNumber: number | null;
    userCount: number;
    isDefault: boolean;
  }[];
};

// "소속 관리" 탭(SchoolManager)에서만 쓰는, 학교별 활성 교사 명단까지 포함한 무거운 버전입니다.
// 이 명단은 getAdminSchoolPage()로 페이지 단위로만 가져오므로 SchoolDirectoryItem과 분리했습니다.
export type SchoolManagementItem = SchoolDirectoryItem & {
  teachers: { id: string; name: string | null; departmentName: string | null; isSchoolRepresentative: boolean }[];
};

export type AuditLogRecord = {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
  actor: { id: string; name: string | null; image: string | null };
  targetUser: { id: string; name: string | null; image: string | null } | null;
};

export type AdminActor = {
  id: string;
  name: string | null;
  role: UserRole;
  systemPermissions: SystemPermission[];
  school: { id: string; name: string } | null;
  isSchoolRepresentative: boolean;
};

export type TeacherApprovalRecord = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewReason: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  user: { id: string; name: string | null; loginIdentifier: string; loginType: "LOGIN_ID" | "KAKAO_EMAIL"; image: string | null };
  school: { id: string; name: string };
  schoolGroup: { id: string; name: string };
};

// 관리자 센터 "전체 패드" 탭(getAdminBoardPage) 전용 요약 타입입니다. 홈 대시보드의
// DashboardBoard/BoardSummary와 달리 소유자 역할(ownerRole)을 그대로 노출합니다 — 이 화면
// 자체가 플랫폼 전체를 훑어보는 관리 도구라, 어떤 역할의 소유자인지 바로 보여줘야 합니다.
export type AdminBoardRecord = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  backgroundImageUrl: string | null;
  discoveryScope: "PRIVATE" | "LINK" | "PUBLIC";
  attachmentDownloadPolicy: "READERS" | "MEMBERS" | "EDITORS" | "DISABLED";
  isTemplate: boolean;
  updatedAt: string;
  deletedAt: string | null;
  // 소유자 계정이 삭제됐는데 승계 대상을 못 찾은 패드는 소유자가 비어 있습니다.
  owner: { id: string; name: string | null };
  ownerRole: UserRole | null;
  _count: { sections: number; posts: number };
};

// 관리자 센터 "전체 퀴즈" 탭(getAdminQuizPage) 전용 요약 타입입니다. Quiz.ownerId는 필수 관계라
// AdminBoardRecord와 달리 owner가 항상 존재합니다(승계 실패는 deletedAt이 아니라 frozenAt으로
// 표현됩니다 — 아래 frozen 참고).
export type AdminQuizRecord = {
  id: string;
  title: string;
  isPublished: boolean;
  requiresLogin: boolean;
  updatedAt: string;
  deletedAt: string | null;
  // 소유자 계정이 삭제됐는데 이어받을 사람이 없어 편집·발행·새 세션이 막힌 상태입니다.
  frozen: boolean;
  owner: { id: string; name: string | null };
  ownerRole: UserRole;
  _count: { questions: number; sessions: number };
};

// 관리자 센터 "전체 설문" 탭(getAdminFormPage) 전용 요약 타입입니다. AdminQuizRecord와 같은 이유로
// owner가 항상 존재하고 frozen 개념도 같습니다.
export type AdminFormRecord = {
  id: string;
  title: string;
  status: "DRAFT" | "OPEN" | "CLOSED";
  requiresLogin: boolean;
  slug: string;
  updatedAt: string;
  deletedAt: string | null;
  frozen: boolean;
  owner: { id: string; name: string | null };
  ownerRole: UserRole;
  _count: { fields: number; responses: number };
};
