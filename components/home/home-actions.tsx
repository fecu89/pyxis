"use client";

import dynamic from "next/dynamic";
import { createContext, useContext, useState, type ReactNode } from "react";
import { DASHBOARD_PATH } from "@/lib/route-paths";

const HomeAuthDialog = dynamic(() => import("@/components/home/home-auth-dialog").then((module) => module.HomeAuthDialog));

type HomeAuthActionsValue = {
  openLogin: () => void;
};

const HomeAuthActionsContext = createContext<HomeAuthActionsValue | null>(null);

function useHomeAuthActions() {
  const value = useContext(HomeAuthActionsContext);
  if (!value) throw new Error("홈 인증 액션은 HomeAuthActionsProvider 안에서 사용해야 합니다.");
  return value;
}

// 로그인 모달용 props(authError·initialLoginOpen·loginCallbackUrl)는 비로그인 화면에서만
// 의미가 있어 optional입니다. 인증된 셸의 로그아웃은 작은 전용 컴포넌트를 써서 이 로그인
// 폼과 모달이 모든 워크스페이스 번들에 포함되지 않게 합니다.
export function HomeAuthActionsProvider({
  children,
  authError = null,
  initialLoginOpen = false,
  loginCallbackUrl = DASHBOARD_PATH,
}: {
  children: ReactNode;
  authError?: string | null;
  initialLoginOpen?: boolean;
  loginCallbackUrl?: string;
}) {
  const [loginOpen, setLoginOpen] = useState(Boolean(authError) || initialLoginOpen);

  const value: HomeAuthActionsValue = {
    openLogin: () => setLoginOpen(true),
  };

  return (
    <HomeAuthActionsContext.Provider value={value}>
      {children}
      {loginOpen ? (
        <HomeAuthDialog
          onClose={() => setLoginOpen(false)}
          callbackUrl={loginCallbackUrl}
          initialError={authError}
        />
      ) : null}
    </HomeAuthActionsContext.Provider>
  );
}

export function LoginButton({ className, children }: { className: string; children: ReactNode }) {
  const { openLogin } = useHomeAuthActions();
  return <button type="button" className={className} onClick={openLogin}>{children}</button>;
}
