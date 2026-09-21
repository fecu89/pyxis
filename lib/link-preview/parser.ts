import type { LinkPreview } from "@/lib/link-preview/types";

const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\"",
};

function decodeEntities(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
    if (token.startsWith("#x")) {
      const codePoint = Number.parseInt(token.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (token.startsWith("#")) {
      const codePoint = Number.parseInt(token.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return namedEntities[token.toLowerCase()] ?? entity;
  });
}

function cleanText(value: string | undefined, maxLength: number) {
  if (!value) return null;
  const cleaned = decodeEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function parseAttributes(tag: string) {
  const attributes = new Map<string, string>();
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function safeResolvedUrl(value: string | undefined, base: URL) {
  if (!value) return null;
  try {
    const decoded = decodeEntities(value).trim();
    // URL 메타 값에 따옴표·태그·공백을 섞어 속성을 탈출하려는 고전적인
    // `src="..." onerror="..."` 페이로드는 URL 파서에 넘기기 전 거부합니다.
    if (/[\u0000-\u0020"'<>`]/.test(decoded)) return null;
    const resolved = new URL(decoded, base);
    if (!["http:", "https:"].includes(resolved.protocol) || resolved.username || resolved.password) return null;
    resolved.hash = "";
    return resolved.toString();
  } catch {
    return null;
  }
}

export function parseLinkPreview(html: string, finalUrl: URL): LinkPreview {
  const metadata = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = parseAttributes(tag);
    const key = (attributes.get("property") ?? attributes.get("name") ?? "").toLowerCase();
    const content = attributes.get("content");
    if (key && content && !metadata.has(key)) metadata.set(key, content);
  }

  const documentTitle = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = cleanText(
    metadata.get("og:title") ?? metadata.get("twitter:title") ?? documentTitle,
    180,
  ) ?? finalUrl.hostname;
  const description = cleanText(
    metadata.get("og:description") ?? metadata.get("twitter:description") ?? metadata.get("description"),
    500,
  );
  const siteName = cleanText(metadata.get("og:site_name"), 100);
  const image = safeResolvedUrl(
    metadata.get("og:image:secure_url")
      ?? metadata.get("og:image")
      ?? metadata.get("twitter:image"),
    finalUrl,
  );
  const canonical = safeResolvedUrl(metadata.get("og:url"), finalUrl) ?? finalUrl.toString();

  return { url: canonical, title, description, image, siteName };
}
