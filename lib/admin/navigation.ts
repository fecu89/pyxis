export const ADMIN_SECTION_IDS = [
  "dashboard",
  "users",
  "approvals",
  "audit",
  "schools",
  "roster",
  "settings",
  "audio",
  "theme",
  "boards",
  "quizzes",
  "forms",
] as const;

export type AdminSection = typeof ADMIN_SECTION_IDS[number];

export const ADMIN_SECTION_PATHS: Record<AdminSection, string> = {
  dashboard: "/admin/dashboard",
  users: "/admin/users",
  approvals: "/admin/approvals",
  audit: "/admin/audit",
  schools: "/admin/schools",
  roster: "/admin/roster",
  settings: "/admin/settings",
  audio: "/admin/audio",
  theme: "/admin/theme",
  boards: "/admin/boards",
  quizzes: "/admin/quizzes",
  forms: "/admin/forms",
};

const LEGACY_ADMIN_TABS: Readonly<Record<string, AdminSection>> = {
  academic: "dashboard",
  dashboard: "dashboard",
  users: "users",
  approvals: "approvals",
  audit: "audit",
  schools: "schools",
  roster: "roster",
  settings: "settings",
  audio: "audio",
  theme: "theme",
  boards: "boards",
  quizzes: "quizzes",
  forms: "forms",
};

export function legacyAdminSection(value: string | null | undefined): AdminSection | null {
  return value ? LEGACY_ADMIN_TABS[value] ?? null : null;
}
