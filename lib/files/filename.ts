import { randomUUID } from "node:crypto";

const maxFilenameLength = 180;
const windowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function safeExtension(extension: string) {
  const normalized = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return /^\.[a-z0-9]{1,12}$/.test(normalized) ? normalized : "";
}

export function normalizeOriginalFilename(originalName: string, outputExtension?: string) {
  const normalized = originalName.normalize("NFKC").replace(/\0/g, "");
  const leafName = normalized.split(/[\\/]/).pop() ?? "";
  const lastDot = leafName.lastIndexOf(".");
  const sourceExtension = lastDot > 0 ? leafName.slice(lastDot) : "";
  const extension = safeExtension(outputExtension ?? sourceExtension);
  const sourceStem = lastDot > 0 ? leafName.slice(0, lastDot) : leafName;
  let stem = sourceStem
    .replace(/[\u0000-\u001F\u007F<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");

  if (!stem) stem = "file";
  if (windowsReservedName.test(stem)) stem = `_${stem}`;
  const maxStemLength = Math.max(1, maxFilenameLength - Array.from(extension).length);
  stem = Array.from(stem).slice(0, maxStemLength).join("");
  return `${stem}${extension}`;
}

export function createStoredFilename(extension: string) {
  const normalizedExtension = safeExtension(extension);
  if (!normalizedExtension) throw new Error("저장 파일 확장자가 올바르지 않습니다.");
  const baseName = randomUUID();
  return { baseName, storedName: `${baseName}${normalizedExtension}` };
}
