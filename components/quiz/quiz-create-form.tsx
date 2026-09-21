"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SubjectCombobox } from "@/components/quiz/subject-combobox";
import { InlineNotice } from "@/components/ui/feedback";
import { ArrowRightIcon, GlobeIcon, LockIcon } from "@/components/ui/icons";

/**
 * 새 퀴즈 생성 폼. **입력과 제출만** 클라이언트입니다.
 *
 * 예전에는 페이지 전체가 `"use client"`였고 교과목 목록을 `useEffect`로 불렀습니다. 그러면
 * 첫 HTML에는 교과목 칸이 비어 있다가 왕복 한 번 뒤에 채워집니다. 이제 서버 컴포넌트가 목록을
 * 읽어 프롭으로 내려주므로 첫 화면부터 들어 있고, 이 파일은 실제로 상호작용이 필요한 부분만
 * 맡습니다(껍데기·안내문은 서버가 그립니다).
 */
export function QuizCreateForm({ subjects }: { subjects: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [requiresLogin, setRequiresLogin] = useState(true);
  const [isSearchable, setIsSearchable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/quiz/quizzes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: description || undefined, subjectName: subjectName || undefined, requiresLogin, isSearchable }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error ?? "생성하지 못했습니다.");
      return;
    }
    router.push(`/quiz/${data.quiz.id}/edit`);
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-[28px] border border-line bg-surface p-6 shadow-sm sm:p-8">
      <label className="block text-sm font-black text-content">퀴즈 제목 <span className="text-danger">*</span>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="예: 3단원 마무리 퀴즈" className="mt-2 h-13 w-full rounded-2xl border border-line bg-surface-muted px-4 text-base font-bold outline-none transition placeholder:font-normal placeholder:text-content-subtle focus:border-brand-500 focus:bg-surface" />
        <span className="mt-2 block text-right text-[11px] font-medium text-content-subtle">{title.length} / 120</span>
      </label>
      <label className="mt-5 block text-sm font-black text-content">교과목 <span className="font-medium text-content-subtle">(선택)</span>
        <SubjectCombobox value={subjectName} onChange={setSubjectName} subjects={subjects} placeholder="직접 입력하거나 기존 과목을 선택하세요" className="mt-2" inputClassName="h-13 w-full rounded-2xl border border-line bg-surface-muted px-4 text-sm font-bold outline-none transition placeholder:font-normal placeholder:text-content-subtle focus:border-brand-500 focus:bg-surface" />
        <span className="mt-2 block text-[11px] font-medium text-content-subtle">새 이름을 입력하면 교과목 목록에도 자동으로 추가됩니다.</span>
      </label>
      <label className="mt-5 block text-sm font-black text-content">설명 <span className="font-medium text-content-subtle">(선택)</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={6} placeholder="퀴즈의 학습 목표나 범위를 적어주세요." className="mt-2 w-full resize-none rounded-2xl border border-line bg-surface-muted p-4 text-sm leading-6 outline-none transition placeholder:text-content-subtle focus:border-brand-500 focus:bg-surface" />
      </label>
      <fieldset className="mt-6">
        <legend className="text-sm font-black text-content">참여 방식</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={`cursor-pointer rounded-2xl border p-4 transition ${requiresLogin ? "border-brand-500 bg-brand-soft/40 ring-1 ring-brand-500" : "border-line bg-surface"}`}><input type="radio" checked={requiresLogin} onChange={() => setRequiresLogin(true)} className="sr-only" /><LockIcon className="h-5 w-5 text-brand" /><span className="mt-3 block text-sm font-black text-content">학생 로그인</span><span className="mt-1 block text-xs leading-5 text-content-muted">개인별 기록을 계속 보관합니다.</span></label>
          <label className={`cursor-pointer rounded-2xl border p-4 transition ${!requiresLogin ? "border-info-500 bg-info-50 ring-1 ring-info-500 dark:bg-info-400/10" : "border-line bg-surface"}`}><input type="radio" checked={!requiresLogin} onChange={() => setRequiresLogin(false)} className="sr-only" /><GlobeIcon className="h-5 w-5 text-info-700 dark:text-info-300" /><span className="mt-3 block text-sm font-black text-content">닉네임만 입력</span><span className="mt-1 block text-xs leading-5 text-content-muted">계정 없이 바로 참여합니다.</span></label>
        </div>
      </fieldset>
      <label className="mt-5 flex items-center justify-between gap-4 rounded-2xl bg-surface-muted p-4 ring-1 ring-line">
        <span><span className="block text-sm font-black text-content">검색 공개</span><span className="mt-1 block text-xs text-content-muted">켜면 다른 선생님이 퀴즈 탐색에서 찾아 열람·복제할 수 있어요.</span></span>
        <input type="checkbox" checked={isSearchable} onChange={(e) => setIsSearchable(e.target.checked)} className="h-5 w-5 accent-brand" />
      </label>
      {error && <div className="mt-5"><InlineNotice tone="error">{error}</InlineNotice></div>}
      <div className="mt-7 flex justify-end"><button type="submit" disabled={submitting || !title.trim()} className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-brand-strong px-6 py-3 text-sm font-black text-on-brand transition hover:-translate-y-0.5 hover:bg-brand-900 disabled:opacity-50">{submitting ? "만드는 중..." : "문항 만들러 가기"}<ArrowRightIcon className="h-4 w-4" /></button></div>
    </form>
  );
}
