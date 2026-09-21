"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { normalizeProfileImageUrl } from "@/lib/users/profile-image-url";

function AvatarPhoto({ src, label, size }: { src: string; label: string; size: "small" | "medium" }) {
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    // SSR 이미지가 hydration 전에 실패한 경우에도 깨진 이미지 대신 기본 아바타를 표시합니다.
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) return <span className={`avatar ${size}`}>{label}</span>;
  return <img ref={imageRef} className={`avatar ${size} avatar-photo`} src={src} alt="" onError={() => setFailed(true)} />;
}

export function Avatar({ name, identifier, image, size = "small" }: {
  name?: string | null;
  identifier?: string | null;
  image?: string | null;
  size?: "small" | "medium";
}) {
  const label = (name || identifier || "친")[0];
  const src = normalizeProfileImageUrl(image);
  if (src) return <AvatarPhoto key={src} src={src} label={label} size={size} />;
  return <span className={`avatar ${size}`}>{label}</span>;
}
