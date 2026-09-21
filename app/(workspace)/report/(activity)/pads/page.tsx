import { renderActivityReportPage, type ActivityReportSearchParams } from "@/app/(workspace)/report/(activity)/activity-report-page";

export default function PadActivityReportPage({ searchParams }: { searchParams: ActivityReportSearchParams }) {
  return renderActivityReportPage(searchParams, "PAD_BOARD");
}
