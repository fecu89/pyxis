import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import type { ReactNode } from "react";
import { FormResponseNav } from "@/components/forms/form-response-nav";
import { PageHeader, PageShell } from "@/components/ui/page-layout";
import { requireFormResponsesAccess } from "@/lib/forms/responses-access";
import { getMetadata } from "@/utils/seo/getMetadata";

export const dynamic = "force-dynamic";
export const metadata = getMetadata({ title: "설문 응답", description: "설문 응답을 요약·질문별·개별로 봅니다.", noIndex: true });

export default async function FormResponsesLayout({ children, params }: { children: ReactNode; params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  const { form } = await requireFormResponsesAccess(formId);
  return (
    <PageShell>
      <PageHeader
        eyebrow="FORMS"
        title={`${form.title || "제목 없는 설문지"} · 응답`}
        description="응답 결과를 요약·질문별·개별로 살펴보고 파일로 내보낼 수 있습니다."
        action={<Link className="button ghost" href={`/forms/${formId}`}><ArrowLeft className="h-4 w-4" aria-hidden />설문으로</Link>}
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <FormResponseNav formId={formId} />
        <a href={`/api/forms/${formId}/responses/export`} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-black text-content-muted transition hover:border-brand-300 hover:text-brand">
          <Download className="h-4 w-4" aria-hidden />XLSX 내보내기
        </a>
        <a href={`/api/forms/${formId}/responses/files`} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-black text-content-muted transition hover:border-brand-300 hover:text-brand">
          <Download className="h-4 w-4" aria-hidden />첨부·서명 ZIP
        </a>
      </div>
      {children}
    </PageShell>
  );
}
