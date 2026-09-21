import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { streamMultipartFile } from "@/lib/files/multipart";

function requestFor(fileBytes: number, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", new File([Buffer.alloc(fileBytes, 7)], "roster.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("http://localhost/upload", { method: "POST", body: form });
}

async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), "pyxis-multipart-verify-"));
  try {
    const uploaded = await streamMultipartFile(requestFor(32, { mode: "preview", prefix: "s" }), directory, 64, {
    allowedFields: ["mode", "prefix", "reason"],
    maxFieldBytes: 32,
    maxTotalBytes: 2_048,
  });
    assert.equal(uploaded.size, 32);
    assert.equal(uploaded.fields.mode, "preview");
    assert.equal(uploaded.fields.prefix, "s");
    assert.equal((await readFile(uploaded.temporaryPath)).byteLength, 32);
    await unlink(uploaded.temporaryPath);

    // 파일 한도와 전체 multipart 본문 한도는 같지 않습니다. 파일이 정확히 상한이어도 경계와
    // Content-Disposition/Content-Type 헤더가 더 붙으므로 기본 5MB 여유 안에서 통과해야 합니다.
    const exactLimit = await streamMultipartFile(requestFor(512), directory, 512);
    assert.equal(exactLimit.size, 512);
    await unlink(exactLimit.temporaryPath);

    await assert.rejects(() => streamMultipartFile(requestFor(65), directory, 64, {
    maxTotalBytes: 2_048,
  }), /허용 크기/);

    await assert.rejects(() => streamMultipartFile(requestFor(8, { mode: "x".repeat(33) }), directory, 64, {
    allowedFields: ["mode"],
    maxFieldBytes: 32,
    maxTotalBytes: 2_048,
  }), /항목 형식/);

    await assert.rejects(() => streamMultipartFile(requestFor(8), directory, 64, {
    maxTotalBytes: 64,
  }), /업로드 데이터가 허용 크기/);

    console.log("multipart_limit_checks=passed file_limit=streamed field_limit=streamed total_limit=streamed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void main();
