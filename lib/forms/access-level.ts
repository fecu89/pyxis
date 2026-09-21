import { hasSystemPermission, type PermissionHolder } from "@/lib/auth/permissions";

export type FormAccessLevel = "OWNER" | "EDITOR" | "VIEWER";

/** 목록 액션과 개별 설문 API가 같은 권한·동결 규칙을 사용합니다. */
export function resolveFormAccessLevel(form: {
  ownerId: string;
  frozenAt: Date | null;
  shares: Array<{ permission: "EDITOR" | "VIEWER" }>;
}, actor: PermissionHolder & { id: string }): FormAccessLevel | null {
  if (actor.role === "STUDENT") return null;
  const canEditAny = hasSystemPermission(actor, "EDIT_ANY_QUIZ");
  const level = form.ownerId === actor.id || canEditAny
    ? "OWNER"
    : form.shares[0]?.permission ?? (hasSystemPermission(actor, "VIEW_ALL_QUIZZES") ? "VIEWER" : null);
  if (!level) return null;
  return form.frozenAt && !canEditAny ? "VIEWER" : level;
}
