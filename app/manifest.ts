import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/brand";
import { getBrandTheme } from "@/lib/settings/brand-theme";
import { brandHex } from "@/lib/theme";

// 파비콘 생성물은 public/favicon에 두고, Next.js manifest 규칙으로 실제 경로와 제품 정보를 연결합니다.
//
// theme_color는 모바일 브라우저 주소창과 앱 전환기 색이라 브랜드를 따라야 하는데, 여기서는
// CSS 변수를 쓸 수 없어 유일하게 oklch를 직접 16진수로 계산합니다(lib/theme.ts의 brandHex).
// 예전에는 Tailwind slate-800(#1e293b)이 박혀 있어서 브랜드와 아무 상관 없는 색이었습니다.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const brandTheme = await getBrandTheme();
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: "배움과 생각을 함께 모으는 교육용 협업 패드",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: brandHex(brandTheme),
    icons: [
      { src: "/favicon/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/favicon/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
