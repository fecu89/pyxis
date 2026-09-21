import { renderActivityReportPage, type ActivityReportSearchParams } from "@/app/(workspace)/report/(activity)/activity-report-page";

export default function QuizActivityReportPage({ searchParams }: { searchParams: ActivityReportSearchParams }) {
  return renderActivityReportPage(searchParams, "QUIZ_SESSION");
}
