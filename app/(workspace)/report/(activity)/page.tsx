import { redirect } from "next/navigation";
import { renderActivityReportPage, type ActivityReportSearchParams } from "@/app/(workspace)/report/(activity)/activity-report-page";
import { REPORT_ACTIVITY_PATHS, legacyReportActivityType } from "@/lib/activity/report-navigation";

export default async function ReportPage({ searchParams }: { searchParams: ActivityReportSearchParams & Promise<{ type?: string | string[] }> }) {
  const raw = await searchParams;
  const rawType = Array.isArray(raw.type) ? raw.type[0] : raw.type;
  const legacyType = legacyReportActivityType(rawType);
  if (legacyType) {
    const rawPage = Array.isArray(raw.page) ? raw.page[0] : raw.page;
    redirect(rawPage ? `${REPORT_ACTIVITY_PATHS[legacyType]}?page=${encodeURIComponent(rawPage)}` : REPORT_ACTIVITY_PATHS[legacyType]);
  }
  return renderActivityReportPage(Promise.resolve({ page: raw.page }));
}
