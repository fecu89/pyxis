import Link from "next/link";
import { CheckIcon, ClockIcon, TrophyIcon, XIcon } from "@/components/ui/icons";
import { StatusBadge } from "@/components/ui/data-display";
import { ProgressBar } from "@/components/ui/feedback";
import type { QuestionType } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/format";
import { questionTypeLabel } from "@/lib/quiz/question-label";

export type SelfSessionReport = {
  quizTitle: string;
  mode: "LIVE" | "ASYNC";
  score: number;
  maxScore: number;
  joinedAt: Date | string;
  completedAt: Date | string | null;
  pendingQuestionCount?: number;
  questions: Array<{
    questionId: string;
    questionType: QuestionType;
    text: string;
    chosenChoiceText: string | null;
    correctChoiceText: string | null;
    isCorrect: boolean;
    pointsAwarded: number;
    maxPoints: number;
    responseTimeMs: number | null;
    answered: boolean;
  }>;
};

export function SelfSessionReportView({ report, returnHref, publicAccess = false }: { report: SelfSessionReport; returnHref: string; publicAccess?: boolean }) {
  const correctCount = report.questions.filter((question) => question.isCorrect).length;
  const accuracy = report.questions.length ? Math.round(correctCount / report.questions.length * 100) : 0;
  return (
    <>
      <section className="mb-6 overflow-hidden rounded-[28px] bg-brand-strong p-7 text-on-brand shadow-xl shadow-brand-950/10"><div className="soft-dots"><div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"><div><div className="flex items-center gap-2"><StatusBadge status={report.mode} /><span className="text-xs font-bold text-brand-100/60">{report.completedAt ? `${formatDateTime(report.completedAt)} 완료` : `${formatDateTime(report.joinedAt)} 참여`}</span></div><p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-info-300">Final score</p><p className="mt-2 text-5xl font-black tracking-[-0.06em]">{report.score.toLocaleString("ko-KR")}<span className="ml-2 text-lg text-brand-100/50">/ {report.maxScore.toLocaleString("ko-KR")}</span></p></div><TrophyIcon className="h-20 w-20 text-info-300/30" /></div><div className="mt-6"><ProgressBar value={correctCount} max={report.questions.length || 1} label={`정답률 ${accuracy}% · ${correctCount}/${report.questions.length}`} /></div></div></section>
      <div className="space-y-3">{report.questions.map((question, index) => <article key={question.questionId} className="rounded-[22px] border border-line bg-surface p-5"><div className="flex items-start gap-3"><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${question.isCorrect ? "bg-brand-soft text-brand-soft-fg" : "bg-danger-soft text-danger-soft-fg"}`}>{question.isCorrect ? <CheckIcon className="h-4 w-4" /> : <XIcon className="h-4 w-4" />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><p className="text-xs font-black text-content-subtle">문항 {index + 1}</p><StatusBadge status={question.questionType} label={questionTypeLabel(question.questionType)} /></div><p className="text-xs font-black text-brand">{question.pointsAwarded.toLocaleString("ko-KR")} / {question.maxPoints.toLocaleString("ko-KR")}점</p></div><h2 className="mt-3 text-sm font-black leading-6 text-content">{question.text}</h2><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className={`rounded-xl p-3 text-xs font-bold ${question.isCorrect ? "bg-brand-soft/40 text-brand" : "bg-danger-soft text-danger-soft-fg"}`}><span className="mb-1 block text-[10px] opacity-60">내 답</span>{question.answered ? question.chosenChoiceText ?? "(무응답)" : "(미제출)"}</div><div className="rounded-xl bg-surface-muted p-3 text-xs font-bold text-content-muted"><span className="mb-1 block text-[10px] opacity-60">정답</span>{question.correctChoiceText ?? "—"}</div></div>{question.responseTimeMs !== null ? <p className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-content-subtle"><ClockIcon className="h-3.5 w-3.5" />응답 시간 {(question.responseTimeMs / 1000).toFixed(1)}초</p> : null}</div></div></article>)}</div>
      {report.pendingQuestionCount ? <p className="mt-4 rounded-2xl bg-surface-muted p-4 text-center text-xs font-bold text-content-muted">아직 진행 중인 문항 {report.pendingQuestionCount}개는 정답 공개 후에 확인할 수 있어요.</p> : null}
      <div className="mt-8 text-center"><Link href={returnHref} className="inline-flex rounded-xl bg-brand-strong px-5 py-3 text-sm font-black text-on-brand">{publicAccess ? "다른 퀴즈 참여하기" : "내 응시 기록으로"}</Link></div>
    </>
  );
}
