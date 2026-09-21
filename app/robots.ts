import type { MetadataRoute } from "next";
import { SITE_URL } from "@/utils/seo/getMetadata";

// 로그인 뒤에만 의미가 있거나 링크를 가진 사람만 여는 경로는 색인에서 뺍니다. 공개 패드
// (`/b/[slug]`)는 검색 노출이 기능의 일부라 남깁니다 — 개별 noindex는 각 페이지 metadata가 정합니다.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/dashboard", "/pad", "/search", "/profile", "/courses", "/forms",
        "/quiz", "/report",
        "/login", "/onboarding", "/approval-pending", "/change-password",
        // 참여·공유 링크는 링크를 받은 사람만 열어야 합니다.
        "/j", "/j/", "/p/", "/i/", "/f/", "/go/",
      ],
    },
    sitemap: new URL("/sitemap.xml", SITE_URL).toString(),
  };
}
