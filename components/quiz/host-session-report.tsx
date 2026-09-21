import Link from "next/link";
import { CheckIcon, UsersIcon } from "@/components/ui/icons";
import { ParticipationSummaryView } from "@/components/quiz/participation-views";
import { ReportPinDistribution } from "@/components/quiz/report-pin-distribution";
import { StatusBadge } from "@/components/ui/data-display";
import { ProgressBar } from "@/components/ui/feedback";
import { isParticipationType } from "@/lib/quiz/participation";
import type { HostSessionReport } from "@/lib/quiz/report";
import { questionTypeLabel } from "@/lib/quiz/question-label";

export function HostSessionReportView({ report }: { report: HostSessionReport }) {
  return (
    <>
      <section className="mb-6 grid gap-4 sm:grid-cols-2"><SummaryCard label="참여 인원" value={`${report.participantCount}명`} icon={<UsersIcon className="h-5 w-5 text-brand" />} /><SummaryCard label="전체 응답" value={`${report.questions.reduce((sum, question) => sum + question.answeredCount, 0)}개`} icon={<CheckIcon className="h-5 w-5 text-brand" />} /></section>
      <section className="mb-6 overflow-hidden rounded-[24px] border border-line bg-surface"><div className="border-b border-line bg-surface-muted px-5 py-4"><h2 className="text-sm font-black text-content">참여자별 결과</h2><p className="mt-1 text-xs text-content-subtle">로그인 학생은 누적 기록으로 이동하고, 익명 참여자는 이 세션에서만 확인합니다.</p></div><ParticipantCards participants={report.participants} /><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[720px] text-left text-xs"><thead><tr className="border-b border-line text-content-subtle"><th className="px-5 py-3">참여자</th><th className="px-4 py-3">유형</th><th className="px-4 py-3">정답</th><th className="px-4 py-3">응답</th><th className="px-4 py-3">평균 응답</th><th className="px-4 py-3">점수</th><th className="px-5 py-3 text-right">누적 기록</th></tr></thead><tbody>{report.participants.map((participant) => <tr key={participant.participantId} className="border-b border-line last:border-0"><td className="px-5 py-4 font-black text-content">{participant.nickname}</td><td className="px-4 py-4"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${participant.isGuest ? "bg-info-100 text-info-800 dark:bg-info-400/15 dark:text-info-300" : "bg-brand-soft text-brand-soft-fg"}`}>{participant.isGuest ? "익명" : "학생"}</span></td><td className="px-4 py-4 font-bold text-content-muted">{participant.correctCount}/{participant.totalQuestions}</td><td className="px-4 py-4 text-content-muted">{participant.answeredCount}/{participant.totalQuestions}</td><td className="px-4 py-4 text-content-muted">{participant.averageResponseTimeMs === null ? "—" : `${(participant.averageResponseTimeMs / 1000).toFixed(1)}초`}</td><td className="px-4 py-4 font-black text-brand">{participant.score.toLocaleString("ko-KR")}</td><td className="px-5 py-4 text-right">{participant.userId && participant.canViewHistory ? <Link href={`/report/students/${participant.userId}`} className="font-black text-brand">학생 기록 →</Link> : <span className="text-content-subtle">세션 한정</span>}</td></tr>)}</tbody></table></div></section>
      <div className="space-y-4">{report.questions.map((question, index) => {
        const correctCount = question.answeredCount - question.wrongAnswers.length;
        // 참여형은 정답이 없어 정답률 막대와 오답 목록이 뜻을 갖지 못합니다 — 대신 모인 응답을
        // 진행 화면과 같은 그림으로 보여 줍니다.
        const participation = isParticipationType(question.questionType);
        return <article key={question.questionId} className="rounded-[24px] border border-line bg-surface p-5 sm:p-6"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-black text-content-subtle">Q{String(index + 1).padStart(2, "0")}</span><StatusBadge status={question.questionType} label={questionTypeLabel(question.questionType)} /></div><h2 className="mt-3 text-base font-black leading-6 text-content">{question.text}</h2><p className="mt-2 text-xs font-bold text-brand">정답: {question.correctChoiceText}</p>{participation ? <p className="mt-5 text-xs font-bold text-content-muted">응답 {question.answeredCount}명 · 미응답 {question.unansweredCount}명</p> : <div className="mt-5"><ProgressBar value={correctCount} max={report.participantCount || 1} label={`정답률 ${report.participantCount ? Math.round(correctCount / report.participantCount * 100) : 0}%`} /></div>}{question.choiceBreakdown.length ? <div className="mt-5 grid gap-2 sm:grid-cols-2">{question.choiceBreakdown.map((choice) => <div key={choice.choiceId} className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-bold ${choice.isCorrect ? "bg-brand-soft text-brand-soft-fg" : "bg-surface-muted text-content-muted"}`}><span>{choice.isCorrect ? "✓ " : ""}{choice.text}</span><span>{choice.count}명</span></div>)}</div> : null}{question.participationSummary && question.participationSummary.type !== "SURVEY" ? <ParticipationSummaryView summary={question.participationSummary} question={question} variant="light" className="mt-5" /> : null}{question.pinResult && question.imageUrl ? <div className="mt-5"><ReportPinDistribution imageUrl={question.imageUrl} imageAlt={question.imageAlt} pins={question.pinResult.pins} areas={question.pinResult.pinAreas} /><p className="mt-2 text-center text-[11px] font-bold text-content-muted">초록 영역이 정답, 초록 핀이 맞힌 응답입니다</p></div> : null}{!participation && question.wrongAnswers.length ? <details className="mt-5 rounded-xl bg-danger-soft p-4"><summary className="cursor-pointer text-xs font-black text-danger-soft-fg">오답 응답 {question.wrongAnswers.length}개 보기</summary><ul className="mt-3 space-y-2">{question.wrongAnswers.map((answer) => <li key={answer.participantId} className="flex items-center justify-between gap-3 text-xs"><span className="font-bold text-content-muted">{answer.nickname}</span><span className="truncate text-danger-soft-fg">{answer.chosenChoiceText}</span></li>)}</ul></details> : null}</article>;
      })}</div>
      <div className="mt-8 text-center"><Link href="/quiz/activities" className="inline-flex rounded-xl bg-brand-strong px-5 py-3 text-sm font-black text-on-brand">결과 목록으로</Link></div>
    </>
  );
}

