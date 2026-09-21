import { getYouTubeThumbnailUrl, getYouTubeVideoId } from "@/lib/link-preview/youtube-url";

function normalizeHttpUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function getLinkSourceHost(value: string | null | undefined) {
  const url = normalizeHttpUrl(value);
  if (!url) return null;
  if (getYouTubeVideoId(url)) return "youtube.com";
  return url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

export function getLinkCardThumbnail(
  externalUrl: string | null | undefined,
  previewImageUrl: string | null | undefined,
) {
  const youtubeThumbnail = getYouTubeThumbnailUrl(externalUrl);
  if (youtubeThumbnail) return { src: youtubeThumbnail, isYouTube: true };
  const previewUrl = normalizeHttpUrl(previewImageUrl);
  return previewUrl ? { src: previewUrl.toString(), isYouTube: false } : null;
}
