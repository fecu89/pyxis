import "server-only";

import type { SystemPermission, UserRole } from "@/generated/prisma/client";
import { requireCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { getBoardAccess } from "@/lib/board/permissions";
import { canManageAnySession, canViewAllQuizzes, canViewStudentReport, hasSystemPermission } from "@/lib/auth/permissions";
import { getPlatformSecurityPolicy } from "@/lib/security/platform-policy";
import { boardAcceptsGuestPosts, visitorGrantsPermission } from "@/lib/board/visitor-policy";

// DB·세션에 의존하지 않는 순수 판정은 lib/auth/permissions.ts에 있습니다. 이 모듈은
// "server-only"라 커스텀 소켓 서버에서 가져올 수 없어서 갈라 두었고, 기존 호출부가 그대로
// 동작하도록 여기서 다시 내보냅니다.
export { canManageAnySession, canViewAllQuizzes, canViewStudentReport, hasSystemPermission, boardAcceptsGuestPosts };
export type { PermissionHolder } from "@/lib/auth/permissions";

export type AuthorizationUser = Pick<CurrentUser, "id" | "role" | "systemPermissions" | "school" | "isSchoolRepresentative">;
export type EffectiveBoardAccess = NonNullable<Awaited<ReturnType<typeof getBoardAccess>>>;

export class AuthorizationError extends Error {
  constructor(message = "이 작업을 수행할 권한이 없습니다.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export async function requireActiveUser() {
  return requireCurrentUser();
}

export async function requireRole(allowedRoles: UserRole[]) {
  const user = await requireActiveUser();
  if (!allowedRoles.includes(user.role)) throw new AuthorizationError();
  return user;
}

export async function requireSystemPermission(permission: SystemPermission) {
  const user = await requireActiveUser();
  if (!hasSystemPermission(user, permission)) throw new AuthorizationError();
  return user;
}

export async function requireAnySystemPermission(permissions: SystemPermission[]) {
  const user = await requireActiveUser();
  if (!permissions.some((permission) => hasSystemPermission(user, permission))) {
    throw new AuthorizationError();
  }
  return user;
}

export function canAccessAdminShell(user: AuthorizationUser) {
  return user.role === "SUPER_ADMIN"
    || (user.role === "ADMIN" && user.systemPermissions.length > 0)
    || (user.role === "TEACHER" && user.school !== null);
}

// 학교 대표교사(TEACHER + isSchoolRepresentative)가 특정 학교에 대한 배치·반/부서 관리 권한이
// 있는지. 자기 학교(school.id)에 한해서만 true입니다 — 다른 학교는 SUPER_ADMIN만.
export function isSchoolRepresentativeFor(user: AuthorizationUser, schoolId: string) {
  return user.role === "TEACHER" && user.isSchoolRepresentative && user.school?.id === schoolId;
}

export function canManageSchoolGroups(user: AuthorizationUser) {
  return user.role === "SUPER_ADMIN"
    || (user.role === "ADMIN" && hasSystemPermission(user, "CHANGE_NON_ADMIN_ROLES"))
    || (user.role === "TEACHER" && user.isSchoolRepresentative);
}

// app/admin/page.tsx의 "소속 관리"·"학교 대시보드" 탭 노출 조건과 동일한 기준입니다.
// 학교 목록을 응답하는 API 라우트(예: /api/admin/schools GET)에서도 그대로 재사용해
// 화면 노출 조건과 서버 권한 검사가 따로 놀지 않게 합니다.
export function canViewSchoolDirectory(user: AuthorizationUser) {
  return user.role === "SUPER_ADMIN"
    || (user.role === "ADMIN" && (hasSystemPermission(user, "VIEW_USERS") || canManageSchoolGroups(user)))
    || (user.role === "TEACHER" && user.school !== null);
}

export function canCreateBoard(user: AuthorizationUser) {
  return user.role === "SUPER_ADMIN"
    || user.role === "ADMIN"
    || user.role === "TEACHER"
    || user.role === "STUDENT";
}

export async function getEffectiveBoardAccess(boardId: string, user: AuthorizationUser | null) {
  return getBoardAccess(boardId, user?.id ?? null);
}

function visitorGrantsAtLeast(access: EffectiveBoardAccess, level: Parameters<typeof visitorGrantsPermission>[1]) {
  return visitorGrantsPermission(access.board, level);
}

export function canReadEffectiveBoard(user: AuthorizationUser | null, access: EffectiveBoardAccess) {
  if (access.role !== null) return true;
  if (user && hasSystemPermission(user, "VIEW_ALL_BOARDS")) return true;
  // PRIVATE는 발견 범위와 무관하게 초대된 멤버만 접근합니다 — 링크·검색 노출과 방문자 권한은 LINK/PUBLIC에서만 의미가 있습니다.
  if (access.board.discoveryScope === "PRIVATE") return false;
  // LINK 자체가 "링크 보유자의 익명 읽기"를 뜻합니다. loginRequired/visitorPermission이
  // 예전 값으로 남은 보드도 여기서 읽을 수 있게 하되, 쓰기는 별도 방문자 권한으로 판정합니다.
  if (access.board.discoveryScope === "LINK") return true;
  if (access.board.loginRequired && !user) return false;
  return access.board.visitorPermission !== "NO_ACCESS";
}

// 교사는 학생이 소유한 패드는 삭제·복구·영구삭제할 수 있지만, 다른 교사의 패드는 건드릴 수
// 없습니다(교사끼리는 서로의 패드에 대한 관리 권한이 없음 — 사용자 요청).
function canManageStudentOwnedBoard(user: AuthorizationUser, access: EffectiveBoardAccess) {
  return user.role === "TEACHER" && access.board.owner?.role === "STUDENT";
}

export function canArchiveBoard(user: AuthorizationUser, access: EffectiveBoardAccess) {
  return user.role === "SUPER_ADMIN" || access.isOwner || canManageStudentOwnedBoard(user, access);
}

export function canRestoreBoard(user: AuthorizationUser, access: EffectiveBoardAccess) {
  return user.role === "SUPER_ADMIN" || access.isOwner || canManageStudentOwnedBoard(user, access);
}

export function canPurgeBoard(user: AuthorizationUser, access: EffectiveBoardAccess) {
  return user.role === "SUPER_ADMIN" || access.isOwner || canManageStudentOwnedBoard(user, access);
}

// 승인 모드에 따라 새 글이 바로 게시될지 승인 대기로 들어갈지 결정합니다(padupgrade.md 5.3).
// STUDENTS_ONLY는 학생이 아닌 작성자는 바로 게시하고, MANUAL은 보드 소유자·관리자가 써도 승인이 필요합니다.
export function determineInitialPostStatus(user: AuthorizationUser, access: EffectiveBoardAccess) {
  const mode = access.board.moderationMode;
  if (mode === "NONE") return "PUBLISHED" as const;
  if (mode === "STUDENTS_ONLY" && user.role !== "STUDENT") return "PUBLISHED" as const;
  return "PENDING" as const;
}

export function canModeratePosts(user: AuthorizationUser, access: EffectiveBoardAccess) {
  return canManageBoardSettings(user, access);
}

// 수동 동결(state)이거나, 예약한 마감 시각(freezeAt)이 이미 지났으면 동결로 취급합니다.
// 별도 스케줄러 없이 요청마다 즉시 판정하므로 "마감 시각 예약"에 백그라운드 잡이 필요 없습니다.
export function isBoardFrozen(access: EffectiveBoardAccess) {
  if (access.board.state === "FROZEN") return true;
  return Boolean(access.board.freezeAt && access.board.freezeAt.getTime() <= Date.now());
}

export function canManageBoardSettings(user: AuthorizationUser, access: EffectiveBoardAccess) {
  return user.role === "SUPER_ADMIN"
    || hasSystemPermission(user, "MANAGE_BOARD_SETTINGS")
    || access.role === "OWNER"
    || access.role === "ADMIN";
}

export function canTransferBoardOwnership(user: AuthorizationUser) {
  return user.role === "SUPER_ADMIN" || hasSystemPermission(user, "TRANSFER_BOARD_OWNERSHIP");
}

export function canCreatePost(user: AuthorizationUser, access: EffectiveBoardAccess) {
  if (user.role === "SUPER_ADMIN" || hasSystemPermission(user, "CREATE_CONTENT_ANYWHERE")) return true;
  if (access.role && access.role !== "VIEWER") return access.role !== "MEMBER" || access.board.allowMemberPosting;
  // LINK/PUBLIC에서 로그인한 비멤버도 방문자 WRITER 권한으로 참여합니다.
  return visitorGrantsAtLeast(access, "WRITER");
}

/**
 * 손님이 쓴 글의 최초 상태입니다. 로그인 사용자용 determineInitialPostStatus와 나란히 둡니다.
 *
 * 기본은 **승인 대기**입니다 — 익명 글은 작성자를 특정할 수 없어 사고가 나면 되돌리기 어렵고,
 * 학교 화면에 그대로 노출되면 피해가 즉시 발생합니다. 실시간 수업처럼 바로 보여야 하는 자리는
 * 교사가 보드 설정에서 끌 수 있습니다(guestPostsRequireApproval = false).
 *
 * 보드의 moderationMode가 이미 승인을 요구하면 그쪽도 존중합니다 — 둘 중 하나라도 승인을
 * 요구하면 승인 대기입니다.
 */
export function determineGuestPostStatus(board: {
  guestPostsRequireApproval: boolean;
  moderationMode: EffectiveBoardAccess["board"]["moderationMode"];
}) {
  if (board.guestPostsRequireApproval) return "PENDING" as const;
  // 보드가 이미 전원 승인(MANUAL)을 요구하면 손님도 당연히 승인 대기입니다.
  return board.moderationMode === "MANUAL" ? ("PENDING" as const) : ("PUBLISHED" as const);
}

/**
 * 손님이 자기가 쓴 것을 고치거나 지울 수 있는지. 다른 손님 것은 절대 건드릴 수 없습니다.
 * 글과 댓글이 같은 규칙(작성자는 계정 XOR 손님)이라 한 함수로 봅니다.
 */
export function guestOwnsContent(content: { authorId: string | null; guestId: string | null }, guestId: string | null) {
  return Boolean(guestId && content.guestId && content.guestId === guestId && content.authorId === null);
}

export const guestOwnsPost = guestOwnsContent;

/**
 * 손님이 이 보드에 댓글을 달 수 있는지. 글쓰기와 **같은 문**을 씁니다 — 손님 글을 받는 보드면
 * 손님 댓글도 받습니다. 다만 보드가 댓글 자체를 껐으면(allowComments) 회원과 똑같이 막힙니다.
 *
 * 승인 대기 개념은 댓글에 없습니다(Comment에는 status가 없습니다). 손님 댓글도 회원 댓글처럼
 * 바로 보이고, 부적절하면 관리자가 지웁니다.
 */
export function boardAcceptsGuestComments(board: Parameters<typeof boardAcceptsGuestPosts>[0] & { allowComments: boolean }) {
  return boardAcceptsGuestPosts(board) && board.allowComments;
}

export function canUploadFile(user: AuthorizationUser, access: EffectiveBoardAccess) {
  if (user.role === "SUPER_ADMIN" || hasSystemPermission(user, "EDIT_ANY_CONTENT")) return true;
  if (access.role && access.role !== "VIEWER") return access.role !== "MEMBER" || access.board.allowMemberFileUpload;
  return visitorGrantsAtLeast(access, "WRITER");
}

export function canComment(user: AuthorizationUser, access: EffectiveBoardAccess) {
  if (user.role === "SUPER_ADMIN" || hasSystemPermission(user, "CREATE_CONTENT_ANYWHERE")) return true;
  if (!canReadEffectiveBoard(user, access) || !access.board.allowComments) return false;
  if (access.role !== null) return access.role !== "VIEWER";
  return visitorGrantsAtLeast(access, "COMMENTER");
}

export function canReact(user: AuthorizationUser, access: EffectiveBoardAccess) {
  if (user.role === "SUPER_ADMIN") return true;
  if (!canReadEffectiveBoard(user, access) || !access.board.allowReactions) return false;
  if (access.role !== null) return access.role !== "VIEWER";
  return visitorGrantsAtLeast(access, "COMMENTER");
}

export function canDownloadAttachment(user: AuthorizationUser | null, access: EffectiveBoardAccess) {
  if (!canReadEffectiveBoard(user, access)) return false;
  if (user?.role === "SUPER_ADMIN" || (user && hasSystemPermission(user, "EDIT_ANY_CONTENT"))) return true;
  switch (access.board.attachmentDownloadPolicy) {
    case "READERS":
      return true;
    case "MEMBERS":
      return access.role !== null;
    case "EDITORS":
      return ["OWNER", "ADMIN", "EDITOR"].includes(access.role ?? "");
    default:
      return false;
  }
}

export function canDeleteComment(args: {
  user: AuthorizationUser;
  access: EffectiveBoardAccess;
  commentAuthorId: string | null;
}) {
  if (args.user.role === "SUPER_ADMIN" || hasSystemPermission(args.user, "MODERATE_CONTENT")) return true;
  if (["OWNER", "ADMIN", "EDITOR"].includes(args.access.role ?? "")) return true;
  if (args.access.role === null && args.access.board.discoveryScope !== "PUBLIC" && !visitorGrantsAtLeast(args.access, "COMMENTER")) return false;
  if (args.access.role === "VIEWER") return false;
  return args.user.id === args.commentAuthorId;
}

export function canEditComment(args: {
  user: AuthorizationUser;
  access: EffectiveBoardAccess;
  commentAuthorId: string | null;
}) {
  if (args.user.role === "SUPER_ADMIN" || hasSystemPermission(args.user, "EDIT_ANY_CONTENT")) return true;
  if (args.access.role === null && args.access.board.discoveryScope !== "PUBLIC" && !visitorGrantsAtLeast(args.access, "COMMENTER")) return false;
  if (args.access.role === "VIEWER") return false;
  return args.user.id === args.commentAuthorId;
}

export function canEditPost(args: {
  user: AuthorizationUser;
  access: EffectiveBoardAccess;
  postAuthorId: string | null;
}) {
  if (args.user.role === "SUPER_ADMIN" || hasSystemPermission(args.user, "EDIT_ANY_CONTENT")) return true;
  if (args.access.role === null && args.access.board.discoveryScope !== "PUBLIC" && !visitorGrantsAtLeast(args.access, "WRITER")) return false;
  if (args.access.role === "VIEWER") return false;
  if (args.access.role && ["OWNER", "ADMIN", "EDITOR"].includes(args.access.role)) return true;
  // LINK/PUBLIC 방문자 WRITER 권한으로 쓴 글도 작성자 본인은 수정할 수 있습니다.
  return args.user.id === args.postAuthorId;
}

export function canModeratePost(args: {
  user: AuthorizationUser;
  access: EffectiveBoardAccess;
  postAuthorId: string | null;
}) {
  if (args.user.role === "SUPER_ADMIN" || hasSystemPermission(args.user, "MODERATE_CONTENT")) return true;
  return canEditPost(args);
}

export function canPurgePost(args: {
  user: AuthorizationUser;
  access: EffectiveBoardAccess;
  postAuthorId: string | null;
}) {
  return canModeratePost(args);
}

export function canPurgeComment(args: {
  user: AuthorizationUser;
  access: EffectiveBoardAccess;
  commentAuthorId: string | null;
}) {
  return canDeleteComment(args);
}

// commentAuthorId가 있으면 댓글에 달린 첨부(이미지 포함)이므로 댓글 삭제 권한 기준으로,
// 없으면 게시물에 바로 달린 첨부이므로 게시물 수정 권한 기준으로 판단합니다.
export function canPurgeAttachment(args: {
  user: AuthorizationUser;
  access: EffectiveBoardAccess;
  postAuthorId: string | null;
  commentAuthorId: string | null;
}) {
  if (args.commentAuthorId !== null) {
    return canDeleteComment({ user: args.user, access: args.access, commentAuthorId: args.commentAuthorId });
  }
  return canEditPost({ user: args.user, access: args.access, postAuthorId: args.postAuthorId });
}

export function canPurgeSection(user: AuthorizationUser, access: EffectiveBoardAccess) {
  return canManageBoardSettings(user, access);
}

export function isBoardScopedManagement(access: EffectiveBoardAccess) {
  return access.role === "OWNER" || access.role === "ADMIN";
}

export function isBoardScopedPostEdit(access: EffectiveBoardAccess, userId: string, postAuthorId: string | null) {
  return Boolean(access.role && access.role !== "VIEWER" && (["OWNER", "ADMIN", "EDITOR"].includes(access.role) || userId === postAuthorId));
}

export function isBoardScopedCommentCreate(access: EffectiveBoardAccess) {
  return Boolean(access.board.allowComments && access.role && access.role !== "VIEWER");
}

export function isBoardScopedCommentModeration(access: EffectiveBoardAccess, userId: string, commentAuthorId: string | null) {
  return Boolean(access.role && access.role !== "VIEWER" && (["OWNER", "ADMIN", "EDITOR"].includes(access.role) || userId === commentAuthorId));
}

export function canAssignBoardRole(targetRole: UserRole, boardRole: "ADMIN" | "EDITOR" | "MEMBER" | "VIEWER") {
  if (targetRole === "STUDENT") return boardRole === "MEMBER" || boardRole === "VIEWER";
  return true;
}

function describeWindow(minutes: number) {
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}일`;
  if (minutes % 60 === 0) return `${minutes / 60}시간`;
  return `${minutes}분`;
}

export async function requireRecentAuthentication(
  user: Pick<CurrentUser, "lastLoginAt">,
  minutes?: number,
) {
  const resolvedMinutes = minutes ?? (await getPlatformSecurityPolicy()).adminReauthWindowMinutes;
  const threshold = Date.now() - resolvedMinutes * 60_000;
  if (!user.lastLoginAt || user.lastLoginAt.getTime() < threshold) {
    throw new AuthorizationError(`보안을 위해 ${describeWindow(resolvedMinutes)} 안에 로그인한 계정만 이 작업을 할 수 있습니다. 다시 로그인한 뒤 시도해 주세요.`);
  }
}

// ── 퀴즈 도메인 ────────────────────────────────────────────────
// quiz 프로젝트에서 이식했습니다. 학생 관리 판정은 pad의 소속 기준으로 바꿨습니다 —
// 병합 스키마에는 quiz의 `createdById`(발급자 추적)가 없고, 같은 학교 대표교사인지로 판정합니다.

export function canManageQuiz(user: AuthorizationUser, quiz: { ownerId: string }) {
  return quiz.ownerId === user.id || hasSystemPermission(user, "EDIT_ANY_QUIZ");
}

/** 학생 계정 관리는 (1) 같은 학교 대표교사, (2) 계정 발급 권한이 있는 관리자입니다. */
export function canManageStudent(actor: AuthorizationUser, student: { schoolId: string | null }) {
  if (hasSystemPermission(actor, "ISSUE_STUDENT_ACCOUNTS")) return true;
  if (actor.role !== "TEACHER") return false;
  return Boolean(student.schoolId) && isSchoolRepresentativeFor(actor, student.schoolId!);
}

export function canHostOrControlSession(user: AuthorizationUser, session: { hostId: string }) {
  return user.id === session.hostId || hasSystemPermission(user, "MANAGE_ANY_SESSION");
}

export function canViewSessionReport(
  user: AuthorizationUser,
  session: { hostId: string },
  participant?: { userId: string | null } | null,
) {
  if (canHostOrControlSession(user, session)) return true;
  return participant?.userId === user.id;
}
