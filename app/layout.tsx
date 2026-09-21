import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { getMetadata, SITE_NAME } from "@/utils/seo/getMetadata";
import { brandThemeStyle, isAppTheme, THEME_COOKIE_NAME } from "@/lib/theme";
import { getBrandTheme } from "@/lib/settings/brand-theme";
import { ThemeSync } from "@/components/ui/theme-sync";
import "./globals.css";
import { AppDialogProvider } from "@/components/ui/app-dialog";

// 담벼락 디자인의 본문 서체. 가변 폰트 하나로 45~920 굵기를 모두 커버합니다.
//
// npm 패키지(`pretendard`) 대신 woff2 한 개만 받아 둡니다. 패키지는 98MB인데 그중 우리가 쓰는
// 것은 이 2MB짜리 가변 폰트 하나뿐이라, 설치할 때마다 96MB를 버리는 셈이었습니다.
// `public/`이 아니라 여기 두는 이유: next/font/local이 이 파일을 해시 붙여
// `/_next/static/media/`로 immutable 캐시와 함께 서빙합니다. `public/`에 두면 캐시 안 되는
// 사본이 `/fonts/...`로 한 벌 더 나갑니다.
// 갱신은 수동입니다 — https://github.com/orioncactus/pretendard 릴리스에서 같은 파일을 받아
// 덮어쓰면 됩니다.
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  weight: "45 920",
  variable: "--font-pretendard",
  display: "swap",
  // 루트 layout의 폰트는 모든 경로에 preload됩니다. 개발 서버의 cache-busting URL은 실제
  // @font-face 요청과 사용 시점이 어긋나 경고를 만들고, 2MB 파일을 첫 화면마다 강제로 당깁니다.
  // CSS가 실제로 이 폰트를 쓰는 순간 로드하도록 두면 같은 서체를 유지하면서 낭비를 피합니다.
  preload: false,
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], preload: false });

export const metadata: Metadata = {
  ...getMetadata(),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 테마를 React 바깥 인라인 스크립트로 먼저 바꾸면 CSP nonce가 브라우저에서 숨겨지는 순간
  // hydration 속성 비교가 어긋납니다. 비민감한 테마 값은 쿠키에서 읽어 서버 HTML부터 정확히
  // 렌더링하고, 기존 localStorage 값과 시스템 기본값은 ThemeToggle이 마운트 뒤 동기화합니다.
  //
  // 브랜드 색은 이와 별개의 축입니다. 라이트/다크는 사용자가 고르지만 브랜드 색은
  // 전체관리자가 정한 사이트 공통값이라 쿠키가 아니라 DB에서 읽고, --brand-h/--brand-c
  // 두 변수만 여기서 얹으면 globals.css가 나머지 색을 전부 파생시킵니다. 기본값과 같으면
  // brandThemeStyle이 undefined를 돌려줘 속성 자체가 붙지 않습니다.
  const [cookieStore, brandTheme] = await Promise.all([cookies(), getBrandTheme()]);
  const storedTheme = cookieStore.get(THEME_COOKIE_NAME)?.value;
  const theme = isAppTheme(storedTheme) ? storedTheme : undefined;
  return (
    <html lang="ko" data-scroll-behavior="smooth" data-theme={theme} style={brandThemeStyle(brandTheme)} className={`${pretendard.variable} ${geistMono.variable}`}>
      <body>
        <ThemeSync />
        <AppDialogProvider>{children}</AppDialogProvider>
      </body>
    </html>
  );
}
