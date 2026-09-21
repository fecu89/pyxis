export type LearningKind = "quiz" | "pad" | "form";
export type LearningItem = {
  id: string;
  title: string;
  description: string | null;
  subjectName: string | null;
  status: string;
  action: string;
  href: string | null;
  mode?: "LIVE" | "ASYNC";
};
export type LearningPage = {
  kind: LearningKind;
  items: LearningItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
export type LearningCourse = { id: string; name: string; canManage: boolean };
export const LEARNING_LABELS: Record<LearningKind, string> = { quiz: "퀴즈", pad: "패드", form: "설문" };
