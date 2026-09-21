"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, Users } from "lucide-react";
import { StudentNumberEditor } from "@/components/admin/student-number-editor";

type GroupMember = {
  id: string;
  name: string | null;
  loginIdentifier: string;
  role: "SUPER_ADMIN" | "ADMIN" | "TEACHER" | "STUDENT";
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  studentNumber: number | null;
};

type MemberPage = {
  members: GroupMember[];
  page: number;
  totalCount: number;
  hasMore: boolean;
  error?: string;
};

export function GroupMemberDisclosure({
  schoolId,
  groupId,
  groupName,
  groupType,
  userCount,
}: {
  schoolId: string;
  groupId: string;
  groupName: string;
  groupType: "CLASS" | "DEPARTMENT";
  userCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const loadControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => loadControllerRef.current?.abort(), []);

  async function load(nextPage: number, replace = false) {
    if (pending) return;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/schools/${schoolId}/groups/${groupId}/members?page=${nextPage}&pageSize=20`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const result = await response.json() as MemberPage;
      if (!response.ok) throw new Error(result.error || "소속 구성원을 불러오지 못했습니다.");
      setMembers((current) => replace ? result.members : [...current, ...result.members]);
      setPage(result.page);
      setHasMore(result.hasMore);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "소속 구성원을 불러오지 못했습니다.");
    } finally {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null;
        setPending(false);
      }
    }
  }

  function toggle() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (!nextExpanded) loadControllerRef.current?.abort();
    if (nextExpanded && page === 0) void load(1, true);
  }

  return (
    <>
      <button
        type="button"
        className="school-group-members-trigger"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={`${groupId}-members`}
      >
        <Users size={12} />
        <span>{userCount}명</span>
        <ChevronDown size={13} className={expanded ? "rotated" : ""} />
      </button>
      {expanded ? (
        <div className="school-group-members-panel" id={`${groupId}-members`}>
          <header><b>{groupName} 구성원</b><span>{userCount}명</span></header>
          {members.length ? (
            <ul>
              {members.map((member) => (
                <li key={member.id}>
                  <span className="school-member-avatar" aria-hidden>{(member.name || "?")[0]}</span>
                  <span><b>{member.name || "이름 없음"}</b><small title={member.loginIdentifier}>{member.loginIdentifier}</small></span>
                  <em data-status={member.status.toLowerCase()}>{member.status === "ACTIVE" ? "활성" : "정지"}</em>
                  {groupType === "CLASS" && member.role === "STUDENT" ? (
                    <StudentNumberEditor
                      userId={member.id}
                      userName={member.name || "학생"}
                      initialValue={member.studentNumber}
                      source="소속 관리"
                      onSaved={(updated) => setMembers((current) => current.map((item) => item.id === updated.id ? { ...item, studentNumber: updated.studentNumber } : item))}
                    />
                  ) : groupType === "CLASS" ? <strong>학생 아님</strong> : null}
                </li>
              ))}
            </ul>
          ) : pending ? null : <p>소속된 구성원이 없습니다.</p>}
          {error ? <p className="form-error compact" role="alert">{error}</p> : null}
          {pending ? <div className="school-members-loading"><LoaderCircle size={15} className="spin" />불러오는 중…</div> : null}
          {hasMore && !pending ? <button type="button" className="button ghost school-members-more" onClick={() => void load(page + 1)}>더 보기</button> : null}
        </div>
      ) : null}
    </>
  );
}
