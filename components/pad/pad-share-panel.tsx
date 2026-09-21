"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { Check, Copy, LoaderCircle, QrCode } from "lucide-react";
import type { PadData } from "@/components/pad/types";
import { boardRoutePath } from "@/lib/board/route-paths";
import { ShortLinkManager } from "@/components/share/short-link-manager";
import styles from "@/components/pad/pad-share-panel.module.css";

// 상단의 "공유" 패널은 링크를 다른 사람에게 전달하는 일만 담당합니다. 공개 범위와 비밀번호는
// 설정 패널의 PadSharingSettings 한 곳에서만 관리해 두 화면의 값과 역할이 겹치지 않게 합니다.
export function PadSharePanel({ board, canManage }: {
  board: Pick<PadData, "id" | "slug" | "title">;
  canManage: boolean;
}) {
  const [url, setUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const boardUrl = `${window.location.origin}${boardRoutePath(board.slug)}`;
      setUrl(boardUrl);
      const QRCode = await import("qrcode");
      const dataUrl = await QRCode.toDataURL(boardUrl, {
        width: 220,
        margin: 1,
        color: { dark: "#17202a", light: "#ffffff" },
      }).catch(() => "");
      if (!cancelled && dataUrl) setQrDataUrl(dataUrl);
    }

    void load();
    return () => { cancelled = true; };
  }, [board.slug]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyLink() {
    if (!url) return;
    setCopyError("");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopyError("링크를 복사하지 못했어요. 주소를 길게 눌러 직접 복사해 주세요.");
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.shareCard}>
        <div className={styles.qrFrame}>
          {qrDataUrl
            ? <img src={qrDataUrl} alt={`${board.title} 패드 QR 코드`} width={174} height={174} />
            : <LoaderCircle className="spin" size={28} aria-label="QR 코드 만드는 중" />}
        </div>
        <div className={styles.intro}>
          <span className={styles.eyebrow}><QrCode size={15} />바로 공유하기</span>
          <h3>{board.title}</h3>
          <p>QR 코드를 스캔하거나 아래 링크를 복사해 전달하세요.</p>
        </div>
      </div>

      <div className={styles.linkBlock}>
        <label htmlFor="pad-share-url">공유 링크</label>
        <div className={styles.linkRow}>
          <input id="pad-share-url" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
          <button type="button" className="button primary" onClick={copyLink} disabled={!url}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "복사됨" : "복사"}
          </button>
        </div>
        <p>이 링크에는 현재 패드에 설정된 접근 정책이 그대로 적용돼요.</p>
      </div>
      {canManage ? <ShortLinkManager targetType="BOARD" targetId={board.id} /> : null}
      {copyError && <p className="form-error" role="alert">{copyError}</p>}
    </div>
  );
}
