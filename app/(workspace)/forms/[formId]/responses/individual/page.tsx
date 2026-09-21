import { redirect } from "next/navigation";
import { IndividualResponses } from "@/components/forms/response-summary";
import { PageNumberNavigation } from "@/components/ui/page-number-navigation";
import { requireFormResponsesAccess } from "@/lib/forms/responses-access";
import { listFormResponses } from "@/lib/forms/summary";

export const dynamic = "force-dynamic";

function pageNumber(value: string | string[] | undefined) {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100_000) : 1;
}

export default async function IndividualFormResponsesPage({ params, searchParams }: {
  params: Promise<{ formId: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { formId } = await params;
  await requireFormResponsesAccess(formId);
  const requestedPage = pageNumber((await searchParams).page);
  const responses = await listFormResponses(formId, requestedPage);
  const totalPages = Math.max(1, Math.ceil(responses.totalCount / responses.pageSize));
  if (requestedPage > totalPages) redirect(`/forms/${formId}/responses/individual?page=${totalPages}`);
  return (
    <>
      <IndividualResponses key={responses.page} formId={formId} page={responses} />
      <PageNumberNavigation basePath={`/forms/${formId}/responses/individual`} page={responses.page} totalPages={totalPages} />
    </>
  );
}
