export type DynamicSidebarSection = "dashboard" | "pad" | "quiz" | "form";

export type SidebarDataChangedDetail = {
  section: DynamicSidebarSection;
  folder?: {
    id: string;
    name?: string;
    removed?: boolean;
  };
};

export const SIDEBAR_DATA_CHANGED_EVENT = "pyxis:sidebar-data-changed";

export function notifySidebarDataChanged(
  section: DynamicSidebarSection,
  detail: Omit<SidebarDataChangedDetail, "section"> = {},
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SIDEBAR_DATA_CHANGED_EVENT, { detail: { ...detail, section } }));
}
