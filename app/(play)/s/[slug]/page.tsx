import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { headers } from "next/headers";
import { loadPublicFormData } from "@/lib/forms/public-form-data";
import { PageShell } from "@/components/ui/page-layout";
import { FormRunner } from "@/components/forms/form-runner";
import { getMetadata } from "@/utils/seo/getMetadata";

export const dynamic = "force-dynamic";
export const metadata = getMetadata({ title: "설문", description: "설문에 응답합니다.", noIndex: true });

// 공개 응답 화면입니다. 로그인 세션과 익명 참여가 같은 라우트입니다 — 퀴즈가 `/join`과
// `/public/join`으로 갈렸다가 서로 리다이렉트하던 문제를 반복하지 않으려는 것입니다
// (`app/(play)/p/[sessionId]/page.tsx`와 같은 판단).
//
// 서버에서 설문 정의와 마감·정원 초과 상태까지 읽어 첫 HTML에 넣습니다. 다만 닫힌 설문도
// notFound로 숨기지 않고 `FormRunner`가 이유를 안내합니다. 마감됐다는 사실 자체가 응답자에게
// 필요한 정보이기 때문입니다(app/api/forms/[formId]/close/route.ts와 같은 이유).
export default async function FormFillPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await getCurrentUser();
  const data = await loadPublicFormData({ slug, actor, cookieHeader: (await headers()).get("cookie") });
  if (!data) notFound();

  if (data.form.requiresLogin && !actor) redirectToLogin(`/s/${slug}`);

  return (
    <PageShell size="medium">
      <FormRunner slug={slug} initialData={data} />
    </PageShell>
  );
}
