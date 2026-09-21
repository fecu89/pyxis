import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const FORMAT = "scrypt";
const VERSION = "v1";
const COST = 2 ** 15;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 3;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
const MAX_MEMORY = 64 * 1024 * 1024;

const DUMMY_SALT = Buffer.alloc(SALT_BYTES);
const DUMMY_DERIVED_KEY = Buffer.alloc(KEY_BYTES);

function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_BYTES,
      { N: COST, r: BLOCK_SIZE, p: PARALLELIZATION, maxmem: MAX_MEMORY },
      (error, derivedKey) => error ? reject(error) : resolve(derivedKey),
    );
  });
}

export async function hashUserPassword(password: string) {
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = await derive(password, salt);
  return [
    FORMAT,
    VERSION,
    String(COST),
    String(BLOCK_SIZE),
    String(PARALLELIZATION),
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

// 사용자를 찾지 못했거나 카카오 전용 계정이어도 같은 scrypt 작업을 수행해, 응답 시간만으로
// 아이디 등록 여부를 쉽게 구분하지 못하게 합니다. DB의 변조된 파라미터로 과도한 메모리를 쓰지
// 않도록 현재 지원하는 고정 파라미터와 정확히 일치하는 해시만 검증합니다.
export async function verifyUserPassword(password: string, storedHash: string | null | undefined) {
  const parts = storedHash?.split("$") ?? [];
  const validFormat = parts.length === 7
    && parts[0] === FORMAT
    && parts[1] === VERSION
    && parts[2] === String(COST)
    && parts[3] === String(BLOCK_SIZE)
    && parts[4] === String(PARALLELIZATION);

  let salt = DUMMY_SALT;
  let storedKey = DUMMY_DERIVED_KEY;
  let supportedHash = false;
  if (validFormat) {
    try {
      const parsedSalt = Buffer.from(parts[5], "base64url");
      const parsedKey = Buffer.from(parts[6], "base64url");
      if (parsedSalt.length === SALT_BYTES && parsedKey.length === KEY_BYTES) {
        salt = parsedSalt;
        storedKey = parsedKey;
        supportedHash = true;
      }
    } catch {
      // 아래의 더미 비교까지 수행한 뒤 false를 반환합니다.
    }
  }

  const derivedKey = await derive(password, salt);
  return supportedHash
    && storedKey.length === derivedKey.length
    && timingSafeEqual(storedKey, derivedKey);
}
