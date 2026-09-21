import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { listOwnedSubjects } from "@/lib/subjects/list";
import { QuizCreateForm } from "@/components/quiz/quiz-create-form";
import { BackLink, PageHeader, PageShell } from "@/components/ui/page-layout";
import { QuizIcon } from "@/components/ui/icons";
import { getMetadata } from "@/utils/seo/getMetadata";

export const dynamic = "force-dynamic";
export const metadata = getMetadata({ title: "새 퀴즈", noIndex: true });

// 예전에는 이 페이지 전체가 `"use client"`였고 교과목 목록을 `useEffect`에서 `/api/subjects`로
// 불렀습니다. 그러면 첫 HTML에는 교과목 칸이 비어 있다가 왕복 한 번 뒤에 채워집니다.
// 이제 서버가 직접 읽어 첫 화면에 담고, 상호작용이 실제로 필요한 폼만 클라이언트입니다.
export default async function NewQuizPage() {
  const user = await getCurrentUser();
  if (!user) redirectToLogin("/quiz/new");

  const subjects = (await listOwnedSubjects(user.id)).map(({ id, name }) => ({ id, name }));

  return (
    <PageShell size="medium">
      <BackLink href="/quiz">퀴즈 목록</BackLink>
      <PageHeader eyebrow="Create quiz" title="새 퀴즈 만들기" description="먼저 이름과 설명을 정해 주세요. 다음 화면에서 문항을 자유롭게 추가할 수 있어요." />
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <QuizCreateForm subjects={subjects} />
        <aside className="h-fit rounded-[24px] bg-brand-soft p-5">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-surface text-brand"><QuizIcon className="h-5 w-5" /></div>
          <h2 className="mt-5 text-base font-black text-brand-soft-fg">좋은 제목의 기준</h2>
          <ul className="mt-3 space-y-2 text-xs leading-5 text-brand-soft-fg/80">
            <li>• 학생이 범위를 바로 알 수 있게</li>
            <li>• 단원명이나 수업 날짜를 포함</li>
            <li>• 너무 길지 않고 기억하기 쉽게</li>
          </ul>
        </aside>
      </div>
    </PageShell>
  );
}
