import Link from "next/link";
import { after } from "next/server";
import { BarChart3, CircleDot, ListChecks, NotebookPen, Users } from "lucide-react";
import { requireActiveUser } from "@/lib/auth/authorization";
import { requireViewableForm } from "@/lib/forms/access";
import { formClosedMessage, formClosedReason } from "@/lib/forms/field-types";
import { FormCollaboratorDialogButton } from "@/components/forms/share-dialog";
import { FormResponseSharePanel } from "@/components/forms/response-share-panel";
import { FormStatusAction } from "@/components/forms/form-status-action";
import { StatCard } from "@/components/ui/data-display";
import { EmptyState, InlineNotice } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/page-layout";
import { getMetadata } from "@/utils/seo/getMetadata";
import { formatDateTime } from "@/lib/format";
import { getPrisma } from "@/lib/prisma";
import { recordFormVisit } from "@/lib/dashboard/visits";

export const dynamic = "force-dynamic";
export const metadata = getMetadata({ title: "설문 개요", description: "설문 상태와 응답 링크를 봅니다.", noIndex: true });

// 설문 하나의 개요입니다. 편집은 전체화면 편집기(/forms/[formId]/edit)가, 응답 집계는 별도
// 화면(/forms/[formId]/responses)이 맡습니다. 여기서는 "지금 어떤 상태이고 링크가 무엇인가"만
// 보여 주고, 그 두 화면과 공유 다이얼로그로 안내합니다.
export default async function FormOverviewPage({ params }: { params: Promise<{ formId: string }> }) {
  const actor = await requireActiveUser();
  const { formId } = await params;
  const { form, level } = await requireViewableForm(formId, actor);
  after(() => recordFormVisit(formId, actor.id));

  const fieldCount = await getPrisma().formField.count({ where: { formId } });
  const closed = formClosedReason(form);

  return (
    <PageShell>
      <PageHeader
        eyebrow="FORMS"
        title={form.title || "제목 없는 설문지"}
        description={form.description ?? "설명이 없습니다."}
      />

      {closed && form.status !== "DRAFT" && (
        <div className="mb-5"><InlineNotice tone="warning">{formClosedMessage(closed, form.closedMessage)}</InlineNotice></div>
      )}

      <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-3">
        <StatCard compactMobile label="질문" value={String(fieldCount)} icon={<ListChecks className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />} />
        <Link href={`/forms/${formId}/responses`} className="min-w-0 rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          <StatCard compactMobile label="응답" value={String(form.responseCount)} icon={<Users className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />} />
        </Link>
        <StatCard
          compactMobile
          label="상태"
          value={null}
          icon={<CircleDot className="h-4 w-4 sm:h-5 sm:w-5" aria-label={STATUS_LABEL[form.status]} />}
          tone={form.status === "OPEN" ? "success" : "danger"}
        />
      </div>

      <dl className="mb-6 grid gap-2 rounded-2xl border border-line bg-surface p-4 text-sm">
        <Row label="응답 방식" value={form.requiresLogin ? "로그인 필요" : "링크를 가진 누구나(익명)"} />
        <Row label="중복 응답" value={form.allowMultipleResponses ? "여러 번 가능" : "1인 1회"} />
        <Row label="응답 시작" value={form.openAt ? formatDateTime(form.openAt) : "제한 없음"} />
        <Row label="응답 마감" value={form.closeAt ? formatDateTime(form.closeAt) : "제한 없음"} />
        <Row label="정원" value={form.maxResponses ? `${form.maxResponses}명` : "제한 없음"} />
      </dl>

      {form.status === "DRAFT" ? (
        <EmptyState
          title="아직 발행하지 않았어요"
          description="편집기에서 질문을 마무리하고 발행하면 응답 링크가 살아납니다."
          action={level !== "VIEWER" ? <Link className="button primary" href={`/forms/${formId}/edit`}>편집기 열기</Link> : undefined}
        />
      ) : (
        <FormResponseSharePanel formId={form.id} slug={form.slug} title={form.title} canManage={level !== "VIEWER"} />
      )}

      <div className="mt-6 flex h-11 w-full items-stretch gap-1.5 sm:w-fit">
        <Link className={OVERVIEW_ACTION_CLASS} href={`/forms/${formId}/responses`} aria-label="응답 보기" title="응답 보기">
          <BarChart3 className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">응답 보기</span>
        </Link>
        {level !== "VIEWER" && (
          <Link className={OVERVIEW_PRIMARY_ACTION_CLASS} href={`/forms/${formId}/edit`} aria-label="설문 편집기 열기" title="설문 편집기 열기">
            <NotebookPen className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">편집기</span>
          </Link>
        )}
        {level !== "VIEWER" && form.status !== "DRAFT" && <FormStatusAction formId={formId} status={form.status} compact />}
        {level === "OWNER" && <FormCollaboratorDialogButton formId={formId} formTitle={form.title} compact />}
      </div>
    </PageShell>
  );
}

const STATUS_LABEL = { DRAFT: "초안", OPEN: "응답 받는 중", CLOSED: "마감" } as const;
const OVERVIEW_ACTION_LAYOUT = "inline-flex h-full min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border px-2 text-xs font-black shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex-none sm:px-4";
const OVERVIEW_ACTION_CLASS = `${OVERVIEW_ACTION_LAYOUT} border-line bg-surface text-content-muted hover:border-brand-300 hover:bg-surface-hover hover:text-brand`;
// primary 색과 일반 버튼의 muted 전경을 한 요소에 함께 붙이면 Tailwind 생성 순서에 따라
// muted가 SVG currentColor까지 덮습니다. 역할별 색상 토큰을 아예 분리해 테마 대비를 보장합니다.
const OVERVIEW_PRIMARY_ACTION_CLASS = `${OVERVIEW_ACTION_LAYOUT} border-brand bg-brand text-on-brand hover:border-brand-strong hover:bg-brand-strong hover:text-on-brand`;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-content-muted">{label}</dt>
      <dd className="font-black text-content">{value}</dd>
    </div>
  );
}
