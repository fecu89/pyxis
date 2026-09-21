export class JsonBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    const kibibytes = Math.ceil(maxBytes / 1024);
    const label = maxBytes < 1024 * 1024
      ? `${kibibytes}KB`
      : `${Math.ceil(maxBytes / (1024 * 1024))}MB`;
    super(`요청 본문은 ${label} 이하여야 합니다.`);
  }
}

export class InvalidJsonBodyError extends Error {
  constructor() {
    super("요청 본문이 올바른 JSON 형식이 아닙니다.");
    this.name = "InvalidJsonBodyError";
  }
}

/** Content-Length가 없거나 틀려도 실제 스트림을 읽는 동안 상한을 다시 확인합니다. */
export async function readJsonWithLimit(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new JsonBodyTooLargeError(maxBytes);
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new JsonBodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    // JSON.parse의 SyntaxError나 TextDecoder의 내부 메시지를 그대로 내보내지 않고 API 공용
    // 오류 경계가 안정적인 400 응답으로 바꿀 수 있는 도메인 오류로 정규화합니다.
    throw new InvalidJsonBodyError();
  }
}
