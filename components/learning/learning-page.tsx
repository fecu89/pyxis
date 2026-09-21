import type { CurrentUser } from "@/lib/auth/current-user";
import { PageHeader, PageShell } from "@/components/ui/page-layout";
import { PageNumberNavigation } from "@/components/ui/page-number-navigation";
import { getLearningPage } from "@/lib/learning/queries";
import { LEARNING_LABELS, type LearningKind } from "@/lib/learning/types";
import { LearningItems } from "./learning-items";

export async function LearningListPage({ user, kind, page, basePath }: {
  user: CurrentUser; kind: LearningKind; page?: number; basePath: string;
}) {
  const data = await getLearningPage(user, { kind, page });
  return <PageShell>
    <PageHeader eyebrow="MY LEARNING" title={`내 ${LEARNING_LABELS[kind]}`}
      description={kind === "quiz" ? "할당받은 퀴즈를 시작하거나 이어 풀고, 완료한 결과를 확인하세요." : "수강 중인 교과목의 설문과 내가 응답한 설문입니다."} />
    <LearningItems data={data} />
    <PageNumberNavigation basePath={basePath} page={data.page} totalPages={data.totalPages} />
  </PageShell>;
}
