"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function JoinBoardButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function join() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/invite/${token}/redeem`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "참여하지 못했습니다.");
        return;
      }
      router.push(`/b/${result.board.slug}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" className="button primary full" onClick={join} disabled={pending}>{pending ? "참여하는 중..." : "참여하기"}</button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </>
  );
}
