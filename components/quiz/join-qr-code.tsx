"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import QRCode from "qrcode";
import { CopyButton } from "@/components/ui/copy-button";
import { QrCodeIcon } from "@/components/ui/icons";
import { ShortLinkManager } from "@/components/share/short-link-manager";

// quiz는 qrcode.react를 썼지만 pad에는 이미 `qrcode`가 있어(초대 링크·공유 이미지에서 사용)
// 의존성을 하나 더 늘리지 않고 그쪽으로 그렸습니다. 브라우저에서만 그리므로 effect 안에서
// data URL을 만들고, 만들어지기 전에는 같은 크기의 자리표시자를 둡니다.
const subscribeToOrigin = () => () => {};
const getBrowserOrigin = () => window.location.origin;
const getServerOrigin = () => "";

export function JoinQrCode({ pin, requiresLogin, sessionId, compact = false }: { pin: string; requiresLogin: boolean; sessionId?: string; compact?: boolean }) {
  const origin = useSyncExternalStore(subscribeToOrigin, getBrowserOrigin, getServerOrigin);
  const [dataUrl, setDataUrl] = useState("");
  const size = compact ? 132 : 176;
  // 공개/비공개가 한 라우트라 주소는 같습니다. requiresLogin은 안내 문구만 가릅니다.
  const path = `/j/${pin}`;
  const joinUrl = origin ? `${origin}${path}` : path;

  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    // QR은 스캔 대비를 위해 다크 모드에서도 흰 바탕과 어두운 전경을 유지합니다.
    QRCode.toDataURL(joinUrl, { width: size, margin: 1, errorCorrectionLevel: "M", color: { dark: "#00437e", light: "#ffffff" } })
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setDataUrl(""); });
    return () => { cancelled = true; };
  }, [joinUrl, origin, size]);

  // 이 카드는 QR 스캔 대비 때문에 테마와 **무관하게** 흰 바탕입니다. 그래서 안쪽 글자·테두리에
  // 테마를 따라 뒤집히는 역할 토큰(--content/--muted/--line)을 쓰면 안 됩니다 — 다크 모드에서
  // 흰 바탕 위에 밝은 회색 글자가 얹혀 "참여 링크 복사"가 3.23:1까지 떨어졌습니다.
  // 밝기가 고정된 브랜드 스케일(--brand-*)로 고정합니다.
  return (
    <div className={`rounded-2xl bg-white text-brand-950 ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-center gap-2 text-left">
        <QrCodeIcon className="h-4 w-4 text-brand-700" />
        <div>
          <p className="text-[11px] font-black">QR로 바로 참여</p>
          <p className="mt-0.5 text-[9px] text-brand-800">{requiresLogin ? "로그인 후 자동 복귀" : "닉네임 입력 후 즉시 입장"}</p>
        </div>
      </div>
      <div className="mt-3 grid place-items-center rounded-xl bg-white p-2">
        {dataUrl
          ? <Image src={dataUrl} width={size} height={size} alt={`${pin} 퀴즈 참여 QR 코드`} unoptimized />
          : <div style={{ width: size, height: size }} className="animate-pulse rounded-xl bg-brand-100" />}
      </div>
      <CopyButton value={joinUrl} label="참여 링크 복사" className="mt-3 w-full border border-brand-200 bg-white px-3 py-2 text-brand-800 hover:bg-brand-50" />
      {sessionId ? <ShortLinkManager targetType="QUIZ_SESSION" targetId={sessionId} fixedLight collapsible /> : null}
    </div>
  );
}
