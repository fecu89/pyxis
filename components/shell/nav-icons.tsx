"use client";

// `lib/routes.ts`는 `proxy.ts`(Node 런타임)에서도 평가되므로 React나 lucide-react를 가져올 수
// 없습니다. 그래서 매니페스트는 아이콘을 문자열 키로만 담고, 실제 컴포넌트 매핑은 여기서 합니다.

import {
  Archive, BarChart3, BookOpen, ClipboardList, ClipboardPen, History, Home, LayoutGrid,
  ListChecks, PenLine, Search, ShieldCheck, Star, Users,
} from "lucide-react";
import type { ComponentType } from "react";
import type { NavIconKey } from "@/lib/routes";

export const NAV_ICONS: Record<NavIconKey, ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = {
  home: Home,
  search: Search,
  quiz: ListChecks,
  activity: History,
  assignment: ClipboardList,
  pad: LayoutGrid,
  // 설문. 과제(assignment)의 ClipboardList와 헷갈리지 않게 펜이 붙은 쪽을 씁니다.
  form: ClipboardPen,
  star: Star,
  archive: Archive,
  report: BarChart3,
  students: Users,
  writeup: PenLine,
  admin: ShieldCheck,
  subject: BookOpen,
};
