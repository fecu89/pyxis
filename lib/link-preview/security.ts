import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const blockedHostnameSuffixes = [
  ".internal",
  ".invalid",
  ".lan",
  ".local",
  ".localhost",
  ".test",
];

function stripIpv6Brackets(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function isBlockedIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = octets;
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
  );
}

function isBlockedIpv6(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized) || normalized.startsWith("ff")) return true;
  if (normalized.startsWith("2001:db8:")) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? isBlockedIpv4(mapped) : false;
}

export function isPublicAddress(address: string) {
  const version = isIP(address);
  if (version === 4) return !isBlockedIpv4(address);
  if (version === 6) return !isBlockedIpv6(address);
  return false;
}

export function normalizePreviewUrl(value: string, base?: URL) {
  let url: URL;
  try {
    url = base ? new URL(value, base) : new URL(value);
  } catch {
    throw new LinkPreviewError("올바른 URL을 입력해 주세요.", 400);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new LinkPreviewError("HTTP 또는 HTTPS 주소만 미리 볼 수 있습니다.", 400);
  }
  if (url.username || url.password) {
    throw new LinkPreviewError("사용자 정보가 포함된 URL은 미리 볼 수 없습니다.", 400);
  }
  if ((url.protocol === "http:" && url.port && url.port !== "80") || (url.protocol === "https:" && url.port && url.port !== "443")) {
    throw new LinkPreviewError("표준 포트를 사용하는 주소만 미리 볼 수 있습니다.", 400);
  }

  const hostname = stripIpv6Brackets(url.hostname).toLowerCase().replace(/\.$/, "");
  if (
    !hostname
    || hostname === "localhost"
    || blockedHostnameSuffixes.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new LinkPreviewError("로컬 또는 내부 네트워크 주소는 미리 볼 수 없습니다.", 400);
  }
  url.hash = "";
  return url;
}

export async function resolvePublicAddress(url: URL) {
  const hostname = stripIpv6Brackets(url.hostname);
  const literalVersion = isIP(hostname);
  const addresses = literalVersion
    ? [{ address: hostname, family: literalVersion }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => []);

  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new LinkPreviewError("외부에서 접근 가능한 공개 주소만 미리 볼 수 있습니다.", 400);
  }
  return addresses[0];
}

export async function validatePublicLinkUrl(value: string) {
  const url = normalizePreviewUrl(value);
  await resolvePublicAddress(url);
  return url.toString();
}

export class LinkPreviewError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "LinkPreviewError";
  }
}
