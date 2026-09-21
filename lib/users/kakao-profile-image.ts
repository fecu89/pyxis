import "server-only";

import { kakaoProfileImageUrl } from "@/lib/users/profile-image-url";

export async function resolveKakaoProfileImage(image: string | null | undefined): Promise<string | null> {
  const url = kakaoProfileImageUrl(image);
  if (!url) return null;

  try {
    // 임의 호스트/리디렉션은 요청하지 않고, 이미지 장애가 가입을 막지 않도록 제한합니다.
    const response = await fetch(url.href, {
      method: "HEAD",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok && response.headers.get("content-type")?.toLowerCase().startsWith("image/")
      ? url.href
      : null;
  } catch {
    return null;
  }
}
