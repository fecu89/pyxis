import { buildFormSummary } from "@/lib/forms/summary";
import { ResponseSummary } from "@/components/forms/response-summary";
import { requireFormResponsesAccess } from "@/lib/forms/responses-access";

export const dynamic = "force-dynamic";
export default async function FormResponsesPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  await requireFormResponsesAccess(formId);
  return <ResponseSummary initialSummary={await buildFormSummary(formId)} />;
}
