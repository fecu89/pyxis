import type { Metadata } from "next";
import { APP_NAME } from "@/lib/brand";

export const SITE_NAME = APP_NAME;
export const SITE_DESCRIPTION = "패드·퀴즈·설문 활동을 모아 AI로 학생 생활기록부까지 정리하는 교육 플랫폼";

function normalizeBaseUrl(value: string | undefined) {
  const candidate = value?.trim()
    || process.env.NEXT_PUBLIC_URL?.trim()
    || process.env.NEXTAUTH_URL?.trim()
    || process.env.VERCEL_URL?.trim()
    || "http://localhost:3001";
  return /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
}

export const SITE_URL = normalizeBaseUrl(process.env.NEXT_PUBLIC_URL);

function normalizePath(value?: string) {
  if (!value) return "/";
  try {
    return new URL(value, SITE_URL).pathname || "/";
  } catch {
    const path = value.startsWith("/") ? value : `/${value}`;
    return path.split("#")[0].split("?")[0] || "/";
  }
}

function toAbsoluteUrl(value: string) {
  try {
    const url = new URL(value, SITE_URL);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : SITE_URL;
  } catch {
    return SITE_URL;
  }
}

export type GetMetadataOptions = {
  title?: string;
  description?: string | null;
  asPath?: string;
  ogImage?: string;
  ogImageAlt?: string;
  keywords?: string[];
  noIndex?: boolean;
};

// blog/utils/seo/getMetadata.tsx의 핵심 패턴(canonical, OG, Twitter, robots)을 pad에
// 필요한 범위로 분리했습니다. 다국어·광고 설정은 이 앱에 없으므로 의존시키지 않습니다.
export function getMetadata(options: GetMetadataOptions = {}): Metadata {
  const title = options.title?.trim() || SITE_NAME;
  const description = options.description?.trim() || SITE_DESCRIPTION;
  const canonical = toAbsoluteUrl(normalizePath(options.asPath));
  const ogImage = toAbsoluteUrl(options.ogImage || "/opengraph-image");
  const keywords = Array.from(new Set([
    ...(options.keywords ?? []),
    SITE_NAME,
    "교육",
    "생활기록부",
    "협업 패드",
    "퀴즈",
  ]));

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    keywords,
    authors: [{ name: SITE_NAME }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    alternates: { canonical },
    robots: options.noIndex
      ? { index: false, follow: false, nocache: true }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
          },
        },
    openGraph: {
      type: "website",
      locale: "ko_KR",
      siteName: SITE_NAME,
      title,
      description,
      url: canonical,
      images: [{
        url: ogImage,
        width: 1200,
        height: 630,
        alt: options.ogImageAlt || title,
      }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
    icons: {
      icon: [
        { url: "/favicon/favicon.ico", sizes: "any" },
        { url: "/favicon/favicon-16x16.png", sizes: "16x16", type: "image/png" },
        { url: "/favicon/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      ],
      shortcut: "/favicon/favicon.ico",
      apple: "/favicon/apple-touch-icon.png",
    },
    manifest: "/manifest.webmanifest",
  };
}
