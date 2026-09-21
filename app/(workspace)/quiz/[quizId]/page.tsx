import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { BookOpen, Copy } from "lucide-react";
import { StatusBadge } from "@/components/ui/data-display";
import { BackLink, PageHeader, PageShell } from "@/components/ui/page-layout";
import { requireActiveUser } from "@/lib/auth/authorization";
import { requireViewableQuiz } from "@/lib/quiz/access";
import { getPrisma } from "@/lib/prisma";
import { isUnscoredType } from "@/lib/quiz/participation";
import { questionTypeLabel } from "@/lib/quiz/question-label";
import { recordQuizVisit } from "@/lib/dashboard/visits";
// quiz의 학생 실명(displayNameEncrypted)은 병합 스키마에 없습니다. pad는 공개 표시 이름을
// nameEncrypted 하나로 다룹니다.
import { toPublicAuthorDTO } from "@/lib/users/repository";

export default async function ViewQuizPage({ params }: { params: Promise<{ quizId: string }> }) {
  const actor = await requireActiveUser();
  const { quizId } = await params;
  const access = await requireViewableQuiz(quizId, actor);
  if (access.level !== "VIEWER") redirect(`/quiz/${quizId}/edit`);
  after(() => recordQuizVisit(quizId, actor.id));

  const quiz = await getPrisma().quiz.findUniqueOrThrow({
    where: { id: quizId },
    select: {
      title: true,
      description: true,
      isPublished: true,
      subject: { select: { name: true } },
      owner: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
      questions: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          type: true,
          text: true,
          timeLimitSec: true,
          points: true,
          choices: { orderBy: { position: "asc" }, select: { id: true, text: true } },
          orderedItems: true,
          numericMin: true,
          numericMax: true,
          slideBody: true,
        },
      },
    },
  });
  const ownerName = toPublicAuthorDTO(quiz.owner).name || "교사";

  return (
    <PageShell>
      <BackLink href="/quiz">퀴즈 목록</BackLink>
      <PageHeader
        eyebrow={quiz.subject?.name || "미분류"}
        title={quiz.title}
        description={`${ownerName}님이 보기 권한으로 공유한 퀴즈입니다. 원본은 수정할 수 없지만 내 퀴즈로 복제할 수 있습니다.`}
        action={<StatusBadge status={quiz.isPublished ? "PUBLISHED" : "DRAFT"} />}
      />

      {quiz.description ? (
        <p className="mb-6 rounded-2xl bg-surface p-5 text-sm leading-6 text-content-muted ring-1 ring-line">
          {quiz.description}
        </p>
      ) : null}

      <div className="space-y-4">
        {quiz.questions.map((question, index) => (
          <article key={question.id} className="rounded-[24px] border border-line bg-surface p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-strong text-xs font-black text-on-brand">{index + 1}</span>
              <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[10px] font-black text-brand-soft-fg">{questionTypeLabel(question.type)}</span>
              <span className="ml-auto text-[11px] font-bold text-content-subtle">{question.timeLimitSec}초{isUnscoredType(question.type) ? "" : ` · ${question.points.toLocaleString("ko-KR")}점`}</span>
            </div>
            <h2 className="mt-4 whitespace-pre-wrap text-lg font-black leading-7 text-content">{question.text}</h2>
            {question.type === "SLIDE" ? (
              <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-brand-soft/40 p-5 text-sm font-bold leading-7 text-content-muted">{question.slideBody || "본문 없음"}</p>
            ) : question.choices.length ? (
              <ol className="mt-4 grid gap-2 sm:grid-cols-2">
                {question.choices.map((choice, choiceIndex) => (
                  <li key={choice.id} className="rounded-xl bg-surface-muted px-4 py-3 text-sm font-bold text-content-muted">
                    <span className="mr-2 text-xs text-content-subtle">{String.fromCharCode(65 + choiceIndex)}</span>{choice.text}
                  </li>
                ))}
              </ol>
            ) : question.type === "ORDERING" ? (
              <ol className="mt-4 space-y-2">
                {question.orderedItems.map((item, itemIndex) => (
                  <li key={`${item}-${itemIndex}`} className="flex items-center gap-3 rounded-xl bg-surface-muted px-4 py-3 text-sm font-bold">
                    <span className="grid h-6 w-6 place-items-center rounded-lg bg-surface text-xs text-content-subtle">{itemIndex + 1}</span>{item}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-surface-muted px-4 py-3 text-sm font-bold text-content-muted">
                <BookOpen className="h-4 w-4" />
                {question.type === "SHORT_ANSWER" ? "직접 답을 입력하는 문항" : `${question.numericMin} ~ ${question.numericMax} 범위`}
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="mt-8 text-center">
        <Link href="/quiz" className="inline-flex items-center gap-2 rounded-2xl bg-brand-strong px-6 py-3 text-sm font-black text-on-brand">
          <Copy className="h-4 w-4" />목록에서 내 퀴즈로 복제
        </Link>
      </div>
    </PageShell>
  );
}
