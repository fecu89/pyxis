import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { headers } from "next/headers";
import { loadPublicFormData } from "@/lib/forms/public-form-data";
import { PageShell } from "@/components/ui/page-layout";
import { FormRunner } from "@/components/forms/form-runner";
import { getMetadata } from "@/utils/seo/getMetadata";

export const dynamic = "force-dynamic";
export const metadata = getMetadata({ title: "응답 수정", description: "제출한 설문 응답을 수정합니다.", noIndex: true });

export default async function FormResponseEditPage({ params }: { params: Promise<{ slug: string; responseId: string }> }) {
  const { slug, responseId } = await params;
  const actor = await getCurrentUser();
  const data = await loadPublicFormData({ slug, actor, cookieHeader: (await headers()).get("cookie"), responseId });
  if (!data) notFound();
  if (data.form.requiresLogin && !actor) redirectToLogin(`/s/${slug}/responses/${responseId}/edit`);
  return <PageShell size="medium"><FormRunner slug={slug} responseId={responseId} initialData={data} /></PageShell>;
}
