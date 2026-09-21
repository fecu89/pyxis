import "server-only";

import { opendir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { getUploadRoot } from "@/lib/files/paths";

const PREVIEW_SUFFIX = ".preview.pdf";

type PreviewEntry = {
  path: string;
  size: number;
  mtimeMs: number;
};

function megabytes(name: string, fallback: number, minimum: number, maximum: number) {
  const configured = Number(process.env[name] ?? fallback);
  const value = Number.isFinite(configured) ? configured : fallback;
  return Math.floor(Math.min(maximum, Math.max(minimum, value))) * 1024 * 1024;
}

function maxAgeMs() {
  const configured = Number(process.env.DOCUMENT_PREVIEW_CACHE_MAX_AGE_DAYS ?? "90");
  const days = Number.isFinite(configured) ? Math.min(365, Math.max(1, Math.floor(configured))) : 90;
  return days * 24 * 60 * 60_000;
}

async function collectPreviews(directory: string, entries: PreviewEntry[]) {
  let handle;
  try {
    handle = await opendir(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }

  for await (const item of handle) {
    const itemPath = path.join(directory, item.name);
    if (item.isDirectory()) {
      await collectPreviews(itemPath, entries);
      continue;
    }
    // 심볼릭 링크는 따라가지 않습니다. 변환 결과 승격 단계에서도 일반 파일만 허용합니다.
    if (!item.isFile() || !item.name.endsWith(PREVIEW_SUFFIX)) continue;
    const info = await stat(itemPath).catch(() => null);
    if (info?.isFile()) entries.push({ path: itemPath, size: info.size, mtimeMs: info.mtimeMs });
  }
}

export async function pruneDocumentPreviewCache(now = Date.now()) {
  const maximumBytes = megabytes("DOCUMENT_PREVIEW_CACHE_MAX_MB", 10_240, 128, 1_048_576);
  const configuredTarget = megabytes("DOCUMENT_PREVIEW_CACHE_TARGET_MB", 8_192, 64, 1_048_576);
  const targetBytes = Math.min(maximumBytes, configuredTarget);
  const expiresBefore = now - maxAgeMs();
  const entries: PreviewEntry[] = [];
  await collectPreviews(getUploadRoot(), entries);
  entries.sort((left, right) => left.mtimeMs - right.mtimeMs);

  let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  const trimToTarget = totalBytes > maximumBytes;
  let removedBytes = 0;
  let removedFiles = 0;
  const failures: Array<{ path: string; error: unknown }> = [];

  for (const entry of entries) {
    const expired = entry.mtimeMs < expiresBefore;
    const shouldTrim = trimToTarget && totalBytes > targetBytes;
    if (!expired && !shouldTrim) continue;
    // 상한을 넘은 경우에는 목표 용량까지 내립니다. 만료 파일은 용량과 무관하게 지웁니다.
    try {
      await unlink(entry.path);
      totalBytes -= entry.size;
      removedBytes += entry.size;
      removedFiles += 1;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        failures.push({ path: entry.path, error });
      }
    }
  }

  return {
    scannedFiles: entries.length,
    remainingBytes: totalBytes,
    removedFiles,
    removedBytes,
    failed: failures.length,
    failures,
  };
}
