import { FileClock } from "lucide-react";
import type { AuditLogRecord } from "@/components/admin/types";

const actionLabels: Record<string, string> = {
  USER_ROLE_CHANGED: "역할 변경",
  USER_STATUS_CHANGED: "계정 상태 변경",
  USER_ORGANIZATION_CHANGED: "학교·소속 변경",
  USER_DELETED: "회원 삭제",
  USER_SESSIONS_REVOKED: "세션 강제 해제",
  ADMIN_PERMISSION_GRANTED: "관리 권한 부여",
  ADMIN_PERMISSION_REVOKED: "관리 권한 회수",
  USER_PII_VIEWED: "개인정보 원문 조회",
  GLOBAL_POST_CREATED: "전역 콘텐츠 생성",
  GLOBAL_POST_UPDATED: "전역 콘텐츠 수정",
  GLOBAL_POST_HIDDEN: "전역 콘텐츠 숨김",
  GLOBAL_POST_RESTORED: "전역 콘텐츠 복구",
  GLOBAL_BOARD_UPDATED: "전역 패드 변경",
  BOARD_OWNERSHIP_TRANSFERRED: "패드 소유권 이전",
  BOARD_PASSWORD_VIEWED: "패드 공유 비밀번호 조회",
  GLOBAL_BOARD_ARCHIVED: "전역 패드 보관",
  GLOBAL_BOARD_RESTORED: "전역 패드 복구",
  GLOBAL_ENTITY_PURGED: "영구 삭제",
  SCHOOL_CREATED: "학교 추가",
  SCHOOL_UPDATED: "학교 정보 변경",
  SCHOOL_DELETED: "학교 삭제",
  SCHOOL_GROUP_CREATED: "반·부서 추가",
  SCHOOL_GROUP_UPDATED: "반·부서 정보 변경",
  SCHOOL_GROUP_DELETED: "반·부서 삭제",
  SCHOOL_REPRESENTATIVE_GRANTED: "학교 대표교사 지정",
  SCHOOL_REPRESENTATIVE_REVOKED: "학교 대표교사 해제",
  STUDENT_ACADEMIC_STATUS_CHANGED: "학생 학적 상태 변경",
  STUDENTS_CLASS_MOVED: "학생 반 이동",
  ACADEMIC_YEAR_PROMOTED: "학년도 진급 처리",
  ACCOUNT_APPROVAL_APPROVED: "새 계정 가입 승인",
  ACCOUNT_APPROVAL_REJECTED: "새 계정 가입 반려",
  TEACHER_APPROVAL_APPROVED: "교사 가입 승인",
  TEACHER_APPROVAL_REJECTED: "교사 가입 반려",
  STUDENT_ROSTER_IMPORTED: "학생 명단 일괄 등록",
  USER_PASSWORD_RESET: "비밀번호 초기화",
  USER_PASSWORD_SET: "비밀번호 지정",
  SYSTEM_SETTINGS_UPDATED: "시스템 설정 변경",
};

type AuditLogListProps = {
  logs: AuditLogRecord[];
  hasMore: boolean;
  pending: boolean;
  onLoadMore: () => void;
  onRefresh: () => void;
};

export function AuditLogList({ logs, hasMore, pending, onLoadMore, onRefresh }: AuditLogListProps) {
  return (
    <section className="admin-panel" aria-labelledby="audit-title">
      <header className="admin-panel-header">
        <div><span className="admin-kicker">IMMUTABLE HISTORY</span><h2 id="audit-title">감사 로그</h2><p>관리자 권한 변경과 전역 콘텐츠 작업을 확인합니다.</p></div>
        <button type="button" className="button ghost" onClick={onRefresh} disabled={pending}>새로고침</button>
      </header>
      {logs.length ? (
        <ol className="audit-list">
          {logs.map((log) => (
            <li key={log.id}>
              <span className="audit-icon"><FileClock size={17} /></span>
              <div className="audit-copy">
                <div><strong>{actionLabels[log.action] ?? log.action}</strong><time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</time></div>
                <p>{log.actor.name || "관리자"}{log.targetUser ? ` → ${log.targetUser.name || "사용자"}` : ""}{log.entityType ? ` · ${log.entityType}` : ""}</p>
                {log.reason && <blockquote>{log.reason}</blockquote>}
                {(log.before !== null || log.after !== null) && (
                  <details><summary>변경 데이터</summary><pre>{JSON.stringify({ before: log.before, after: log.after }, null, 2)}</pre></details>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="admin-empty">표시할 감사 로그가 없습니다.</p>}
      {hasMore && <button type="button" className="button soft admin-load-more" onClick={onLoadMore} disabled={pending}>{pending ? "불러오는 중…" : "더 보기"}</button>}
    </section>
  );
}
