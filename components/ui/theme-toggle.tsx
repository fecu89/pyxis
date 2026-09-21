"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import type { AppTheme } from "@/lib/theme";
import { persistTheme, preferredTheme } from "@/components/ui/theme-sync";

export function ThemeToggle() {
  // 서버와 클라이언트의 첫 렌더를 항상 같게 유지하고, 실제 선택은 effect에서 반영합니다.
  const [theme, setTheme] = useState<AppTheme>("light");

  useEffect(() => {
    const timer = setTimeout(() => {
      const nextTheme = preferredTheme();
      persistTheme(nextTheme);
      setTheme(nextTheme);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    persistTheme(next);
  }

  return (
    <button type="button" className="icon-button" onClick={toggle} aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}>
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
