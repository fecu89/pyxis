export const THEME_COOKIE_NAME = "pyxis-theme";
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type AppTheme = "light" | "dark";

export function isAppTheme(value: unknown): value is AppTheme {
  return value === "light" || value === "dark";
}

/* ── 사이트 전체 브랜드 색 ─────────────────────────────────────────────────────
   라이트/다크(위 AppTheme)와는 다른 축입니다. 라이트/다크는 사용자가 고르고 쿠키에
   저장되지만, 브랜드 색은 전체관리자가 한 번 정해 SystemSetting에 저장하고 모든
   사용자와 비로그인 방문자가 같은 값을 봅니다.

   app/globals.css가 --brand-h(색상각)와 --brand-c(채도 배율) 둘만 받아서 브랜드 11단계,
   중립 회색, 장식 팔레트, 정보 계열을 전부 파생시킵니다. 명도 곡선은 CSS가 고정으로
   들고 있으므로 어떤 값을 넣어도 본문 대비는 유지됩니다 — 관리자가 화면을 못 읽게
   만들 수 없는 구조입니다. 상태색(위험·경고·성공)은 의미가 색 자체라 따라가지 않습니다. */

export const DEFAULT_BRAND_HUE = 250;
export const DEFAULT_BRAND_CHROMA = 100;

export type BrandTheme = { brandHue: number; brandChroma: number };

export const DEFAULT_BRAND_THEME: BrandTheme = {
  brandHue: DEFAULT_BRAND_HUE,
  brandChroma: DEFAULT_BRAND_CHROMA,
};

/** 채도 배율의 허용 범위(백분율). 0은 완전 무채색, 130은 원색에 가깝습니다. */
export const BRAND_CHROMA_MIN = 0;
export const BRAND_CHROMA_MAX = 130;

/** 관리자가 고를 수 있는 미리 검증된 팔레트. 색상각만 다르고 명도 곡선은 모두 같습니다. */
export const BRAND_PRESETS = [
  { id: "blue", label: "파랑", hint: "기본값", brandHue: 250, brandChroma: 100 },
  { id: "teal", label: "청록", hint: "차분한 학습 도구", brandHue: 200, brandChroma: 100 },
  { id: "green", label: "초록", hint: "예전 담벼락 색", brandHue: 150, brandChroma: 95 },
  { id: "violet", label: "보라", hint: "또렷한 강조", brandHue: 300, brandChroma: 100 },
  { id: "orange", label: "주황", hint: "따뜻한 인상", brandHue: 45, brandChroma: 95 },
  { id: "slate", label: "무채색", hint: "색을 거의 쓰지 않음", brandHue: 250, brandChroma: 12 },
] as const;

export type BrandPresetId = (typeof BRAND_PRESETS)[number]["id"];

/** 저장된 값이 어떤 프리셋과 정확히 일치하면 그 id를, 아니면 null(직접 지정)을 돌려줍니다. */
export function matchBrandPreset({ brandHue, brandChroma }: BrandTheme): BrandPresetId | null {
  const hit = BRAND_PRESETS.find((preset) => preset.brandHue === brandHue && preset.brandChroma === brandChroma);
  return hit ? hit.id : null;
}

/**
 * DB나 요청에서 온 값을 항상 렌더링 가능한 범위로 좁힙니다. 색상각은 0~359로 감고
 * 채도는 상한을 둡니다 — 관리자가 무엇을 보내도 CSS가 깨지지 않아야 합니다.
 */
export function normalizeBrandTheme(input: Partial<BrandTheme> | null | undefined): BrandTheme {
  const hue = Number(input?.brandHue);
  const chroma = Number(input?.brandChroma);
  return {
    brandHue: Number.isFinite(hue) ? ((Math.round(hue) % 360) + 360) % 360 : DEFAULT_BRAND_HUE,
    brandChroma: Number.isFinite(chroma)
      ? Math.min(BRAND_CHROMA_MAX, Math.max(BRAND_CHROMA_MIN, Math.round(chroma)))
      : DEFAULT_BRAND_CHROMA,
  };
}

/**
 * 루트 <html>에 얹을 인라인 스타일입니다. 기본값과 같으면 아무것도 얹지 않습니다 —
 * globals.css의 :root가 이미 같은 값을 들고 있어서, 굳이 속성을 붙이면 서버 HTML만
 * 길어지고 diff도 지저분해집니다.
 */
export function brandThemeStyle(theme: BrandTheme): Record<string, string> | undefined {
  const { brandHue, brandChroma } = normalizeBrandTheme(theme);
  if (brandHue === DEFAULT_BRAND_HUE && brandChroma === DEFAULT_BRAND_CHROMA) return undefined;
  return { "--brand-h": String(brandHue), "--brand-c": String(brandChroma / 100) };
}

/**
 * oklch → sRGB 16진수. PWA 매니페스트의 theme_color처럼 CSS 변수를 쓸 수 없는 자리에만
 * 씁니다. 화면 색은 전부 CSS가 직접 계산하므로 이 함수를 거치지 않습니다.
 * 변환식은 Björn Ottosson의 Oklab 역변환이고, sRGB 밖으로 나가는 값은 채널을 자릅니다.
 */
export function oklchToHex(l: number, c: number, hDegrees: number): string {
  const h = (hDegrees * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const [L, M, S] = [l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_];

  const linear = [
    +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
  return `#${linear
    .map((v) => {
      const srgb = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
      return Math.min(255, Math.max(0, Math.round(srgb * 255)))
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

/** globals.css의 --brand(라이트)와 같은 좌표입니다. 두 곳이 어긋나면 매니페스트만 색이 틀어집니다. */
export function brandHex(theme: BrandTheme): string {
  const { brandHue, brandChroma } = normalizeBrandTheme(theme);
  return oklchToHex(0.55, 0.16 * (brandChroma / 100), brandHue);
}
