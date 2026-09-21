import type { ReportActivityType } from "@/lib/activity/report";

export const REPORT_ACTIVITY_PATHS: Record<ReportActivityType, string> = {
  QUIZ_SESSION: "/report/quizzes",
  PAD_BOARD: "/report/pads",
  FORM: "/report/forms",
};

export function legacyReportActivityType(value: string | null | undefined): ReportActivityType | null {
  return value && Object.prototype.hasOwnProperty.call(REPORT_ACTIVITY_PATHS, value)
    ? value as ReportActivityType
    : null;
}
