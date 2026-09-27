import "server-only";

import { ZipArchive, type ArchiverError } from "archiver";
import { finished } from "node:stream/promises";
import type { BoardExportData } from "@/lib/exports/data";
import { openAttachmentRepresentation } from "@/lib/files/attachment-read";

const PATH_SEPARATORS = /[\\/]+/g;
const CONTROL_CHARS = /[\x00-\x1f]/g;

// zip 항목 이름은 유니코드(한글 포함)를 그대로 쓸 수 있지만, 경로 구분자·제어 문자·빈 이름은
// 경로 조작이나 깨진 항목으로 이어질 수 있어 정리합니다.
function sanitizeZipSegment(name: string, fallback: string): string {
  const cleaned = name.replace(PATH_SEPARATORS, "_").replace(CONTROL_CHARS, "").trim();
  return cleaned.slice(0, 80) || fallback;
}

// 대용량 첨부를 한 번에 메모리에 올리지 않도록, archiver가 만드는 스트림에 파일마다
// fs.createReadStream으로 하나씩 이어 붙입니다(padupgrade.md 8.3 "대용량 ZIP 스트리밍").
export function buildAttachmentsZipStream(data: BoardExportData) {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on("warning", (error: ArchiverError) => console.error("attachments-zip warning", error));

  void (async () => {
    try {
      for (const post of data.posts) {
        const sectionFolder = sanitizeZipSegment(post.sectionTitle ?? "미분류", "미분류");
        const postFolder = `${sanitizeZipSegment(post.title ?? "제목 없음", "제목 없음")}_${post.id.slice(-6)}`;
        if (post.attachments.length === 0) continue;
        for (const attachment of post.attachments) {
          const entryDir = `${sectionFolder}/${postFolder}`;
          if (attachment.type === "LINK" || !attachment.storagePath) {
            if (attachment.externalUrl) {
              archive.append(`${attachment.externalUrl}\n`, { name: `${entryDir}/${sanitizeZipSegment(attachment.originalName, "link")}.txt` });
            }
            continue;
          }
          const opened = await openAttachmentRepresentation(attachment).catch(() => null);
          if (!opened) continue;
          const fileName = sanitizeZipSegment(opened.attachment.originalName, `${attachment.id}`);
          const stream = opened.handle.createReadStream({ autoClose: true });
          const abort = () => stream.destroy();
          archive.once("close", abort);
          try {
            archive.append(stream, { name: `${entryDir}/${fileName}` });
            await finished(stream); // Bound open descriptors while archiver consumes each entry.
          } finally { archive.off("close", abort); await opened.handle.close().catch(() => undefined); }
        }
      }
    } catch {
      archive.destroy(new Error("첨부 ZIP을 생성하지 못했습니다."));
    } finally {
      void archive.finalize();
    }
  })();

  return archive;
}
