const KAKAO_IMAGE_HOSTS = new Set(["k.kakaocdn.net", "img1.kakaocdn.net"]);

export function kakaoProfileImageUrl(image: string | null | undefined): URL | null {
  if (!image) return null;
  try {
    const url = new URL(image);
    if (!KAKAO_IMAGE_HOSTS.has(url.hostname) || url.username || url.password || url.port) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.protocol = "https:";
    return url;
  } catch {
    return null;
  }
}

// 기존 암호문·업로드 경로는 보존하고, HTTPS가 지원되는 카카오 호스트만 승격합니다.
export function normalizeProfileImageUrl(image: string | null | undefined): string | null {
  if (!image) return null;
  return kakaoProfileImageUrl(image)?.href ?? image;
}
