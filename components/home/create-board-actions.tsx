"use client";

import {
  createContext,
  useContext,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { SubjectCombobox } from "@/components/quiz/subject-combobox";
import { MemberCandidateSearch, type MemberCandidate } from "@/components/pad/settings/member-candidate-search";
import styles from "@/components/home/create-board-actions.module.css";

type CreateBoardActionsValue = {
  openCreate: () => void;
};

const CreateBoardActionsContext = createContext<CreateBoardActionsValue | null>(null);

function useCreateBoardActions() {
  const value = useContext(CreateBoardActionsContext);
  if (!value) throw new Error("패드 생성 액션은 CreateBoardActionsProvider 안에서 사용해야 합니다.");
  return value;
}

export function CreateBoardActionsProvider({ children, courses }: { children: ReactNode; courses: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [subjectName, setSubjectName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<MemberCandidate[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function createBoard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    // 발견 범위·방문자 권한·로그인 필수를 매번 따로 고르지 않도록, 자주 쓰는 3가지 조합을 프리셋으로 묶었습니다.
    // 더 세밀한 조정은 보드 설정의 공유 패널에서 할 수 있습니다.
    const preset = String(form.get("visibilityPreset") ?? "private");
    const presets = {
      private: { discoveryScope: "PRIVATE", visitorPermission: "NO_ACCESS", loginRequired: true },
      link: { discoveryScope: "LINK", visitorPermission: "READER", loginRequired: false },
      public: { discoveryScope: "PUBLIC", visitorPermission: "READER", loginRequired: false },
    } as const;
    try {
      const response = await fetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description"),
          subjectName: subjectName.trim() || undefined,
          memberIds: selectedMembers.map((member) => member.id),
          ...presets[preset as keyof typeof presets],
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; board?: { slug: string } };
      if (!response.ok || !result.board) {
        setError(result.error || "패드를 만들지 못했습니다.");
        return;
      }
      setCreateOpen(false);
      router.push(`/b/${result.board.slug}`);
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  const value: CreateBoardActionsValue = {
    openCreate: () => {
      setError("");
      setSubjectName("");
      setSelectedMembers([]);
      setSubmitting(false);
      setCreateOpen(true);
    },
  };

  return (
    <CreateBoardActionsContext.Provider value={value}>
      {children}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="새 패드 만들기"
        description="생각을 모을 새로운 공간을 열어 보세요."
        className={styles.modal}
      >
        <form className={`stack-form ${styles.form}`} onSubmit={createBoard}>
          <label>패드 이름<input name="title" placeholder="예: 우리 반 환경 프로젝트" required maxLength={120} autoFocus /></label>
          <label>한 줄 소개<textarea name="description" placeholder="이 패드에서 함께 할 일을 알려주세요." rows={3} maxLength={500} /></label>
          {/* quiz 생성과 같은 자유 입력 + 기존 과목 제안. 새 이름이면 생성 시점에 내 교과목으로 만들어집니다. */}
          <label>교과목<SubjectCombobox value={subjectName} onChange={setSubjectName} subjects={courses} placeholder="직접 입력하거나 기존 과목을 선택하세요 (선택)" inputClassName="" /></label>
          <label>공개 범위<select name="visibilityPreset" defaultValue="private"><option value="private">비공개 · 나와 초대된 멤버</option><option value="link">링크 공개 · 링크를 가진 사람</option><option value="public">전체 공개 · 목록·검색에 노출</option></select></label>
          <section className={styles.optionalSection} aria-labelledby="create-board-members">
            <div className={styles.optionalHeader}><span id="create-board-members">초대 멤버</span><small>{selectedMembers.length ? `${selectedMembers.length}명 선택` : "선택 안 함"}</small></div>
            {selectedMembers.length > 0 && <ul className={styles.selectedList}>{selectedMembers.map((member) => <li key={member.id}><span>{member.name || member.loginIdentifier}</span><button type="button" aria-label={`${member.name || member.loginIdentifier} 선택 해제`} title="선택 해제" onClick={() => setSelectedMembers((current) => current.filter((item) => item.id !== member.id))}><X size={13} aria-hidden /></button></li>)}</ul>}
            <MemberCandidateSearch
              endpoint="/api/boards/member-candidates"
              excludedIds={selectedMembers.map((member) => member.id)}
              retainAfterSelect
              onSelect={(candidate) => setSelectedMembers((current) => {
                if (current.some((item) => item.id === candidate.id)) return current;
                if (current.length >= 100) throw new Error("초대 멤버는 최대 100명까지 선택할 수 있습니다.");
                return [...current, candidate];
              })}
            />
          </section>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button primary full" disabled={submitting} aria-busy={submitting}>{submitting ? <LoaderCircle className="spin" size={17} aria-hidden /> : <ArrowRight size={17} aria-hidden />}{submitting ? "만드는 중..." : "패드 만들기"}</button>
        </form>
      </Modal>
    </CreateBoardActionsContext.Provider>
  );
}

export function CreateBoardButton({ className, children }: { className: string; children: ReactNode }) {
  const { openCreate } = useCreateBoardActions();
  return <button type="button" className={className} data-home-action="create-board" onClick={openCreate}>{children}</button>;
}
