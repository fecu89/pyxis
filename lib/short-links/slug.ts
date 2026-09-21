export const SHORT_LINK_SLUG_MIN_LENGTH = 3;
export const SHORT_LINK_SLUG_MAX_LENGTH = 40;

const SHORT_LINK_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function normalizeShortLinkSlug(value: string) {
  return value.trim().toLowerCase();
}

export function shortLinkSlugError(value: string): string | null {
  const slug = normalizeShortLinkSlug(value);
  if (slug.length < SHORT_LINK_SLUG_MIN_LENGTH || slug.length > SHORT_LINK_SLUG_MAX_LENGTH) {
    return `짧은 주소는 ${SHORT_LINK_SLUG_MIN_LENGTH}~${SHORT_LINK_SLUG_MAX_LENGTH}자로 입력해 주세요.`;
  }
  if (!SHORT_LINK_SLUG_PATTERN.test(slug)) {
    return "영문 소문자, 숫자, 하이픈만 사용할 수 있고 하이픈으로 시작하거나 끝낼 수 없습니다.";
  }
  if (slug.includes("--")) return "하이픈은 연달아 사용할 수 없습니다.";
  return null;
}

export function isValidShortLinkSlug(value: string) {
  return shortLinkSlugError(value) === null;
}
