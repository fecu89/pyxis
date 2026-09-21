"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

/** 로그인 폼·모달을 함께 가져오지 않는, 인증된 셸 전용 로그아웃 버튼입니다. */
export function LogoutButton() {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      className="icon-button"
      onClick={() => {
        setPending(true);
        void signOut({ callbackUrl: "/" }).catch(() => setPending(false));
      }}
      disabled={pending}
      aria-label="로그아웃"
    >
      <LogOut size={17} />
    </button>
  );
}
