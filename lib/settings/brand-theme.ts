import "server-only";

import { cache } from "react";
import { SYSTEM_SETTINGS_ID } from "@/lib/board/ownership-limit";
import { getPrisma } from "@/lib/prisma";
import { DEFAULT_BRAND_THEME, normalizeBrandTheme, type BrandTheme } from "@/lib/theme";

/**
 * 사이트 전체 브랜드 색을 읽습니다. 루트 레이아웃이 **모든 요청**에서 호출하므로 세 가지를
 * 지킵니다.
 *
 * 1. `cache()`로 감싸 요청당 한 번만 조회합니다(레이아웃과 관리 화면이 각자 불러도 한 번).
 * 2. 실패해도 던지지 않습니다. 색 하나 때문에 전체 페이지가 500이 되면 안 되고, 기본값으로
 *    그리면 화면은 멀쩡합니다. DB가 잠깐 끊긴 상태에서도 공개 랜딩은 떠야 합니다.
 * 3. 값은 항상 normalize를 거칩니다 — DB에 범위 밖 값이 들어가 있어도 CSS가 깨지지 않습니다.
 *
 * 행이 아직 없으면(마이그레이션만 적용되고 아무도 저장한 적 없는 상태) 기본 파랑입니다.
 */
export const getBrandTheme = cache(async (): Promise<BrandTheme> => {
  try {
    const row = await getPrisma().systemSetting.findUnique({
      where: { id: SYSTEM_SETTINGS_ID },
      select: { brandHue: true, brandChroma: true },
    });
    return row ? normalizeBrandTheme(row) : DEFAULT_BRAND_THEME;
  } catch {
    return DEFAULT_BRAND_THEME;
  }
});
