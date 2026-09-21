"use client";

import { useState } from "react";
import styles from "@/components/pad/export/print-actions.module.css";

// PDF는 별도 서버 렌더러 없이 이 인쇄 페이지의 브라우저 인쇄 기능("다른 이름으로 저장 > PDF")으로
// 만듭니다 — 같은 CSS·이미지를 그대로 재사용해 실제 화면과 동일하게 여러 페이지로 나뉩니다.
// PNG는 html2canvas로 인쇄 영역을 캡처합니다(padupgrade.md 8.3).
export function PrintActions({ targetId, fileName }: { targetId: string; fileName: string }) {
  const [savingImage, setSavingImage] = useState(false);
  const [error, setError] = useState("");

  async function saveAsPng() {
    setError("");
    setSavingImage(true);
    try {
      const target = document.getElementById(targetId);
      if (!target) throw new Error("내보낼 영역을 찾지 못했습니다.");
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(target, { backgroundColor: null, useCORS: true, scale: 2 });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("이미지를 만들지 못했습니다.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${fileName}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PNG 저장에 실패했습니다.");
    } finally {
      setSavingImage(false);
    }
  }

  return (
    <div className={`${styles.bar} no-print`}>
      <button type="button" onClick={() => window.print()}>PDF로 저장</button>
      <button type="button" onClick={saveAsPng} disabled={savingImage}>{savingImage ? "이미지 만드는 중..." : "PNG로 저장"}</button>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
