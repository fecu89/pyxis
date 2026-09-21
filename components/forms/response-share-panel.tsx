"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Copy, ExternalLink, LoaderCircle, QrCode } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ShortLinkManager } from "@/components/share/short-link-manager";

const subscribeToOrigin = () => () => {};
const getBrowserOrigin = () => window.location.origin;
const getServerOrigin = () => "";

export function FormResponseSharePanel({ formId, slug, title, canManage }: { formId: string; slug: string; title: string; canManage: boolean }) {
  const origin = useSyncExternalStore(subscribeToOrigin, getBrowserOrigin, getServerOrigin);
  const path = `/s/${slug}`;
  const responseUrl = origin ? `${origin}${path}` : path;
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrFailed, setQrFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    async function createQrCode() {
      try {
        const QRCode = await import("qrcode");
        const dataUrl = await QRCode.toDataURL(responseUrl, {
          width: 220,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#00437e", light: "#ffffff" },
        });
        if (!cancelled) setQrDataUrl(dataUrl);
      } catch {
        if (!cancelled) setQrFailed(true);
      }
    }
    void createQrCode();
    return () => { cancelled = true; };
  }, [origin, responseUrl]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyLink() {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(responseUrl);
      setCopied(true);
    } catch {
      setCopyError("링크를 복사하지 못했습니다. 주소를 선택해 직접 복사해 주세요.");
    }
  }

  return (
    <section aria-label="설문 응답 링크" className="grid gap-5 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[184px_minmax(0,1fr)] sm:p-5">
      <div className="grid h-[184px] w-[184px] place-items-center justify-self-center rounded-lg border border-line bg-white p-2">
        {qrDataUrl ? (
          <Image src={qrDataUrl} width={168} height={168} alt={`${title || "설문지"} 응답 QR 코드`} unoptimized />
        ) : qrFailed ? (
          <p role="status" className="px-3 text-center text-xs font-bold leading-5 text-brand-900">QR 코드를 만들지 못했습니다.<br />아래 링크를 사용해 주세요.</p>
        ) : (
          <LoaderCircle className="h-7 w-7 animate-spin text-brand" aria-label="QR 코드 만드는 중" />
        )}
      </div>

      <div className="min-w-0 self-center">
        <div className="flex items-center gap-2 text-brand">
          <QrCode className="h-4 w-4" aria-hidden />
          <h2 className="text-sm font-black">응답 링크 공유</h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-content-muted">QR 코드를 스캔하거나 아래 주소를 복사해 응답자에게 보내세요.</p>

        <label htmlFor={`form-response-url-${slug}`} className="mt-4 block text-xs font-black text-content-muted">설문지 주소</label>
        <input
          id={`form-response-url-${slug}`}
          readOnly
          value={responseUrl}
          onFocus={(event) => event.currentTarget.select()}
          className="mt-2 h-11 w-full rounded-lg border border-line bg-surface-inset px-3 font-mono text-sm font-bold text-content outline-none focus:border-brand"
        />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <button type="button" onClick={() => void copyLink()} aria-label={copied ? "링크 복사 완료" : "응답 링크 복사"} title={copied ? "복사됨" : "링크 복사"} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand px-2 text-sm font-black text-on-brand transition hover:bg-brand-strong sm:px-4">
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            <span className="hidden sm:inline">{copied ? "복사됨" : "링크 복사"}</span>
          </button>
          <Link href={path} target="_blank" rel="noopener noreferrer" aria-label="새 창에서 설문 열기" title="설문 열기" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-2 text-sm font-black text-content-muted transition hover:border-brand-300 hover:text-brand sm:px-4">
            <ExternalLink className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">설문 열기</span>
          </Link>
        </div>
        {copyError ? <p role="alert" className="mt-3 text-xs font-bold text-danger">{copyError}</p> : null}
        {canManage ? <ShortLinkManager targetType="FORM" targetId={formId} /> : null}
      </div>
    </section>
  );
}

export function FormResponseShareDialog({ open, onClose, formId, slug, title, canManage = true }: {
  open: boolean;
  onClose: () => void;
  formId: string;
  slug: string;
  title: string;
  canManage?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title="설문지 공유" description="이 주소에서 설문 응답을 받을 수 있습니다." className="sm:!w-[680px]">
      <div className="p-4 sm:p-5">
        <FormResponseSharePanel formId={formId} slug={slug} title={title} canManage={canManage} />
      </div>
    </Modal>
  );
}
