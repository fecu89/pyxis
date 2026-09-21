import { ClipboardCheck } from "lucide-react";
import { StatusBadge } from "@/components/ui/data-display";
import { EmptyState } from "@/components/ui/feedback";
import { formatDateTime } from "@/lib/format";
import type { StudentFormResponseHistoryEntry } from "@/lib/activity/students";

export function StudentFormHistory({ responses }: { responses: StudentFormResponseHistoryEntry[] }) {
  return (
    <section aria-labelledby="student-form-history-title">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand">Form responses</p>
          <h2 id="student-form-history-title" className="mt-1 text-xl font-black tracking-tight text-content">제출한 설문 응답</h2>
        </div>
        {responses.length > 0 ? <span className="text-xs font-bold text-content-muted">최근 {responses.length}개</span> : null}
      </div>

      {responses.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-6 w-6" />}
          title="아직 제출한 설문 응답이 없어요"
          description="로그인한 상태로 설문을 제출하면 문항별 응답이 이곳에 쌓입니다."
        />
      ) : (
        <div className="space-y-3">
          {responses.map((response) => (
            <details key={response.id} className="group overflow-hidden rounded-[22px] border border-line bg-surface shadow-sm" open={responses.length === 1}>
              <summary className="flex cursor-pointer list-none items-center gap-4 p-5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-progress-soft text-progress-soft-fg">
                  <ClipboardCheck className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge status="FORM" label="설문" />
                    <span className="text-xs font-bold text-content-muted">답변 {response.answers.length}개</span>
                  </span>
                  <span className="mt-2 block truncate text-base font-black text-content">{response.formTitle}</span>
                  <span className="mt-1 block text-xs text-content-subtle">
                    {response.submittedAt ? `${formatDateTime(response.submittedAt)} 제출` : "제출 시각 없음"}
                  </span>
                </span>
                <span className="text-content-subtle transition group-open:rotate-180" aria-hidden>⌄</span>
              </summary>

              <div className="border-t border-line bg-surface-muted/60 p-4 sm:p-5">
                {response.answers.length > 0 ? (
                  <ol className="space-y-2.5">
                    {response.answers.map((answer, index) => (
                      <li key={`${answer.fieldId}-${index}`} className="rounded-2xl border border-line bg-surface p-4">
                        <p className="text-xs font-black text-content-muted">문항 {index + 1} · {answer.fieldTitle}</p>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm font-bold leading-6 text-content">
                          {answer.value || <span className="font-normal text-content-subtle">(응답 없음)</span>}
                        </p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-content-subtle">저장된 문항별 답변이 없습니다.</p>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
