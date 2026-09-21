import { renderActivityReportPage, type ActivityReportSearchParams } from "@/app/(workspace)/report/(activity)/activity-report-page";

export default function FormActivityReportPage({ searchParams }: { searchParams: ActivityReportSearchParams }) {
  return renderActivityReportPage(searchParams, "FORM");
}
