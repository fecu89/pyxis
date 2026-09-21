"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { PdfViewer } from "@/components/pad/attachments/pdf-viewer";
import styles from "@/components/pad/attachments/document-viewer.module.css";

/**
 * 오피스 문서(pptx·docx·xlsx) 미리보기.
 *
 * 직접 그리지 않고 **서버가 만든 PDF를 기존 PDF 뷰어로 봅니다**. 브라우저용 pptx 렌더러는
 * 마스터·레이아웃·도형·임베드 폰트를 제대로 못 살려서, 수업 자료로 쓰기엔 충실도가 모자랍니다.
 * 서버 변환은 LibreOffice가 원래 열던 대로 그리므로 결과가 훨씬 믿을 만합니다.
 *
 * 변환기가 없는 배포도 있습니다(설치는 선택입니다). 그때 서버는 501을 돌려주고, 이 컴포넌트는
 * 아무것도 그리지 않아 첨부는 예전처럼 내려받기 카드로 남습니다 — 기능이 없다고 화면이
 * 깨지지는 않습니다.
 */
export function OfficeViewer({ url, title, downloadUrl, fallback }: {
  url: string;
  title: string;
  downloadUrl?: string;
  /** 미리보기를 만들 수 없을 때 대신 보여 줄 것(내려받기 카드). */
  fallback: React.ReactNode;
}) {
  const previewUrl = `${url}?variant=preview`;
  const [state, setState] = useState<"checking" | "ready" | "unavailable">("checking");
  const [reason, setReason] = useState("");

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    // 변환이 몰리면 서버가 503 + Retry-After로 답합니다. 그건 실패가 아니라 "지금은 바쁨"이라
    // 몇 번 더 기다렸다 물어봅니다. 그래도 안 되면 내려받기 카드로 물러납니다.
    const attempt = async (remaining: number) => {
      try {
        // 첫 요청이 실제 변환을 돌리므로 시간이 걸릴 수 있는데, 그동안 "준비하는 중"을
        // 보여 주려면 이 단계가 필요합니다. 성공하면 PDF 뷰어가 같은 주소를 다시 부르고,
        // 그때는 서버가 만들어 둔 결과를 바로 돌려줍니다.
        const response = await fetch(previewUrl, { method: "GET", headers: { Range: "bytes=0-0" }, signal: controller.signal });
        if (disposed) return;
        if (response.ok || response.status === 206) {
          setState("ready");
          return;
        }
        if (response.status === 503 && remaining > 0) {
          const after = Number(response.headers.get("Retry-After") ?? "5");
          timer = setTimeout(() => { void attempt(remaining - 1); }, Math.min(15, Math.max(1, after)) * 1000);
          return;
        }
        setReason(await response.text().catch(() => ""));
        setState("unavailable");
      } catch {
        if (!disposed && !controller.signal.aborted) setState("unavailable");
      }
    };

    void attempt(3);
    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [previewUrl]);

  if (state === "checking") {
    return (
      <div className={styles.root}>
        <p className={styles.status}>
          <LoaderCircle size={20} className="spin" aria-hidden />
          미리보기를 준비하는 중…
          <span>문서를 처음 열 때만 시간이 조금 걸려요.</span>
        </p>
      </div>
    );
  }

  if (state === "unavailable") {
    return (
      <>
        {fallback}
        {reason && <p className={styles.note}>{reason}</p>}
      </>
    );
  }

  return <PdfViewer url={previewUrl} title={title} downloadUrl={downloadUrl} />;
}
