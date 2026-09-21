import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export type UserPiiField = "email" | "name" | "image";

const FORMAT_VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function requireEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 환경 변수가 설정되지 않았습니다.`);
  return value;
}

function decodeKey(value: string, name: string) {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error(`${name}은 base64로 인코딩한 32바이트 키여야 합니다.`);
  return key;
}

function activeKeyId() {
  const keyId = requireEnvironment("PII_ACTIVE_KEY_ID");
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyId)) throw new Error("PII_ACTIVE_KEY_ID 형식이 올바르지 않습니다.");
  return keyId;
}

function encryptionKey(keyId: string) {
  const environmentName = `PII_ENCRYPTION_KEY_${keyId.toUpperCase()}`;
  return decodeKey(requireEnvironment(environmentName), environmentName);
}

function associatedData(userId: string, field: UserPiiField) {
  return Buffer.from(`User:${userId}:${field}`, "utf8");
}

function boardPasswordAssociatedData(boardId: string) {
  return Buffer.from(`Board:${boardId}:password`, "utf8");
}

function encryptAuthenticatedValue(value: string, aad: Buffer) {
  const keyId = activeKeyId();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyId), iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_VERSION, keyId, iv.toString("base64url"), encrypted.toString("base64url"), tag.toString("base64url")].join(":");
}

function decryptAuthenticatedValue(payload: string, aad: Buffer, label: string) {
  const parts = payload.split(":");
  if (parts.length !== 5 || parts[0] !== FORMAT_VERSION) throw new Error(`지원하지 않는 ${label} 암호문 형식입니다.`);
  const [, keyId, ivValue, encryptedValue, tagValue] = parts;
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES) throw new Error(`${label} 암호문 형식이 올바르지 않습니다.`);

  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(keyId), iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(`${label}을 복호화하지 못했습니다.`);
  }
}

export function normalizeEmail(email: string) {
  return normalizeLoginIdentifier(email);
}

export function normalizeLoginIdentifier(value: string) {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

export function createLoginIdentifierLookup(value: string) {
  const lookupKey = decodeKey(requireEnvironment("PII_LOOKUP_KEY"), "PII_LOOKUP_KEY");
  return createHmac("sha256", lookupKey).update(normalizeLoginIdentifier(value), "utf8").digest("base64url");
}

// 기존 암호문은 AAD 필드명이 `email`이므로 DB 컬럼을 loginIdentifier로 일반화해도 이 값은
// 바꾸지 않습니다. 이 래퍼를 통해 새 코드에서 레거시 암호화 세부사항이 새어나오지 않게 합니다.
export function encryptUserLoginIdentifier(userId: string, value: string) {
  return encryptUserPii(userId, "email", value);
}

export function decryptUserLoginIdentifier(userId: string, payload: string) {
  return decryptUserPii(userId, "email", payload);
}

export function normalizeNickname(value: string) {
  return value.trim().normalize("NFKC").replace(/\s+/gu, " ");
}

function createNamespacedLookup(namespace: string, value: string) {
  const lookupKey = decodeKey(requireEnvironment("PII_LOOKUP_KEY"), "PII_LOOKUP_KEY");
  return createHmac("sha256", lookupKey)
    .update(`${namespace}\0${value}`, "utf8")
    .digest("base64url");
}

export function createNicknameLookup(value: string) {
  return createNamespacedLookup("user-nickname:v1", normalizeNickname(value).toLocaleLowerCase("ko-KR"));
}

export function createAuthSecurityLookup(namespace: string, value: string) {
  return createNamespacedLookup(`auth-security:v1:${namespace}`, value);
}

export function encryptUserPii(userId: string, field: UserPiiField, value: string) {
  return encryptAuthenticatedValue(value, associatedData(userId, field));
}

export function encryptOptionalUserPii(userId: string, field: UserPiiField, value: string | null | undefined) {
  return value ? encryptUserPii(userId, field, value) : null;
}

export function decryptUserPii(userId: string, field: UserPiiField, payload: string) {
  return decryptAuthenticatedValue(payload, associatedData(userId, field), "개인정보");
}

export function decryptOptionalUserPii(userId: string, field: UserPiiField, payload: string | null | undefined) {
  return payload ? decryptUserPii(userId, field, payload) : null;
}

// 공유용 패드 비밀번호는 방문자 검증에는 계속 scrypt 해시를 사용합니다. 이 암호문은 소유자가
// 설정 화면에서 다시 확인할 때만 쓰며, Board id를 AAD로 묶어 다른 패드에 복사할 수 없습니다.
export function encryptBoardPasswordSecret(boardId: string, value: string) {
  return encryptAuthenticatedValue(value, boardPasswordAssociatedData(boardId));
}

export function decryptBoardPasswordSecret(boardId: string, payload: string) {
  return decryptAuthenticatedValue(payload, boardPasswordAssociatedData(boardId), "패드 비밀번호");
}

export function maskLoginIdentifier(value: string) {
  const separator = value.lastIndexOf("@");
  if (separator <= 0) {
    const characters = Array.from(value);
    if (characters.length <= 2) return "*".repeat(Math.max(1, characters.length));
    const visibleStart = characters.slice(0, Math.min(2, characters.length - 1)).join("");
    const visibleEnd = characters.slice(-Math.min(2, characters.length - visibleStart.length)).join("");
    return `${visibleStart}${"*".repeat(Math.max(3, characters.length - visibleStart.length - visibleEnd.length))}${visibleEnd}`;
  }
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}
