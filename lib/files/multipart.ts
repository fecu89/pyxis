import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { mb, UPLOAD_MULTIPART_HEADROOM_MB } from "@/lib/files/upload-policy-shape";

export type StreamedUpload = {
  temporaryPath: string;
  originalName: string;
  mimeType: string;
  size: number;
};

export type StreamedMultipartUpload = StreamedUpload & { fields: Record<string, string> };

export async function streamMultipartFile(
  request: Request,
  directory: string,
  maxBytes: number,
  options: {
    allowedFields?: readonly string[];
    maxFieldBytes?: number;
    maxTotalBytes?: number;
  } = {},
): Promise<StreamedMultipartUpload> {
  if (!request.body) throw new Error("업로드 데이터가 없습니다.");
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) throw new Error("multipart/form-data 형식만 지원합니다.");
  const contentLength = Number(request.headers.get("content-length"));
  const allowedFields = new Set(options.allowedFields ?? []);
  const maxFieldBytes = options.maxFieldBytes ?? 8 * 1024;
  // maxBytes는 순수 파일 크기이고 실제 HTTP 본문에는 multipart 경계·파트 헤더·허용 필드가
  // 더 붙습니다. Admin에서 30MB를 정했을 때 30MB 파일이 포장 오버헤드 때문에 거절되지 않도록
  // 전송 본문에는 5MB를 여유로 두되, 파일 스트림 자체는 아래에서 별도로 정확히 제한합니다.
  const maxTotalBytes = options.maxTotalBytes ?? maxBytes + mb(UPLOAD_MULTIPART_HEADROOM_MB);
  if (Number.isFinite(contentLength) && contentLength > maxTotalBytes) throw new Error("업로드 데이터가 허용 크기를 초과했습니다.");

  await mkdir(/* turbopackIgnore: true */ directory, { recursive: true });
  const temporaryPath = path.join(/* turbopackIgnore: true */ directory, `${randomUUID()}.incoming`);
  const headers = Object.fromEntries(request.headers.entries());
  let upload: StreamedUpload | null = null;
  let truncated = false;
  let tooManyFiles = false;
  let invalidFields = false;
  let writePromise: Promise<void> | null = null;
  const fields: Record<string, string> = {};

  try {
    const parser = Busboy({
      headers,
      defParamCharset: "utf8",
      limits: {
        files: 1,
        // Busboy는 fields=0이면 파일만 있는 정상 요청에서도 fieldsLimit를 발생시킵니다.
        // 예상치 못한 필드는 아래 field 핸들러가 거부하므로 내부 한도만 최소 1로 둡니다.
        fields: Math.max(1, allowedFields.size),
        // fields와 달리 Busboy의 partsLimit는 배타적입니다 — 한도를 N으로 두면 N번째 part에서
        // 바로 발생해 N-1개까지만 통과합니다(허용 필드 3개인 라우트에서 파일 1개+필드 3개=4개를
        // 보내면 한도 4에서 실제로 걸렸던 것으로 실측 확인). 파일 1개 + 허용 필드 전부를 보내도
        // 통과하도록 +2를 둡니다.
        parts: 2 + Math.max(1, allowedFields.size),
        // Busboy는 파일이 제한과 정확히 같은 크기여도 limit 이벤트를 발생시킵니다. 한 바이트를
        // 더 읽게 한 뒤 maxBytes 초과를 거절하면 30MB 설정에서 정확히 30MB인 파일은 통과하고,
        // 30MB + 1바이트부터는 여전히 스트리밍 단계에서 즉시 중단됩니다.
        fileSize: maxBytes + 1,
        fieldSize: maxFieldBytes,
      },
    });
    parser.on("filesLimit", () => { tooManyFiles = true; });
    parser.on("fieldsLimit", () => { invalidFields = true; });
    parser.on("partsLimit", () => { invalidFields = true; });
    parser.on("field", (fieldName, value, info) => {
      if (!allowedFields.has(fieldName) || info.nameTruncated || info.valueTruncated || fieldName in fields) {
        invalidFields = true;
        return;
      }
      fields[fieldName] = value;
    });
    parser.on("file", (fieldName, file, info) => {
      if (fieldName !== "file" || upload) {
        file.resume();
        return;
      }
      upload = { temporaryPath, originalName: info.filename, mimeType: info.mimeType, size: 0 };
      file.on("data", (chunk: Buffer) => { if (upload) upload.size += chunk.length; });
      file.on("limit", () => { truncated = true; });
      writePromise = pipeline(file, createWriteStream(/* turbopackIgnore: true */ temporaryPath, { flags: "wx" }));
    });

    await new Promise<void>((resolve, reject) => {
      const input = Readable.fromWeb(request.body as unknown as NodeReadableStream);
      const abort = () => input.destroy(new Error("업로드가 취소되었습니다."));
      let receivedBytes = 0;
      input.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxTotalBytes) input.destroy(new Error("업로드 데이터가 허용 크기를 초과했습니다."));
      });
      request.signal.addEventListener("abort", abort, { once: true });
      input.once("error", reject);
      parser.once("error", reject);
      parser.once("close", () => {
        request.signal.removeEventListener("abort", abort);
        resolve();
      });
      input.pipe(parser);
    });

    if (writePromise) await writePromise;
    if (!upload) throw new Error("업로드할 파일이 없습니다.");
    if (truncated) throw new Error("업로드 파일이 허용 크기를 초과했습니다.");
    if (tooManyFiles) throw new Error("파일은 한 번에 하나씩 업로드해 주세요.");
    if (invalidFields) throw new Error("업로드 항목 형식이 올바르지 않습니다.");
    return Object.assign({}, upload as StreamedUpload, { fields });
  } catch (error) {
    await unlink(/* turbopackIgnore: true */ temporaryPath).catch(() => undefined);
    throw error;
  }
}
