"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { APP_NAME } from "@/lib/brand";

export function PadPasswordGate({ boardId, boardTitle }: { boardId: string; boardTitle: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const data = new FormData(event.currentTarget);
      const response = await fetch(`/api/boards/${boardId}/verify-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: data.get("password") }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "비밀번호를 확인하지 못했습니다.");
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="access-page">
      <nav className="access-nav">
        <Link href="/" className="back-link"><ArrowLeft size={18} />{APP_NAME}로 돌아가기</Link>
      </nav>
      <section className="access-card" aria-labelledby="access-title">
        <span className="access-icon" aria-hidden><Lock size={30} /></span>
        <p className="access-eyebrow">비밀번호로 보호된 패드</p>
        <h1 id="access-title">비밀번호를 입력해 주세요</h1>
        <p className="access-board-title">“{boardTitle}”</p>
        <form className="stack-form access-password-form" onSubmit={submit}>
          <label>비밀번호<input type="password" name="password" required autoFocus maxLength={100} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button primary full" disabled={pending}>{pending ? "확인하는 중..." : "입장하기"}</button>
        </form>
      </section>
    </main>
  );
}
