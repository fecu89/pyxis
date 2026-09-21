import { ResponseSummary } from "@/components/forms/response-summary";
import { requireFormResponsesAccess } from "@/lib/forms/responses-access";
import { buildFormSummary } from "@/lib/forms/summary";

export const dynamic = "force-dynamic";

export default async function FormResponseQuestionsPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  await requireFormResponsesAccess(formId);
  return <ResponseSummary initialSummary={await buildFormSummary(formId)} view="question" />;
}
