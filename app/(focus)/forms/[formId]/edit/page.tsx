import { requireActiveUser } from "@/lib/auth/authorization";
import { requireViewableForm } from "@/lib/forms/access";
import { FormEditor } from "@/components/forms/form-editor";
import { getMetadata } from "@/utils/seo/getMetadata";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { loadFormDocument } from "@/lib/forms/save";
import { getPrisma } from "@/lib/prisma";
import { recordFormVisit } from "@/lib/dashboard/visits";

export const dynamic = "force-dynamic";
export const metadata = getMetadata({ title: "설문 편집", description: "설문지를 만들고 고칩니다.", noIndex: true });

// 셸 없는 전체화면(focus 구역)입니다. 편집기는 폭을 다 써야 질문 카드가 읽히고, 사이드바가
// 함께 있으면 좁은 화면에서 카드가 두 줄로 접힙니다.
export default async function FormEditPage({ params }: { params: Promise<{ formId: string }> }) {
  const actor = await requireActiveUser();
  const { formId } = await params;
  const access = await requireViewableForm(formId, actor);
  // 보기 권한만 있으면 편집기 대신 개요로 보냅니다 — 열어 봐야 저장이 전부 거부됩니다.
  if (access.level === "VIEWER") redirect(`/forms/${formId}`);
  after(() => recordFormVisit(formId, actor.id));

  const [form, availableSubjects] = await Promise.all([
    loadFormDocument(formId),
    getPrisma().subject.findMany({
      where: { ownerId: access.form.ownerId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  if (!form) redirect("/forms");

  return <FormEditor formId={formId} initialForm={{ ...form, accessLevel: access.level, availableSubjects }} />;
}
