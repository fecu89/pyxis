import { APP_NAME } from "@/lib/brand";
import { renderOpenGraphImage } from "@/utils/seo/openGraphImage";

export const alt = `${APP_NAME} — 배움과 생각을 함께 모으는 교육용 협업 패드`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return renderOpenGraphImage();
}
