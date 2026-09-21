import { notFound } from "next/navigation";
import Link from "next/link";
import { getPrisma } from "@/lib/prisma";
import { PageShell } from "@/components/ui/page-layout";
import { CheckIcon } from "@/components/ui/icons";
import { getMetadata } from "@/utils/seo/getMetadata";

export const dynamic = "force-dynamic";
export const metadata = getMetadata({ title: "제출 완료", description: "응답이 제출됐습니다.", noIndex: true });

// 제출 직후 도착하는 화면입니다. API 응답을 그대로 넘겨받지 않고 서버 컴포넌트가 slug로
// 다시 조회하는 이유 — confirmationMessage는 길 수 있어 쿼리스트링으로 들고 오기보다,
// 이미 서버에서 값을 아는 이 페이지가 직접 읽는 편이 안전하고 간단합니다.
export default async function FormDonePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ responseId?: string }> }) {
  const { slug } = await params;
  const { responseId } = await searchParams;
  const form = await getPrisma().form.findUnique({
    where: { slug },
    select: { title: true, confirmationMessage: true, allowEditAfterSubmit: true, deletedAt: true },
  });
  if (!form || form.deletedAt) notFound();

  return (
    <PageShell size="narrow">
      <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-success-soft text-success-soft-fg">
          <CheckIcon className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-xl font-black text-content">응답이 제출됐습니다</h1>
        <p className="mt-2 whitespace-pre-wrap text-sm text-content-muted">
          {form.confirmationMessage || "응답해 주셔서 감사합니다."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {form.allowEditAfterSubmit && responseId && (
            <Link href={`/s/${slug}/responses/${encodeURIComponent(responseId)}/edit`} className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 text-sm font-black text-on-brand transition hover:bg-brand-strong">응답 수정</Link>
          )}
          <Link href="/" className="inline-flex min-h-11 items-center rounded-xl border border-line px-5 text-sm font-black text-content-muted transition hover:border-brand-300 hover:text-brand">홈으로</Link>
        </div>
      </div>
    </PageShell>
  );
}