function ParticipantCards({ participants }: { participants: HostSessionReport["participants"] }) {
  return (
    <ul className="divide-y divide-line md:hidden">
      {participants.map((participant) => (
        <li key={participant.participantId} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="truncate text-sm font-black text-content">{participant.nickname}</p><p className="mt-1 text-[11px] font-bold text-content-subtle">{participant.isGuest ? "익명 참여" : "로그인 학생"}</p></div>
            <p className="shrink-0 text-lg font-black text-brand">{participant.score.toLocaleString("ko-KR")}점</p>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-surface-muted p-3 text-center text-[11px]"><div><dt className="text-content-subtle">정답</dt><dd className="mt-1 font-black text-content">{participant.correctCount}/{participant.totalQuestions}</dd></div><div><dt className="text-content-subtle">응답</dt><dd className="mt-1 font-black text-content">{participant.answeredCount}/{participant.totalQuestions}</dd></div><div><dt className="text-content-subtle">평균</dt><dd className="mt-1 font-black text-content">{participant.averageResponseTimeMs === null ? "—" : `${(participant.averageResponseTimeMs / 1000).toFixed(1)}초`}</dd></div></dl>
          <div className="mt-3 text-right"><StudentHistoryLink participant={participant} /></div>
        </li>
      ))}
    </ul>
  );
}

function StudentHistoryLink({ participant }: { participant: HostSessionReport["participants"][number] }) {
  return participant.userId && participant.canViewHistory
    ? <Link href={`/report/students/${participant.userId}`} className="text-xs font-black text-brand">학생 기록 →</Link>
    : <span className="text-[11px] font-bold text-content-subtle">세션 한정</span>;
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="rounded-[24px] border border-line bg-surface p-5">{icon}<p className="mt-4 text-xs font-bold text-content-subtle">{label}</p><p className="mt-1 text-3xl font-black text-content">{value}</p></div>;
}
