"use client";

import { useEffect } from "react";
import { isAppTheme, THEME_COOKIE_MAX_AGE_SECONDS, THEME_COOKIE_NAME, type AppTheme } from "@/lib/theme";

function applyTheme(theme: AppTheme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function persistTheme(theme: AppTheme) {
  applyTheme(theme);
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // 사생활 보호 모드 등에서 Web Storage가 막혀도 현재 화면과 쿠키 테마는 유지합니다.
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THEME_COOKIE_NAME}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

function readLocalTheme(): AppTheme | null {
  try {
    const stored = localStorage.getItem("theme");
    return isAppTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function preferredTheme(): AppTheme {
  const localTheme = readLocalTheme();
  const serverTheme = document.documentElement.getAttribute("data-theme");
  return localTheme
    ?? (isAppTheme(serverTheme) ? serverTheme : null)
    ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

// 테마 버튼이 없는 공개 참여·플레이 화면도 첫 방문의 시스템 설정과 기존 localStorage 값을
// 쿠키로 옮겨야 합니다. DOM을 렌더하지 않아 서버/클라이언트 첫 트리는 언제나 같습니다.
export function ThemeSync() {
  useEffect(() => {
    const timer = window.setTimeout(() => persistTheme(preferredTheme()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}
