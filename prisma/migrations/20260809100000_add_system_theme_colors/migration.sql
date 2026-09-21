-- 사이트 전체 브랜드 색을 관리자가 바꿀 수 있도록 SystemSetting에 두 축을 추가합니다.
-- app/globals.css의 --brand-h(색상각 0~359)와 --brand-c(채도 배율)에 그대로 주입되며,
-- 브랜드 11단계·중립 회색·장식 팔레트·정보 계열이 전부 이 둘에서 파생됩니다.
-- 채도는 CSS에서는 소수 배율이지만 DB에는 백분율 정수로 둡니다(100 = 기본).
-- 기본값 250/100은 기존 화면 색과 정확히 같은 값이라 이 마이그레이션만으로는 아무것도 바뀌지 않습니다.
ALTER TABLE "SystemSetting" ADD COLUMN "brandHue" INTEGER NOT NULL DEFAULT 250;
ALTER TABLE "SystemSetting" ADD COLUMN "brandChroma" INTEGER NOT NULL DEFAULT 100;
