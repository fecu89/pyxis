"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock3, KeyRound, Send, ShieldCheck } from "lucide-react";
import { APP_NAME } from "@/lib/brand";

type AccessRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | null;

type BoardAccessGateProps = {
  boardId: string;
  boardTitle: string;
  ownerName: string | null;
  initialRequestStatus: AccessRequestStatus;
};

export function PadAccessGate({
  boardId,
  boardTitle,
  ownerName,
  initialRequestStatus,
}: BoardAccessGateProps) {
  const router = useRouter();
  const [status, setStatus] = useState(initialRequestStatus);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function requestAccess() {
    if (status === "APPROVED") {
      router.refresh();
      return;
    }

    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/boards/" + boardId + "/access-requests", { method: "POST" });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "권한을 요청하지 못했습니다.");
        return;
      }
      setStatus(result.request.status);
    } catch {
      setError("네트워크 오류로 권한을 요청하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  const requestPending = status === "PENDING";
  const approved = status === "APPROVED";

  return (
    <main className="access-page">
      <nav className="access-nav">
        <Link href="/" className="back-link"><ArrowLeft size={18} />{APP_NAME}로 돌아가기</Link>
      </nav>
      <section className="access-card" aria-labelledby="access-title">
        <span className="access-icon" aria-hidden><KeyRound size={30} /></span>
        <p className="access-eyebrow">멤버 전용 패드</p>
        <h1 id="access-title">이 패드를 보려면 권한이 필요해요</h1>
        <p className="access-board-title">“{boardTitle}”</p>
        <p className="access-description">
          {ownerName ? ownerName + "님" : "패드 관리자"}이 요청을 승인하면 멤버 권한으로 패드에 들어갈 수 있습니다.
        </p>

        <ol className="access-steps">
          <li><span>1</span><div><b>권한 요청 보내기</b><p>아래 버튼을 누르면 관리자 설정에 요청이 표시됩니다.</p></div></li>
          <li><span>2</span><div><b>관리자 승인 기다리기</b><p>승인되면 기본 멤버 권한이 부여됩니다.</p></div></li>
          <li><span>3</span><div><b>승인 여부 확인하기</b><p>이 페이지를 새로 확인하면 바로 패드가 열립니다.</p></div></li>
        </ol>

        {requestPending && <p className="access-status pending"><Clock3 size={16} />권한 요청을 보냈습니다. 관리자의 승인을 기다리고 있어요.</p>}
        {approved && <p className="access-status approved"><CheckCircle2 size={16} />요청이 승인되었습니다. 패드를 다시 확인해 주세요.</p>}
        {status === "REJECTED" && <p className="access-status rejected">이전 요청이 승인되지 않았습니다. 필요하다면 관리자와 확인한 뒤 다시 요청해 주세요.</p>}
        {error && <p className="form-error">{error}</p>}

        <div className="access-actions">
          <button type="button" className="button primary large" onClick={requestAccess} disabled={pending || requestPending}>
            {approved ? <CheckCircle2 size={18} /> : <Send size={18} />}
            {pending ? "요청 보내는 중..." : approved ? "패드 다시 확인하기" : requestPending ? "요청 검토 중" : "권한 요청하기"}
          </button>
          {requestPending && <button type="button" className="button soft large" onClick={() => router.refresh()}><ShieldCheck size={18} />승인 여부 확인</button>}
        </div>
      </section>
    </main>
  );
}
